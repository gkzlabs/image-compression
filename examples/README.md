# Examples

Framework integration examples for `@GKz/image-compression`.

Each example is a **standalone Vite project** that demonstrates the same image
compression demo in a different framework. They share identical UI logic — only
the framework binding differs.

## Available Examples

| Example | Framework | Bundle size (gzipped) | Best for |
|---|---|---|---|
| [`react/`](./react/) | React 18 + TypeScript | ~45 KB | React apps, Next.js (client components) |
| [`vue/`](./vue/) | Vue 3 + TypeScript | ~40 KB | Vue apps, Nuxt 3 |
| [`svelte/`](./svelte/) | Svelte 4 + TypeScript | ~35 KB | SvelteKit, lean apps |
| [`vanilla/`](./vanilla/) | TypeScript + Web Components | ~25 KB | Any framework, no dependencies |

The **Angular** demo lives in a separate repo
[`angular-image-compression`](https://gitlab.com/guidekungz/angular-image-compression)
because Angular CLI has different build tooling.

## Quick Start

Each example is independent. Pick one and run:

```bash
cd react    # or vue, svelte, vanilla
npm install
npm run dev
```

Open <http://localhost:5173>, upload an image, see it compressed.

## What's the Same Across All Examples

- ✅ Uses `@GKz/image-compression` v0.10.13
- ✅ Same cascade (webcodecs-worker → offscreen-worker → canvas-main)
- ✅ Same progress events + before/after size display
- ✅ Same quality, max-dimension, format controls
- ✅ Same HEIC support (Chrome 94+ native, fallback via `heic2any`)
- ✅ Same error handling (`CompressionError`)

## What's Different

Only the framework binding layer:

| Framework | State management | Event handlers | Build tool |
|---|---|---|---|
| React | `useState` + `useEffect` | `onClick`, `onChange` | Vite |
| Vue | `ref()` + `reactive()` | `@click`, `@change` | Vite |
| Svelte | `let` variables | `on:click`, `on:change` | Vite (svelte plugin) |
| Vanilla | Plain JS class | `addEventListener` | Vite (TS) |

## When to Use Which

- **React** — Most popular; best for SPAs, Next.js client components
- **Vue** — Lighter than React, great DX, popular in Asia/EU
- **Svelte** — Smallest bundle, fastest runtime, no virtual DOM
- **Vanilla TS** — Universal, framework-agnostic, drop into any page
- **Angular** — Enterprise apps with strict TypeScript (separate repo)

## File Upload Pattern (identical in all)

```ts
import { ImageCompression } from '@GKz/image-compression';

const svc = new ImageCompression();
const fileInput = document.querySelector('input[type="file"]')!;

fileInput.addEventListener('change', async (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  
  const result = await svc.compress(file, {
    quality: 0.85,
    maxWidthOrHeight: 2048,
    onProgress: (e) => console.log(`${e.percent}% ${e.stage}`),
  });
  
  console.log(`${result.originalSize} → ${result.compressedSize} (${result.path})`);
});
```

That's it. The library handles cascade selection, worker management, HEIC
pre-decode, and progress events. You just call `compress()` and get a result.

## Production Tips

1. **Reuse the service instance** — `new ImageCompression()` once, call
   `compress()` many times. The service caches capabilities and the Worker.
2. **Call `dispose()` when done** — terminates the Worker and frees memory.
3. **Use `onProgress` for UX** — shows users the compression is happening.
4. **Check `result.path`** — 'webcodecs-worker' is fastest on capable devices.
5. **Listen for `CompressionError`** — typed errors with codes like
   `HEIC_UNSUPPORTED`, `WORKER_INIT_FAILED`.

## Common Issues

| Issue | Solution |
|---|---|
| "Worker is not defined" | Browser too old, falls back to canvas-main |
| HEIC doesn't decode | Install `heic2any` peer dependency |
| Bundle too large | Tree-shake unused paths; only `ImageCompression` is exported |
| Worker fails to load | Check console for `__IC_WORKER_URL` escape hatch |