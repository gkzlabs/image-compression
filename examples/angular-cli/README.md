# Angular CLI example — the hostile bundler

Angular 18 app built with the **`@angular-devkit/build-angular:application`**
builder (esbuild). Every other example in this repo uses Vite; this one exists
because Vite and Angular CLI behave *differently* on the library's worker URL,
and the Angular CLI behaviour is the one that used to break in production.

## The finding this example pins down

`@gkzlabs/image-compression` resolves its worker with the standard
`new URL('./worker.js', import.meta.url)` pattern (see
`src/worker-resolution.ts`). Verified on Angular CLI 18.2 / esbuild:

| Bundler | Emits a worker chunk for a `node_modules` import? | Result |
| --- | --- | --- |
| Vite (examples/react, vue, svelte, angular) | **yes** — rewrites the URL to a hashed asset | worker paths work by default |
| Angular CLI 18 (`application` builder) | **no** — the URL stays `./worker.js` next to the emitted bundle | `new Worker()` 404s → cascade degrades to `canvas-main` (main-thread jank on large files, no error shown) |

Measured evidence (from the repo root, after `ng build`):

```
[ng-e2e] worker chunks emitted: (none)
[ng-e2e] result: {"path":"canvas-main", ...}
[ng-e2e] ✗ expected a Worker path, got "canvas-main"
```

Before the v1.3.0+ `rpc.ts` fail-fast fix, this case did not degrade — it
**hung forever** (`compress()` never settled: the RPC promise had no answer and
no error handler).

## The recipe (this is what CI verifies)

Copy the worker file into the build output, next to the app bundles. Angular's
asset glob keeps the filename, and since the emitted bundle sits at
`/main-<hash>.js`, the library's relative
`new URL('./worker.js', import.meta.url)` resolves to exactly that copied file —
no code change and no `__IC_WORKER_URL` needed:

```json
// angular.json → projects.<name>.architect.build.options.assets
{
  "glob": "worker.js",
  "input": "node_modules/@gkzlabs/image-compression/dist",
  "output": "."
}
```

This stays correct under a sub-path deploy (`ng build --base-href /my-app/`),
because the bundle and the asset move together.

If you prefer to be explicit (or your pipeline renames the file), the escape
hatch is equally valid — set it *before* the first `compress()` call:

```ts
window.__IC_WORKER_URL = new URL('worker.js', document.baseURI).href;
```

## Run it

```bash
# from the repo root — the example depends on file:../..
npm run build

cd examples/angular-cli
npm install
npm run build
npm run test:e2e        # serves dist/ in real Chromium, asserts the worker path
```

`npm run test:e2e` fails if the app silently lands on `canvas-main`, if the
worker 404s, or if compression throws. CI runs exactly this
(`.github/workflows/ci.yml` → job `angular-cli-build`).
