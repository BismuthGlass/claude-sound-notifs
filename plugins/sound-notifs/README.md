# sound-notifs

Sound feedback for Claude Code (macOS, played through `afplay`).

| Event    | Plays when                                                                 |
| -------- | -------------------------------------------------------------------------- |
| `submit` | you submit a message                                                        |
| `error`  | Claude cannot continue: the turn dies on an API error (failed tool calls are silent) |
| `prompt` | Claude asks a question or needs a permission                                |
| `done`   | Claude has finished and no background work (subagents, shells) is still running |

## Sound packs

A pack is a directory holding `pack.json` and its sound files. The directory's
name is the pack's name.

```
~/.claude/sound-packs/
  retro/
    pack.json
    blip.wav
    win-1.mp3
    win-2.mp3
```

```json
{
  "name": "Retro",
  "description": "8-bit blips.",
  "volume": 0.8,
  "events": {
    "submit": "blip.wav",
    "error": { "file": "buzz.wav", "volume": 0.5 },
    "prompt": "ask.wav",
    "done": ["win-1.mp3", "win-2.mp3"]
  }
}
```

- An event takes a file name, `{ "file", "volume" }`, or a list of either (one is picked at random each time).
- An event left out is silent.
- File names are relative to the pack's directory; an absolute path also works (see `packs/macos`).
- `volume` is a multiplier (1 = as recorded), applied on top of the master volume.
- Formats: whatever `afplay` plays (wav, mp3, aiff, m4a, ...); files up to 4 MiB.

Packs are looked up in `~/.claude/sound-packs` (or the configured packs directory)
first, then in this plugin's own `packs/`. Bundled: `default`, `macos`.
`pack.json` is read on every sound, so edits apply at once.

## Configuration

In `/config`, or with the `/sounds` command:

```
/sounds                 status
/sounds list            the packs found
/sounds use <pack>      switch pack
/sounds volume <0-400>  master volume in percent
/sounds on | off        master switch
/sounds test [event]    play one event's sound, or all four
```

Options: `enabled`, `pack`, `volume`, `packsDir`, and one switch per event
(`onSubmit`, `onError`, `onPrompt`, `onDone`).
