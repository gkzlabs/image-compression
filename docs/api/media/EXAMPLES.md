# Examples — Detailed Usage Guide

This guide explains the **framework-specific binding patterns** for using `@gkz/image-compression` across different frameworks, common pitfalls, performance tips, and HEIC support.

> 📖 For per-example READMEs, see [`examples/<framework>/README.md`](../examples/).

## Table of contents

- [Library API overview](#library-api-overview)
- [Framework comparison matrix](#framework-comparison-matrix)
- [State management patterns](#state-management-patterns)
- [Lifecycle management](#lifecycle-management)
- [Batch processing](#batch-processing)
- [Abort + cancellation](#abort--cancellation)
- [HEIC support](#heic-support)
- [Performance tips](#performance-tips)
- [Common pitfalls](#common-pitfalls)
- [Migration from v0.5.x](#migration-from-v05x)

## Library API overview

The library is **framework-agnostic** — a single class `ImageCompression` handles all the work.

```ts
import { ImageCompression, CompressionError } from '@gkz/image-compression';
import type {
  CompressionOptions,
  CompressionResult,
  DeviceCapabilities,
  BatchProgress,
} from '@gkz/image-compression';

const svc = new ImageCompression();

// 1. One-time capability detection
const caps: DeviceCapabilities = await svc.getCapabilities();

// 2. Compress a single file
const result: CompressionResult = await svc.compress(file, options);

// 3. Compress multiple files (async iterable)
for await (const event of svc.compressAll(files, options)) {
  // event.type: 'progress' | 'result' | 'error' | 'done'
}

// 4. Cleanup
svc.dispose();
```

### Key types

```ts
interface DeviceCapabilities {
  tier: 'high' | 'mid' | 'low';        // based on detected caps
  hasWebCodecs: boolean;                // ImageDecoder API
  hasOffscreenCanvas: boolean;          // main thread
  hasCreateImageBitmap: boolean;
  hasWorker: boolean;                   // main thread
  hasCanvas2D: boolean;
  // Worker-context caps (probed async after init):
  hasOffscreenCanvasInWorker: boolean;
  hasCreateImageBitmapInWorker: boolean;
  hasWebCodecsInWorker: boolean;
}

interface CompressionOptions {
  maxWidthOrHeight?: number;            // default 2048
  quality?: number;                     // 0-1, default 0.85
  format?: 'image/jpeg' | 'image/webp' | 'image/png';  // default 'image/jpeg'
  rotate?: 0 | 90 | 180 | 270;          // manual rotation
  mirror?: 'horizontal' | 'vertical';   // manual mirror
  width?: number;                       // exact width
  height?: number;                      // exact height
  keepAspectRatio?: boolean;            // default true
  onProgress?: (e: CompressionProgress) => void;
  signal?: AbortSignal;
}

interface CompressionResult {
  blob: Blob;
  originalSize: number;
  compressedSize: number;
  path: 'webcodecs-worker' | 'offscreen-worker' | 'canvas-main';
  tier: 'high' | 'mid' | 'low';
  durationMs: number;
  width: number;
  height: number;
  mimeType: string;
  file: File;
  name: string;
}

interface CompressionProgress {
  stage: 'loading-worker' | 'decoding' | 'resizing' | 'encoding' | 'done' | 'fallback' | 'error';
  percent: number;                      // 0-100
  path: string;
  attempt?: number;                     // 1-based cascade attempt
  totalPaths?: number;
  message?: string;
}
```

## Framework comparison matrix

| Framework | Service holder | Reactive state | Lifecycle init | Lifecycle dispose |
|---|---|---|---|---|
| vanilla | `private svc` | class field | constructor | manual `svc.dispose()` |
| react | `useRef<ImageCompression \| null>(null)` | `useState<T>()` | `useEffect(() => {...}, [])` | `useEffect(() => () => svc?.dispose(), [])` |
| vue 3 | `let svc: ImageCompression \| null` | `ref<T>()` | `onMounted(() => {...})` | `onUnmounted(() => svc?.dispose())` |
| svelte 5 | `let svc: ImageCompression \| null` | `let x = $state<T>(...)` | `$effect(() => {...})` | `$effect(() => { setup; return cleanup; })` |
| angular 18 | `private svc = new ImageCompression()` | `signal<T>()` | `ngOnInit()` | `ngOnDestroy()` |

## State management patterns

### Reactive state across frameworks

```ts
// vanilla — class fields
class Demo {
  caps: DeviceCapabilities | null = null;
  result: CompressionResult | null = null;
  isCompressing = false;
}

// react — useState
const [caps, setCaps] = useState<DeviceCapabilities | null>(null);
const [result, setResult] = useState<CompressionResult | null>(null);
const [isCompressing, setIsCompressing] = useState(false);

// vue — ref()
const caps = ref<DeviceCapabilities | null>(null);
const result = ref<CompressionResult | null>(null);
const isCompressing = ref(false);

// svelte 5 — $state
let caps = $state<DeviceCapabilities | null>(null);
let result = $state<CompressionResult | null>(null);
let isCompressing = $state(false);

// angular — signal
caps = signal<DeviceCapabilities | null>(null);
result = signal<CompressionResult | null>(null);
isCompressing = signal(false);
```

### Why NOT use reactive state for the service itself

```ts
// ❌ WRONG — service gets re-created on every render
const [svc] = useState(new ImageCompression());
const svc = ref(new ImageCompression());
let svc = $state(new ImageCompression());
svc = signal(new ImageCompression());

// ✅ CORRECT — service is a single instance, not reactive
const svcRef = useRef<ImageCompression | null>(null);
let svc: ImageCompression | null = null;
private svc = new ImageCompression();  // eager, fine for Angular
```

Reactive state for the service means:
- The service gets re-created when other state changes
- Worker gets terminated and re-created (slow!)
- Reactivity tracking overhead for non-reactive data

## Lifecycle management

All frameworks need:
1. **Initialize** the service on mount (create worker if needed)
2. **Dispose** on unmount (terminate worker, free memory)

### Vanilla — manual

```ts
class Demo {
  private svc = new ImageCompression();

  constructor(root: HTMLElement) {
    // initialize UI
  }

  destroy() {
    this.svc.dispose();
  }
}

// In a SPA:
const demo = new Demo(document.getElementById('app')!);
window.addEventListener('beforeunload', () => demo.destroy());
```

### React — useEffect with cleanup

```tsx
useEffect(() => {
  const svc = new ImageCompression();
  svcRef.current = svc;
  svc.getCapabilities().then(setCaps);
  return () => svc.dispose();  // cleanup on unmount
}, []);  // empty deps = run once
```

### Vue 3 — onMounted + onUnmounted

```vue
<script setup>
let svc: ImageCompression | null = null;
onMounted(async () => {
  svc = new ImageCompression();
  caps.value = await svc.getCapabilities();
});
onUnmounted(() => svc?.dispose());
</script>
```

### Svelte 5 — $effect with cleanup

```svelte
<script>
let svc: ImageCompression | null = null;
$effect(() => {
  svc = new ImageCompression();
  svc.getCapabilities().then(c => caps = c);
  return () => svc?.dispose();
});
</script>
```

### Angular 18 — OnInit + OnDestroy

```ts
@Component({...})
export class DemoComponent implements OnInit, OnDestroy {
  private svc = new ImageCompression();

  ngOnInit() {
    this.svc.getCapabilities().then(c => this.caps.set(c));
  }

  ngOnDestroy() {
    this.svc.dispose();
  }
}
```

## Batch processing

For multiple files, use `compressAll()` which returns an async iterable:

```ts
const results: CompressionResult[] = [];

for await (const event of svc.compressAll(files, options)) {
  switch (event.type) {
    case 'progress':
      console.log(`${event.index + 1}/${event.total}: ${event.path}`);
      break;
    case 'result':
      results.push(event.result);
      break;
    case 'error':
      console.error(`File ${event.index} failed:`, event.error);
      break;
    case 'done':
      console.log('All done');
      break;
  }
}
```

### Why async iterable (not Promise<CompressionResult[]>)?

- **Streaming** — process results as they complete (don't wait for all)
- **Cancellation** — break out of the loop to abort remaining files
- **Per-file events** — distinguish progress, result, error, done

### Per-file errors don't stop the batch

```ts
for await (const event of svc.compressAll(files, options)) {
  if (event.type === 'error') {
    // log error, continue with next file
  }
}
```

## Abort + cancellation

Use `AbortController` to cancel an in-progress compression:

```ts
const controller = new AbortController();

const promise = svc.compress(file, {
  ...options,
  signal: controller.signal,
});

// Cancel after 30 seconds
setTimeout(() => controller.abort(), 30_000);

try {
  await promise;
} catch (err) {
  if (err.name === 'AbortError') {
    console.log('Cancelled');
  } else {
    throw err;
  }
}
```

For batch:

```ts
async function compressWithCancel(files: File[]) {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 60_000);
  try {
    for await (const event of svc.compressAll(files, { signal: controller.signal, ...options })) {
      // process
    }
  } catch (err) {
    if (err.name === 'AbortError') console.log('Cancelled');
    else throw err;
  }
}
```

## HEIC support

iPhone photos (`.heic`/`.heif`) need special handling. The library tries 3 strategies in order:

1. **Native `ImageDecoder('image/heic')`** — Chrome 94+ on desktop, Android, iPadOS 16+ (no Safari)
2. **heic2any** — JS-based decoder, works in any browser (slow, ~2MB bundle)
3. **HEIC not supported** — throws error

### Auto-detection

The library auto-detects HEIC files by extension or MIME type. No opt-in needed for native decode.

### Enabling heic2any fallback

For browsers without native ImageDecoder('image/heic') support:

```bash
npm install heic2any
```

Then expose the heic2any bundle so the lib can load it:

**Vite:**
```ts
// main.ts (top, before bootstrap)
import 'vite/heic2any';  // exposes /heic2any.js via Vite asset
```

**Or copy to public:**
```bash
cp node_modules/heic2any/dist/heic2any.min.js public/heic2any.js
```

```ts
// main.ts
(window as any).__IC_HEIC2ANY_URL = '/heic2any.js';
```

**Angular (with Vite):**
The library tries the deep import first. If it fails (Angular bundles), the escape hatch is the only way:

```ts
// src/main.ts (Angular)
(window as any).__IC_HEIC2ANY_URL = '/heic2any.js';
```

Plus copy `node_modules/heic2any/dist/heic2any.min.js` to `public/heic2any.js`.

## Performance tips

### 1. Reuse the service

```ts
// ❌ Bad — creates worker every time
async function compress(file) {
  const svc = new ImageCompression();
  const result = await svc.compress(file, options);
  svc.dispose();
  return result;
}

// ✅ Good — one worker, reuse for all files
const svc = new ImageCompression();
const results = await Promise.all(
  files.map(f => svc.compress(f, options))
);
svc.dispose();
```

The worker has a **30-second idle timeout** (configurable). After 30s of no compress() calls, it terminates automatically to free memory.

### 2. Use the right cascade path

The library picks the best path automatically. For guidance:

| Path | When | Speed | Memory |
|---|---|---|---|
| `webcodecs-worker` | Chrome/Edge, modern Safari | ⚡⚡⚡ fastest | Low (in worker) |
| `offscreen-worker` | Firefox, older browsers | ⚡⚡ fast | Low (in worker) |
| `canvas-main` | No worker caps, IE fallback | ⚡ slower | High (on main thread) |

For large files (>100 KB), the library prefers worker paths. If `hasWebCodecs` is `false` but `hasOffscreenCanvas` is `true`, it uses `offscreen-worker`.

### 3. Resize on the server, not the client

For very large images (10+ MB), consider:
- Resizing on the server (e.g., Cloudflare Image Resizing)
- Using a CDN with automatic format negotiation (WebP/AVIF)

The client-side library is best for **images up to ~5 MB**.

### 4. Skip compression for already-small files

```ts
const result = await svc.compress(file, {
  maxWidthOrHeight: 2048,
  quality: 0.85,
  // pass-through if compressed result is bigger
  passThrough: { thresholdKB: 300 },
});
```

The library returns the original if compression doesn't save space.

## Common pitfalls

### 1. Creating the service in render

```tsx
// ❌ Bad — service re-created on every render
function App() {
  const svc = new ImageCompression();  // BAD!
  return <div>...</div>;
}

// ✅ Good — service in ref, created once
function App() {
  const svcRef = useRef<ImageCompression | null>(null);
  useEffect(() => {
    svcRef.current = new ImageCompression();
    return () => svcRef.current?.dispose();
  }, []);
  return <div>...</div>;
}
```

### 2. Forgetting to dispose

```tsx
// ❌ Bad — worker leak
useEffect(() => {
  const svc = new ImageCompression();
  svcRef.current = svc;
  // no cleanup
}, []);

// ✅ Good — worker terminated on unmount
useEffect(() => {
  const svc = new ImageCompression();
  svcRef.current = svc;
  return () => svc.dispose();
}, []);
```

### 3. Reacting to onProgress without throttling

```tsx
// ❌ Bad — re-renders 60+ times per second
async function compress() {
  await svc.compress(file, {
    onProgress: (e) => setProgress(e.percent),  // every progress event!
  });
}

// ✅ Good — throttle with requestAnimationFrame
const progressRef = useRef(0);
async function compress() {
  await svc.compress(file, {
    onProgress: (e) => {
      if (e.percent - progressRef.current >= 5) {
        progressRef.current = e.percent;
        setProgress(e.percent);
      }
    },
  });
}
```

### 4. Not handling `CompressionError`

```ts
// ❌ Bad — generic error, no diagnostics
try {
  await svc.compress(file, options);
} catch (err) {
  console.error(err);  // "Error: Failed to decode" — not helpful
}

// ✅ Good — typed error with code + path
try {
  await svc.compress(file, options);
} catch (err) {
  if (err instanceof CompressionError) {
    console.error(`${err.code} on path ${err.path}: ${err.message}`);
    // err.code: 'DECODE_FAILED' | 'WORKER_INIT_FAILED' | 'INVALID_OPTIONS' | ...
  } else {
    throw err;  // unexpected
  }
}
```

### 5. Using `rotate`/`mirror`/`width`/`height` with workers

The cascade **skips worker paths** when manual transforms are requested (to avoid Chrome 149 "image source detached" bugs). For large files with manual transforms, consider server-side processing.

```ts
// Workers skipped — falls back to canvas-main (slower)
await svc.compress(file, { rotate: 90 });

// Workers used — fastest path
await svc.compress(file, { maxWidthOrHeight: 2048 });
```

## Migration from v0.5.x

v0.6+ broke the API in two ways:

### 1. `compress()` no longer returns a `File`

```ts
// v0.5.x
const file: File = await svc.compress(file);
// file.name === `${original-name}.jpg`

// v0.6+
const result: CompressionResult = await svc.compress(file);
const blob = result.blob;            // Blob, not File
const name = result.name;            // string, not on the blob
const file = new File([blob], name); // wrap manually
```

### 2. Observable removed

```ts
// v0.5.x (Angular-friendly)
svc.compress(file).subscribe(observer);

// v0.6+ — use compressAll() (async iterable) or single-file compress()
for await (const event of svc.compressAll([file], options)) {
  if (event.type === 'result') { ... }
}
```

Or for single file:

```ts
const result = await svc.compress(file, options);
// No observable — just a Promise<CompressionResult>
```

For Angular specifically, use the **`from()` operator** to convert:

```ts
import { from } from 'rxjs';

const result$ = from(svc.compress(file, options));
result$.subscribe(r => console.log(r));
```

### 3. RxJS removed from core

v0.6+ removed RxJS from the core library. Angular users need to wrap with `from()` themselves:

```ts
import { from } from 'rxjs';
const result$ = from(svc.compress(file, options));
```

## See also

- [`README.md`](../README.md) — Library overview
- [`BROWSER_COMPAT.md`](./BROWSER_COMPAT.md) — Per-bundler setup notes
- [Examples](../examples/) — Per-framework READMEs