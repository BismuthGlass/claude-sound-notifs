import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const PACK = JSON.stringify({
  name: 'Test',
  volume: 0.5,
  events: {
    submit: 'submit.wav',
    error: 'error.wav',
    prompt: ['prompt.wav'],
    done: { file: 'done.wav', volume: 0.5 },
  },
})

type Play = { asset?: string; gain?: number }

// A world where the bundled default pack is the one above and every clip
// played is recorded instead of heard.
const world = (on: On, pack = 'default') => {
  const plays: Play[] = []
  const clock = mock.clock(on, { now: 100_000 })

  mock.env(on, { HOME: '/home/me' })
  on('fs.exists', async (_$, e) => ({ value: e.path.endsWith(`/packs/${pack}/pack.json`) }))
  on('fs.read', async () => ({ value: PACK }))
  on('classic.Stop', async () => ({}))
  on('classic.PostToolUseFailure', async () => ({}))
  on('classic.StopFailure', async () => ({}))
  on('classic.PermissionRequest', async () => ({}))
  on('audio.play', async (_$, e) => {
    plays.push({ asset: e.clip.asset, gain: e.gain })

    return { value: undefined }
  })

  return { plays, clock }
}

test('a stop plays the done sound at the pack and sound volume', async ($, on) => {
  const { plays } = world(on)

  await $.classic.Stop({ stop_hook_active: false, background_tasks: [] })

  expect(plays).toEqual([{ asset: 'packs/default/done.wav', gain: 0.25 }])
})

test('a stop with background work still running stays silent', async ($, on) => {
  const { plays } = world(on)

  await $.classic.Stop({
    stop_hook_active: false,
    background_tasks: [{ id: 'a1', type: 'subagent', status: 'running', description: 'explore' }],
  })

  expect(plays).toEqual([])
})

test('a failed tool call is silent, the turn dying on an API error is not', async ($, on) => {
  const { plays } = world(on)

  await $.classic.PostToolUseFailure({ tool_name: 'Bash', tool_input: {}, tool_use_id: 't1', error: 'exit 1' })
  expect(plays).toEqual([])

  await $.classic.StopFailure({ error: 'server_error' })
  expect(plays.map(play => play.asset)).toEqual(['packs/default/error.wav'])
})

test('a permission request plays the prompt sound', async ($, on) => {
  const { plays } = world(on)

  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'ls' } })

  expect(plays.map(play => play.asset)).toEqual(['packs/default/prompt.wav'])
})

test('options pick the pack, scale the volume and mute an event', { options: { pack: 'retro', volume: 200, onError: false } }, async ($, on) => {
  const { plays } = world(on, 'retro')

  await $.classic.StopFailure({ error: 'server_error' })
  await $.classic.Stop({ stop_hook_active: false, background_tasks: [] })

  expect(plays).toEqual([{ asset: 'packs/retro/done.wav', gain: 0.5 }])
})

test('the master switch silences everything', { options: { enabled: false } }, async ($, on) => {
  const { plays } = world(on)

  await $.classic.Stop({ stop_hook_active: false, background_tasks: [] })

  expect(plays).toEqual([])
})
