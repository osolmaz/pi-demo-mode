# pi-demo-mode

pi-demo-mode is a [Pi](https://github.com/earendil-works/pi) extension package
that puts Pi into a self-driving demo mode. It sends a story prompt when the
session starts, keeps asking the model to continue after every turn (compacting
the session when the context fills up), and strips the TUI down to the chat
plus a single status line — no input bar, no directory line, no context meter.
The result is a terminal that endlessly writes a story on its own, which is
what you want for screen recordings and demo walls.

## Install

Into a plain Pi setup:

```bash
pi install github:osolmaz/pi-demo-mode
```

Or as an npm git dependency of a Pi launcher, pointing Pi at
`extensions/demo-mode.ts` inside the installed package.

## Usage

The extension is inert until it is enabled, so it can stay installed for
interactive sessions. Configuration is entirely through environment
variables:

| Variable                       | Meaning                                                         |
| ------------------------------ | --------------------------------------------------------------- |
| `PI_DEMO_MODE=1`               | enable demo mode                                                |
| `PI_DEMO_INITIAL_PROMPT`       | first prompt text                                               |
| `PI_DEMO_INITIAL_PROMPT_FILE`  | UTF-8 file with the first prompt (wins over the inline text)    |
| `PI_DEMO_FOLLOWUP_PROMPT`      | repeated prompt after each turn                                 |
| `PI_DEMO_FOLLOWUP_PROMPT_FILE` | UTF-8 file with the repeated prompt (wins over the inline text) |

Without prompt overrides, a built-in never-ending sci-fi story prompt is
used. Run Pi with tools disabled so nothing interrupts the story:

```bash
PI_DEMO_MODE=1 pi --no-tools --no-approve
```

The demo stops on its own when a turn is aborted or errors, and treats any
message you type as a live director note for the story.

## Used by

- [localpi](https://github.com/osolmaz/localpi) (`localpi --demo`)
- [diffusionpi](https://github.com/osolmaz/diffusionpi) (`diffusionpi demo`)

## License

[MIT](LICENSE)
