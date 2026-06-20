# @GKz/image-compression — Angular (Vite) Example

Angular 18 standalone example for `@GKz/image-compression`, built with **Vite** (via `@analogjs/vite-plugin-angular`).

This example exists because Angular CLI's dev server has known issues with library worker URLs — the standard `new URL('./worker.js', import.meta.url)` pattern returns 404 because Angular CLI doesn't pre-bundle workers from libraries. The workaround in [angular-image-compression](https://github.com/...) required copying the worker to `public/` and setting an `__IC_WORKER_URL` escape hatch.

By migrating to **Vite**, the library's standard pattern works out of the box. **Zero worker setup required**.

## Quick start

```bash
npm install
npm start
```

Then open http://127.0.0.1:4200 and upload an image.

## What changed from Angular CLI

| Removed | Replaced with |
|---|---|
| `angular.json` + `tsconfig.app.json` (custom) | `vite.config.ts` (Vite config) |
| `scripts/setup-worker.mjs` (post-build copy) | (not needed) |
| `public/image-compression.worker.js` | (not needed) |
| `__IC_WORKER_URL = '/assets/...'` escape hatch | (not needed) |
| `angular.json` `polyfills: ["zone.js"]` | `import 'zone.js'` in main.ts |

## Why Vite?

1. **`new URL('./worker.js', import.meta.url)` works out of the box** — Vite rewrites the URL to `/node_modules/.vite/deps/worker.js?worker_file&type=module` which it serves directly.
2. **No public/ folder setup** — Vite's dev server serves from `node_modules`.
3. **Faster dev startup + HMR** — Vite is ~10× faster than Angular CLI for dev server.
4. **Production build includes worker chunk automatically** — `vite build` emits `worker-*.js` chunks that get loaded by the main bundle.

## Stack

- Angular 18 (standalone components, signals)
- Vite 6 (dev server + bundler)
- `@analogjs/vite-plugin-angular` (Angular + Vite integration)

## Project structure

```
examples/angular/
├── index.html                # Vite entry HTML (root)
├── package.json
├── tsconfig.json             # Angular compiler options
├── tsconfig.app.json         # App-specific TS config
├── vite.config.ts            # Vite + Analog plugin config
└── src/
    ├── main.ts               # bootstrapApplication + zone.js import
    ├── styles.css            # Global styles
    └── app/
        ├── app.component.ts  # Angular signals demo
        ├── app.component.html
        └── app.component.css
```

## Comparison with other framework examples

| Feature | react/vue/svelte/vanilla | Angular (this) |
|---|---|---|
| Bundler | Vite | Vite (via Analog plugin) |
| Worker setup | None | None |
| Worker URL pattern | Auto by Vite | Auto by Vite |
| Angular CLI dep | No | No |
| Bootstrap | `createRoot().render(...)` | `bootstrapApplication(...)` |

See [`../README.md`](../README.md) for the full examples comparison.