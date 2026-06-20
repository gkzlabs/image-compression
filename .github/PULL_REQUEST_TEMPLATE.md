---
name: Pull request
description: Submit a change to the library
---

## What does this PR do?

A clear one-sentence description of the change.

## Why?

Link to the issue it closes, or describe the motivation.

Fixes #

## Type of change

- [ ] Bug fix (non-breaking change that fixes an issue)
- [ ] New feature (non-breaking change that adds functionality)
- [ ] Breaking change (existing API changes)
- [ ] Documentation update
- [ ] Refactor / internal change (no user-facing effect)
- [ ] Performance improvement
- [ ] Test improvement

## How was it tested?

- [ ] Added new tests (`npm test`)
- [ ] Updated existing tests
- [ ] Tested manually in `examples/`
- [ ] Tested across browsers (list):

## Checklist

- [ ] `npm run lint` passes (tsc clean)
- [ ] `npm run build` succeeds
- [ ] `npm test` passes
- [ ] `npm run size` — bundle size not regressed
- [ ] `CHANGELOG.md` updated (for user-facing changes)
- [ ] `README.md` updated (if API changed)
- [ ] Commit messages follow Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`, etc.)
- [ ] Branch is up-to-date with `main`

## Detection-path impact (if changing compression behavior)

If this PR changes the compression pipeline or any of the cascade paths, also check:

- [ ] `webcodecs-worker` still works
- [ ] `offscreen-worker` still works
- [ ] `canvas-main` still works
- [ ] `server-fallback` still works
- [ ] Safari iOS still works (HEIC decode + worker handoff)