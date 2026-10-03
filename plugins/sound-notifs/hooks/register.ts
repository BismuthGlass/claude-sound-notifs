import type { AudioClip, EngineInterface, PluginOptions, Register } from 'claude-code'

import { EVENTS, isPackId, isSoundEvent, mimeFor, parsePack, pickSound } from './packs'
import type { Pack, SoundEvent } from './packs'

const PLUGIN = 'sound-notifs'

// A burst of the same event (parallel tool calls failing, a question that is
// also a permission dialog) plays one sound.
const DEBOUNCE_MS: Record<SoundEvent, number> = { submit: 0, error: 1500, prompt: 1500, done: 1000 }

const MAX_GAIN = 4

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

type Settings = {
  packId: string
  volume: number
  isEnabled: boolean
  isOn: Record<SoundEvent, boolean>
  packsDir: string
  lastPlayedAt: Map<SoundEvent, number>
  lastFailure: string | undefined
}

const settingsOf = (options: PluginOptions): Settings => ({
  packId: typeof options.pack === 'string' && options.pack.trim() !== '' ? options.pack.trim() : 'default',
  volume: typeof options.volume === 'number' ? options.volume : 100,
  isEnabled: options.enabled !== false,
  isOn: {
    submit: options.onSubmit !== false,
    error: options.onError !== false,
    prompt: options.onPrompt !== false,
    done: options.onDone !== false,
  },
  packsDir: typeof options.packsDir === 'string' ? options.packsDir.trim() : '',
  lastPlayedAt: new Map(),
  lastFailure: undefined,
})

// The person's own packs first, so one of theirs replaces a bundled pack of
// the same name.
const packDirs = async ($: EngineInterface, my: Settings): Promise<string[]> => {
  const home = await $.env.get('HOME')
  const configured = my.packsDir
  const bundled = `${$.plugin.root}/packs`

  if (configured !== '') {
    return [configured.replace(/^~(?=\/|$)/, home ?? '~'), bundled]
  }

  return home === undefined ? [bundled] : [`${home}/.claude/sound-packs`, bundled]
}

// Read from disk each time, so an edited pack.json applies to the next sound.
const loadPack = async ($: EngineInterface, my: Settings, id: string): Promise<Pack> => {
  if (!isPackId(id)) {
    throw new Error(`"${id}" is not a pack name`)
  }

  for (const dir of await packDirs($, my)) {
    const path = `${dir}/${id}/pack.json`

    if (await $.fs.exists(path)) {
      return parsePack(await $.fs.read(path), id, `${dir}/${id}`)
    }
  }

  throw new Error(`sound pack "${id}" was not found`)
}

const listPacks = async ($: EngineInterface, my: Settings): Promise<string[]> => {
  const lines: string[] = []
  const seen = new Set<string>()

  for (const dir of await packDirs($, my)) {
    const entries = (await $.fs.exists(dir)) ? await $.fs.list(dir) : []

    for (const entry of entries) {
      if (entry.kind === 'file' || seen.has(entry.name) || !(await $.fs.exists(`${dir}/${entry.name}/pack.json`))) {
        continue
      }

      seen.add(entry.name)

      try {
        const pack = await loadPack($, my, entry.name)
        const covered = EVENTS.filter(event => (pack.events[event]?.length ?? 0) > 0).join(', ')
        const mark = entry.name === my.packId ? '*' : ' '

        lines.push(`${mark} ${entry.name}: ${pack.description || pack.name} [${covered}] (${pack.dir})`)
      } catch (error) {
        lines.push(`  ${entry.name}: broken, ${messageOf(error)}`)
      }
    }
  }

  return lines
}

const clipOf = async ($: EngineInterface, pack: Pack, file: string): Promise<AudioClip> => {
  const root = `${$.plugin.root}/`

  if (!file.startsWith('/') && pack.dir.startsWith(root)) {
    return { asset: `${pack.dir.slice(root.length)}/${file}` }
  }

  const { base64 } = await $.fs.read(file.startsWith('/') ? file : `${pack.dir}/${file}`, { as: 'bytes' })

  return { base64, mime: mimeFor(file) }
}

// Resolves once the clip is ready, with the call that starts it; undefined
// when the pack has no sound for the event or the volume is zero.
const prepare = async ($: EngineInterface, my: Settings, event: SoundEvent): Promise<(() => Promise<void>) | undefined> => {
  const pack = await loadPack($, my, my.packId)
  const sound = pickSound(pack, event, Math.random())

  if (sound === undefined) {
    return undefined
  }

  const gain = Math.min(MAX_GAIN, Math.max(0, (my.volume / 100) * pack.volume * sound.volume))

  if (gain === 0) {
    return undefined
  }

  const clip = await clipOf($, pack, sound.file)

  return () => $.audio.play(clip, { gain })
}

// Never throws and never waits for the clip to end: a sound must not hold
// up or break the event it accompanies.
const notify = async ($: EngineInterface, my: Settings, event: SoundEvent): Promise<void> => {
  if (!my.isEnabled || !my.isOn[event]) {
    return
  }

  try {
    const now = await $.clock.now()
    const last = my.lastPlayedAt.get(event)

    if (last !== undefined && now - last < DEBOUNCE_MS[event]) {
      return
    }

    my.lastPlayedAt.set(event, now)

    const start = await prepare($, my, event)

    start?.().catch((error: unknown) => {
      my.lastFailure = `${event}: ${messageOf(error)}`
    })
  } catch (error) {
    my.lastFailure = `${event}: ${messageOf(error)}`
  }
}

const setOption = async ($: EngineInterface, field: string, value: string | number | boolean, done: string) => {
  const { deny } = await $.config.set({ key: `${PLUGIN}.${field}`, value })

  return { text: deny === undefined ? done : `Could not change ${field}: ${deny}` }
}

const status = async ($: EngineInterface, my: Settings): Promise<string> => {
  const events = EVENTS.map(event => `${event} ${my.isOn[event] ? 'on' : 'off'}`).join(', ')
  const lines = [
    `Sounds are ${my.isEnabled ? 'on' : 'off'}. Pack: ${my.packId}. Volume: ${my.volume}%.`,
    `Events: ${events}.`,
    `Your packs go in ${(await packDirs($, my))[0]}/<name>/pack.json.`,
    'Usage: /sounds list | use <pack> | volume <0-400> | on | off | test [event]',
  ]

  try {
    await loadPack($, my, my.packId)
  } catch (error) {
    lines.push(`Problem: ${messageOf(error)}`)
  }

  if (my.lastFailure !== undefined) {
    lines.push(`Last failure: ${my.lastFailure}`)
  }

  return lines.join('\n')
}

const testSounds = async ($: EngineInterface, my: Settings, which: string | undefined): Promise<string> => {
  if (which !== undefined && !isSoundEvent(which)) {
    return `Unknown event "${which}". Events: ${EVENTS.join(', ')}.`
  }

  const lines: string[] = []

  // One after another, so the clips do not play over each other.
  for (const event of which === undefined ? EVENTS : [which]) {
    try {
      const start = await prepare($, my, event)

      await start?.()
      lines.push(start === undefined ? `${event}: no sound (not in the pack, or volume 0)` : `${event}: played`)
    } catch (error) {
      lines.push(`${event}: failed, ${messageOf(error)}`)
    }
  }

  return lines.join('\n')
}

export const register: Register = (on, options) => {
  const my = settingsOf(options)

  on('prompt.submit', async ($, e, next) => {
    if (e.origin.kind === 'composer' || e.origin.kind === 'bridge') {
      await notify($, my, 'submit')
    }

    return next(e)
  })

  on('tool.call', { tool: 'AskUserQuestion' }, async ($, e, next) => {
    await notify($, my, 'prompt')

    return next(e)
  })

  on('classic.PermissionRequest', async ($, e, next) => {
    await notify($, my, 'prompt')

    return next(e)
  })

  on('classic.Elicitation', async ($, e, next) => {
    await notify($, my, 'prompt')

    return next(e)
  })

  // Only what ends the work: an API error the turn could not get past. A
  // failed tool call is routine, the model reads it and carries on.
  on('classic.StopFailure', async ($, e, next) => {
    await notify($, my, 'error')

    return next(e)
  })

  // The main loop's stop. While background work (subagents, shells,
  // workflows) is in flight the session is only paused: its completion starts
  // another turn, and that turn's stop is the one that sounds.
  on('classic.Stop', async ($, e, next) => {
    if ((e.background_tasks?.length ?? 0) === 0) {
      await notify($, my, 'done')
    }

    return next(e)
  })

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'sounds',
      description: 'Sound notifications: status, list packs, switch pack, set volume, test a sound.',
      argumentHint: '[list | use <pack> | volume <0-400> | on | off | test [event]]',
    })

    return next(e)
  })

  on('command.run', { command: 'sounds' }, async ($, e) => {
    const [verb = '', arg] = e.args.trim().split(/\s+/)

    switch (verb) {
      case '':
      case 'status':
        return { text: await status($, my) }
      case 'list': {
        const packs = await listPacks($, my)

        return { text: packs.length === 0 ? 'No sound packs found.' : packs.join('\n') }
      }
      case 'use': {
        if (arg === undefined) {
          return { text: 'Usage: /sounds use <pack>' }
        }

        try {
          await loadPack($, my, arg)
        } catch (error) {
          return { text: `Not switching: ${messageOf(error)}` }
        }

        return setOption($, 'pack', arg, `Sound pack is now ${arg}.`)
      }
      case 'volume': {
        const percent = Number(arg)

        if (arg === undefined || !Number.isFinite(percent) || percent < 0 || percent > 400) {
          return { text: 'Usage: /sounds volume <0-400>' }
        }

        return setOption($, 'volume', percent, `Sound volume is now ${percent}%.`)
      }
      case 'on':
        return setOption($, 'enabled', true, 'Sounds are on.')
      case 'off':
        return setOption($, 'enabled', false, 'Sounds are off.')
      case 'test':
        return { text: await testSounds($, my, arg) }
      default:
        return { text: `Unknown subcommand "${verb}". Usage: /sounds list | use <pack> | volume <0-400> | on | off | test [event]` }
    }
  })
}
