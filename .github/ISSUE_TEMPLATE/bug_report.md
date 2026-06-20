---
name: Bug report
description: Report a bug or unexpected behavior
labels: ['bug', 'triage']
---

## Describe the bug

A clear and concise description of what the bug is.

## To reproduce

Minimal code snippet or steps to reproduce:

```ts
import { ImageCompression } from '@gkzlabs/image-compression';

// your code here
```

## Expected behavior

What you expected to happen.

## Actual behavior

What actually happened. Include error messages, console output, or screenshots.

## Environment

- Library version: `npm ls @gkzlabs/image-compression` → output
- Browser + version:
- OS:
- Framework (if any): vanilla / React / Vue / Svelte / Angular
- Bundler (if any): Vite / Webpack / Rollup / esbuild / ng-packagr

## Detection path

Which cascade path was used? Check `result.path`:

- [ ] `webcodecs-worker`
- [ ] `offscreen-worker`
- [ ] `canvas-main`
- [ ] `server-fallback`

## Additional context

Any other relevant information.