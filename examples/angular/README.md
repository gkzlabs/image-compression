# @GKz/image-compression — Angular Example

Angular 17 standalone example for `@GKz/image-compression`. Same demo UI as
the react/vue/svelte/vanilla examples — only the framework binding differs.

## Quick Start

```bash
npm install
npm start
```

Open <http://localhost:4200>, upload an image, see it compressed.

## What's Different from Other Examples

Angular has 2 extra build steps that the other frameworks don't need:

1. **`build:worker`** — bundles `@GKz/image-compression`'s Web Worker
   (`dist/worker.js`) to a stable filename in the dist output. Required
   because Angular CLI's esbuild doesn't reliably rewrite
   `new Worker(new URL('./worker', import.meta.url))`.

2. **`build:heic2any`** — copies the optional `heic2any` WASM decoder to
   dist so it can be loaded via the `__IC_HEIC2ANY_URL` escape hatch
   (set in `src/main.ts` to `/heic2any.js`).

These run automatically as part of `npm run build`.

## Project Structure

```
examples/angular/
├── angular.json                 # Angular CLI config
├── package.json                 # Angular 17 + @GKz/image-compression
├── tsconfig.json                # Strict TS + Angular compiler options
├── tsconfig.app.json            # App-only TS config
├── scripts/
│   ├── build-worker.js          # Postbuild: bundles worker
│   └── copy-heic2any.js         # Postbuild: copies HEIC decoder
└── src/
    ├── index.html               # App entry
    ├── main.ts                  # bootstrapApplication()
    ├── styles.css               # Global styles
    └── app/
        ├── app.component.ts     # ImageCompression logic + UI state
        ├── app.component.html   # Template (control flow + @if)
        └── app.component.css    # Component styles
```

## Angular-Specific Patterns

### Standalone components
Angular 17 standalone API — no `NgModule`, just `bootstrapApplication()`:
```ts
// main.ts
bootstrapApplication(AppComponent).catch(console.error);
```

### Signals for state
Uses Angular 17+ signals (no `BehaviorSubject`/`getValue` boilerplate):
```ts
caps = signal<DeviceCapabilities | null>(null);
result = signal<CompressionResult | null>(null);
saved = computed(() => /* derived */);
```

### New control flow syntax
Uses Angular 17 `@if`/`@for` instead of `*ngIf`/`*ngFor`:
```html
@if (caps(); as c) {
  <p>Tier: {{ c.tier }}</p>
}
```

## When to Use Angular

- ✅ Enterprise apps with strict TypeScript
- ✅ Apps already using Angular (the obvious choice)
- ✅ Teams familiar with DI, RxJS, NgRx patterns
- ❌ Small apps (Angular's bundle is heavy vs. vanilla/svelte)
- ❌ Apps not using Angular (use react/vue/svelte instead)

## Files You Can Delete for a Production App

- `scripts/build-heic2any.js` if you don't need HEIC support
- `package.json` `optionalDependencies.heic2any` if not needed

## Reference

- [Angular docs](https://angular.io/docs)
- [`@GKz/image-compression` README](../../README.md)
- [Other examples](../react/) — pick the right framework for your app

## License

MIT (same as `@GKz/image-compression`).