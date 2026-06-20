# @gkzlabs/image-compression — Angular (Vite) Example

Angular 18 standalone example for `@gkzlabs/image-compression`, built with **Vite** (via `@analogjs/vite-plugin-angular`).

**Zero worker setup required** — Vite handles `new URL('./worker.js', import.meta.url)` automatically.

## Quick start

```bash
npm install
npm start
```

Then open http://127.0.0.1:4200 and upload an image.

## Why Vite instead of Angular CLI?

Angular CLI's dev server has known issues with library worker URLs:
- `new Worker(new URL('./worker.js', import.meta.url))` from a library gets
  rewritten to `/node_modules/.vite/deps/worker.js?...` which returns 404
  (Angular CLI doesn't pre-bundle workers from libraries)
- Workaround in [angular-image-compression](https://...) was to copy worker
  to `public/` + set `__IC_WORKER_URL` escape hatch

Vite (via `@analogjs/vite-plugin-angular`) handles this natively. **No public/ folder, no escape hatch, no copy script needed.**

## Stack

- Angular 18 (standalone components, signals)
- Vite 6 (dev server + bundler)
- `@analogjs/vite-plugin-angular` (Angular + Vite integration)

## How Vite handles the worker

Vite detects the library's `new Worker(new URL('./worker.js', import.meta.url))` pattern and:

| Mode | Worker URL |
|---|---|
| **Dev** (`npm start`) | `/@fs/.../dist/worker.js` (served from `node_modules` via Vite's `@fs` scheme) |
| **Production** (`npm run build`) | `/assets/worker-<hash>.js` (auto-bundled as separate chunk) |

The `vite.config.ts` has two tweaks to make this work:

```ts
// 1. Exclude the lib from optimize-deps (Vite's optimizer fails on worker.js)
optimizeDeps: { exclude: ['@gkzlabs/image-compression'] },

// 2. Allow Vite to serve files from outside the project root
server: { fs: { allow: ['..', '../..'] } },
```

## Project structure

```
examples/angular/
├── index.html                # Vite entry (root)
├── package.json
├── tsconfig.json
├── tsconfig.app.json
├── vite.config.ts            # Vite + Analog plugin config
└── src/
    ├── main.ts               # bootstrapApplication + zone.js
    ├── styles.css
    └── app/
        ├── app.component.ts  # Angular signals demo
        ├── app.component.html
        └── app.component.css
```

**12 files total** — minimal, no public/, no setup scripts.

## HEIC support (optional)

The library's `tryDecodeHEICLazy()` decodes HEIC files in browsers without
native ImageDecoder support. For production, install `heic2any` and set
`__IC_HEIC2ANY_URL` to a path the lib can load.

This demo doesn't include HEIC setup (opt-in). To enable:

```bash
npm install heic2any
# Then copy heic2any.min.js to public/ and add to main.ts:
# (window as any).__IC_HEIC2ANY_URL = '/heic2any.js';
```

## Build & preview

```bash
npm run build       # vite build → dist/
npm run preview     # serve dist/ on port 4300
```

Build output:
```
dist/index.html                              0.36 kB
dist/assets/worker-<hash>.js                 8.58 kB  ← Vite-bundled worker
dist/assets/image-compression-<hash>.js      0.03 kB  ← Comlink
dist/assets/index-<hash>.js                224.36 kB
✓ built in ~1.7s
```

## Comparison with other framework examples

| Feature | react/vue/svelte/vanilla | Angular (this) |
|---|---|---|
| Bundler | Vite | Vite (via Analog plugin) |
| Worker setup | None | **None** |
| Worker URL pattern | Auto by Vite | Auto by Vite (via `@fs` + optimize-deps exclude) |
| Angular CLI dep | No | No |
| Bootstrap | `createRoot().render(...)` | `bootstrapApplication(...)` |
| Files | 5-7 | **12** (config files for Angular) |

See [`../README.md`](../README.md) for the full examples comparison.