// Sound packs: a directory holding pack.json and the sound files it names.

export const EVENTS = ['submit', 'error', 'prompt', 'done'] as const

export type SoundEvent = (typeof EVENTS)[number]

export type Sound = {
  // Relative to the pack's directory, or absolute.
  file: string
  volume: number
}

export type Pack = {
  id: string
  dir: string
  name: string
  description: string
  volume: number
  events: Partial<Record<SoundEvent, readonly Sound[]>>
}

const MIME: Record<string, string> = {
  wav: 'audio/wav',
  mp3: 'audio/mpeg',
  aiff: 'audio/aiff',
  aif: 'audio/aiff',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  flac: 'audio/flac',
  ogg: 'audio/ogg',
}

export const isSoundEvent = (value: string): value is SoundEvent =>
  (EVENTS as readonly string[]).includes(value)

export const isPackId = (value: string): boolean =>
  /^[\w.-]+$/.test(value) && value !== '.' && value !== '..'

export const mimeFor = (file: string): string =>
  MIME[file.slice(file.lastIndexOf('.') + 1).toLowerCase()] ?? 'audio/wav'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const toVolume = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 1

const toFile = (value: unknown, where: string): string => {
  if (typeof value !== 'string' || value === '') {
    throw new Error(`${where}: expected a sound file name`)
  }

  const file = value.replace(/^(\.\/)+/, '')

  if (!file.startsWith('/') && file.split('/').includes('..')) {
    throw new Error(`${where}: "${value}" leaves the pack's directory`)
  }

  return file
}

// One entry of `events`: "a.wav", { "file": "a.wav", "volume": 0.5 }, or a
// list of either, from which one is picked at random each time.
const toSounds = (value: unknown, where: string): Sound[] => {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => toSounds(item, `${where}[${index}]`))
  }

  if (isRecord(value)) {
    return [{ file: toFile(value.file, `${where}.file`), volume: toVolume(value.volume) }]
  }

  return [{ file: toFile(value, where), volume: 1 }]
}

export const parsePack = (text: string, id: string, dir: string): Pack => {
  let json: unknown

  try {
    json = JSON.parse(text)
  } catch (error) {
    throw new Error(`pack.json is not valid JSON (${error instanceof Error ? error.message : String(error)})`)
  }

  if (!isRecord(json) || !isRecord(json.events)) {
    throw new Error('pack.json needs an "events" object')
  }

  const events: Pack['events'] = {}

  for (const [event, value] of Object.entries(json.events)) {
    if (isSoundEvent(event) && value !== null) {
      events[event] = toSounds(value, `events.${event}`)
    }
  }

  return {
    id,
    dir,
    name: typeof json.name === 'string' ? json.name : id,
    description: typeof json.description === 'string' ? json.description : '',
    volume: toVolume(json.volume),
    events,
  }
}

// `roll` is a number in [0, 1), as Math.random gives.
export const pickSound = (pack: Pack, event: SoundEvent, roll: number): Sound | undefined => {
  const sounds = pack.events[event] ?? []

  return sounds[Math.min(sounds.length - 1, Math.floor(roll * sounds.length))]
}
