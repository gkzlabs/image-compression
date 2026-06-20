# @gkzlabs/image-compression — Vanilla TypeScript Example

Drop-in reference implementation using **only raw DOM APIs** — no framework, no virtual DOM. The smallest possible usage example.

## Quick start

```bash
npm install
npm run dev
```

Then open http://127.0.0.1:5173 and upload an image.

## When to use this example

- Adding image compression to an existing **non-framework site** (vanilla JS, Web Components, jQuery, etc.)
- Embedding in a static HTML page
- Building a no-build-step demo
- Understanding the **lowest-level API** without framework abstractions

## How it works

Single class `CompressorDemo` that:
1. Initializes `ImageCompression` service
2. Detects device capabilities (WebCodecs, OffscreenCanvas, Worker support)
3. Listens to file input changes
4. Calls `svc.compress(file, options)`
5. Re-renders DOM manually on state changes

The key file: [`src/main.ts`](./src/main.ts) (~150 lines, fully commented).

## Core API usage

```ts
import { ImageCompression, CompressionError } from '@gkzlabs/image-compression';
import type { CompressionResult, DeviceCapabilities } from '@gkzlabs/image-compression';

const svc = new ImageCompression();

// One-time: detect what the browser supports
const caps: DeviceCapabilities = await svc.getCapabilities();
console.log(caps);
// {
//   tier: 'high' | 'mid' | 'low',
//   hasWebCodecs: true,        // ImageDecoder API
//   hasOffscreenCanvas: true,  // main thread
//   hasCreateImageBitmap: true,
//   hasWorker: true,           // main thread
//   hasCanvas2D: true,
//   // worker-context caps (probed async after init):
//   hasOffscreenCanvasInWorker: true,
//   hasCreateImageBitmapInWorker: true,
//   hasWebCodecsInWorker: true,
//   ...
// }

// Compress a file
const result: CompressionResult = await svc.compress(file, {
  maxWidthOrHeight: 2048,         // resize to fit
  quality: 0.85,                   // 0-1
  format: 'image/jpeg',            // 'image/jpeg' | 'image/webp' | 'image/png'
  onProgress: (e) => {             // optional progress
    console.log(e.stage, e.percent, e.path);
    // stages: 'loading-worker' | 'decoding' | 'resizing' | 'encoding' | 'done'
  },
});

console.log(result);
// {
//   blob: Blob,                    // compressed image
//   originalSize: 19800,           // bytes
//   compressedSize: 5600,
//   path: 'webcodecs-worker' | 'offscreen-worker' | 'canvas-main',
//   tier: 'high' | 'mid' | 'low',
//   durationMs: 145,
//   width: 2048,
//   height: 1365,
//   mimeType: 'image/jpeg',
//   file: File,                    // original
//   name: 'test.jpg',              // suggested filename
// }

// Trigger download
const url = URL.createObjectURL(result.blob);
const a = document.createElement('a');
a.href = url;
a.download = result.name;
a.click();
URL.revokeObjectURL(url);

// Cleanup when done (terminates worker if running)
svc.dispose();
```

## Error handling

```ts
import { CompressionError } from '@gkzlabs/image-compression';

try {
  const result = await svc.compress(file, options);
} catch (err) {
  if (err instanceof CompressionError) {
    // err.code: 'DECODE_FAILED' | 'WORKER_INIT_FAILED' | 'INVALID_OPTIONS' | ...
    // err.path: which cascade path failed
    console.error(`${err.code}: ${err.message} (path: ${err.path})`);
  } else {
    // Unexpected error
    throw err;
  }
}
```

## Project structure

```
examples/vanilla/
├── index.html              # Vite entry, mounts <div id="app">
├── package.json
├── tsconfig.json
├── vite.config.ts
└── src/
    └── main.ts             # Single 150-line file
```

**5 files total** — minimal, no framework.

## See also

- [`../react/`](../react/) — React 18 + hooks equivalent
- [`../vue/`](../vue/) — Vue 3 + Composition API equivalent
- [`../svelte/`](../svelte/) — Svelte 5 equivalent
- [`../angular/`](../angular/) — Angular 18 + Vite equivalent
- [`../../docs/EXAMPLES.md`](../../docs/EXAMPLES.md) — Detailed framework comparison
- [`../../docs/BROWSER_COMPAT.md`](../../docs/BROWSER_COMPAT.md) — Per-bundler setup notes