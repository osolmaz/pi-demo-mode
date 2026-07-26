# AGENTS.md - pi-demo-mode

This repository is a Pi package containing a single extension that puts Pi
into a self-driving continuous story demo mode with a stripped-down TUI.

Before finishing code changes, run:

```bash
npm run check
```

Rules:

- Keep the extension app-agnostic. It is consumed by multiple Pi launchers
  (localpi, diffusionpi, plain Pi); all configuration goes through the
  documented `PI_DEMO_*` environment variables, never launcher-specific ones.
- Keep the extension inert unless `PI_DEMO_MODE=1` is set, so it can stay
  installed in interactive sessions.
- Use only the public Pi extension API. No monkey-patching of Pi internals.
- The package ships raw TypeScript loaded by Pi's own module loader; there is
  no build step. Typecheck against the real `@earendil-works/pi-coding-agent`
  types instead.
