# @gkzlabs/image-compression

[![npm version](https://img.shields.io/npm/v/@gkzlabs/image-compression)](https://www.npmjs.com/package/@gkzlabs/image-compression)
[![npm downloads](https://img.shields.io/npm/dm/@gkzlabs/image-compression)](https://www.npmjs.com/package/@gkzlabs/image-compression)
[![npm monthly](https://img.shields.io/npm/dw/@gkzlabs/image-compression)](https://www.npmjs.com/package/@gkzlabs/image-compression)
[![Socket Badge](https://badge.socket.dev/npm/package/@gkzlabs/image-compression/latest)](https://socket.dev/npm/package/@gkzlabs/image-compression)
<!--
  Socket's live badge, from its current host `badge.socket.dev` (the older
  `socket.dev/api/badge/npm/package/...` endpoint answers non-interactive requests
  with a Cloudflare challenge, which is why it rendered broken here).
  `/latest` tracks the newest release; pin a version (`.../1.3.3`) to freeze it.
  Verified through GitHub's camo proxy: HTTP 200, image/svg+xml.
-->
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Zero Dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)](https://www.npmjs.com/package/@gkzlabs/image-compression)
[![CI](https://img.shields.io/github/actions/workflow/status/gkzlabs/image-compression/ci.yml?branch=main&label=CI)](https://github.com/gkzlabs/image-compression/actions/workflows/ci.yml)
[![Deploy Examples](https://img.shields.io/github/actions/workflow/status/gkzlabs/image-compression/deploy-examples.yml?branch=main&label=examples)](https://gkzlabs.github.io/image-compression/)
[![GitHub Pages](https://img.shields.io/badge/demo-live-success)](https://gkzlabs.github.io/image-compression/)
[![Bundle Size](https://img.shields.io/bundlephobia/minzip/@gkzlabs/image-compression)](https://bundlephobia.com/package/@gkzlabs/image-compression)
[![Tests](https://img.shields.io/badge/tests-passing-brightgreen.svg)](#tests)
[![Provenance](https://img.shields.io/badge/npm-provenance-blue)](https://docs.npmjs.com/generating-provenance-statements)

**🎮 [Try the live demo](https://gkzlabs.github.io/image-compression/)** — 5 framework examples (React, Vue, Svelte, Angular, Vanilla) running in your browser. No install.

> **Framework-agnostic image compression for the browser.**
> Pure web APIs. **Zero runtime dependencies.**

A modern, progressive-enhancement image compression library that runs entirely in the browser using native Web APIs. Works with **any** frontend framework (Angular, React, Vue, Svelte) or vanilla JS.

### 🚀 Quick Start (3 lines)

```ts
import { ImageCompression } from '@gkzlabs/image-compression';

const result = await new ImageCompression().compress(file, { maxWidthOrHeight: 2048, quality: 0.85 });
// → { file, compressedSize, width, height, mimeType, path, ... }
```

<p align="center">
  <img src="https://github.com/gkzlabs/image-compression/raw/main/docs/assets/demo-screenshot.png" alt="Live demo — compress.gkz.info" width="720">
</p>

> 🎬 **Want the full experience?** [Try the live demo](https://compress.gkz.info) (full-featured) or the [5 framework examples](https://gkzlabs.github.io/image-compression/).

## ✨ Features

- 🚀 **4-path cascade** — WebCodecs → OffscreenCanvas → Canvas2D → server-fallback
- 🎯 **Target-size mode** — `maxSizeMB` guarantees the output fits under a size budget (**binary-search quality** finds the highest usable quality, then a dimension ladder — v1.1.0 replaced the old fixed quality ladder)
- 🖼️ **AVIF / WebP / JPEG / PNG output** — `format: 'image/avif'` encodes 30-50% smaller than JPEG, with automatic fallback on browsers that can't encode AVIF
- ✨ **`qualityBoost`** — WebP/AVIF quality is raised (+0.1) so photos land near JPEG-at-`quality` size while looking sharper; low-detail content may grow (see caveat in options)
- 🪄 **`sharpen`** — optional post-resize unsharp-mask (0..1, default 0 = off) to restore edge definition lost during downscaling
- 🔍 **Multi-step downscale** — downscaling in ~50% halving steps (same technique as Sharp/Photoshop) preserves noticeably more detail than a single one-shot draw
- 🔄 **Manual rotation** — `rotate: 0 | 90 | 180 | 270` (overrides EXIF auto-rotation) — **runs in the Worker since v1.2.0**, so transforms on large files don't jank the UI thread
- 🪞 **Mirror/flip** — `mirror: 'horizontal' | 'vertical'`
- 📐 **Exact resize** — `width` / `height` / `keepAspectRatio` for precise dimensions
- 🖼️ **Auto EXIF rotation** — vertical phone photos auto-orient correctly
- 🌊 **Streaming API** — `compress$()` and `compressAll$()` return native `AsyncIterable` (no RxJS needed)
- 🖼️ **Responsive `<picture>` in one call** — `toPictureSet()` encodes AVIF/WebP + JPEG fallback, skips formats the engine can't produce, and returns markup + object URLs (v1.3.3)
- ⚙️ **Bounded batch parallelism** — `options.maxConcurrency` on `compressAll()` / `compressAll$()` (v1.3.3; the old positional argument still works)
- 📦 **Framework-agnostic** — Zero dependencies on Angular, React, or RxJS
- 🖼️ **HEIC decode** — native `ImageDecoder` first, else the optional `heic2any` decoder (declared optional peer) or any decoder module via `__IC_HEIC2ANY_URL`
- ⚡ **Smart pass-through** — Skip compression for already-small JPEGs (`passThroughUnderBytes`)
- 🛑 **Cancellable** — `AbortSignal` support for clean cancellation
- 🧪 **Well-tested** — 262 unit tests + two real-browser suites (worker thread evidence, pixel checks)
- 📱 **Mobile-friendly** — Bounded concurrency (default 2) prevents OOM on phones

## 📦 Installation

```bash
npm install @gkzlabs/image-compression
# or install directly from GitHub
npm install git+ssh://git@github.com/gkzlabs/image-compression.git
```

## 🚀 Quick Start

### Promise-based (vanilla JS)

```ts
import { ImageCompression } from '@gkzlabs/image-compression';

const svc = new ImageCompression();
const result = await svc.compress(file, { quality: 0.85, maxWidthOrHeight: 2048 });

console.log(result.file.name);      // "photo.jpg"
console.log(result.path);            // "webcodecs-worker" | "offscreen-worker" | "canvas-main" | "server-fallback"
console.log(result.compressedSize);  // bytes

// Cleanup when done
svc.dispose();
```

### Streaming (AsyncIterable)

```ts
import { compress$ } from '@gkzlabs/image-compression';

for await (const evt of compress$(file, { quality: 0.85 }, svc)) {
  if ('percent' in evt) {
    // CompressionProgress
    console.log(`[${evt.percent}%] ${evt.stage}`);
  } else {
    // CompressionResult
    console.log('Done:', evt.file.name);
  }
}
```

### Angular (wrapper package)

```ts
import { ImageCompressionService } from 'angular-image-compression';

@Component({ ... })
export class MyComponent {
  private svc = inject(ImageCompressionService);

  async onFile(file: File) {
    const result = await this.svc.compress(file, { quality: 0.85 });
    // Observable variants: this.svc.compress$(file).subscribe(...)
  }
}
```

## 📊 API Surface

### `ImageCompression` class

```ts
new ImageCompression();
.compress(file: File | Blob, options?: CompressionOptions): Promise<CompressionResult>
.compressAll(files: (File|Blob)[], options?, maxConcurrent?): Promise<(CompressionResult|null)[]>
.getCapabilities(): Promise<DeviceCapabilities>
.terminate(): void   // Stop the Web Worker
.dispose(): void     // Same as terminate (for symmetry with framework lifecycles)
```

> **`compressAll()` return type:** with `continueOnError: true`, failed files
> appear as `null` in the returned array (same position as the input) — always
> null-check each element. With the default `continueOnError: false`, the batch
> rejects on the first failure, so a resolved array never contains `null`.

### `compress$()` / `compressAll$()` streams

```ts
compress$(file, options, svc): AsyncIterable<CompressionProgress | CompressionResult>
compressAll$(files, options, maxConcurrent, svc): AsyncIterable<BatchProgress | CompressionResult[]>
```

### Utilities

```ts
import {
  detectCapabilities,
  readExifOrientation,
  extensionForMimeType,
  applyExifOrientation,
  applyRotation,
  resizeExact,
} from '@gkzlabs/image-compression';
```

### Transform Helpers (low-level)

For advanced use cases (e.g., custom compression pipelines), the rotate/resize helpers are exported:

```ts
import { applyRotation, resizeExact } from '@gkzlabs/image-compression';

// Manual rotation (degrees CW) + optional mirror
const { bitmap, width, height } = applyRotation(bitmap, 90, 'horizontal');

// Exact resize (width, height, keepAspectRatio)
const { bitmap, width, height } = resizeExact(bitmap, 800);              // width only
const { bitmap, width, height } = resizeExact(bitmap, undefined, 600);    // height only
const { bitmap, width, height } = resizeExact(bitmap, 200, 200, true);   // fit-within
```

### Options

```ts
interface CompressionOptions {
  /** Max width or height — fit-within-box resize (default 2048) */
  maxWidthOrHeight?: number;
  /** Exact target width (overrides maxWidthOrHeight). Height auto if height is omitted */
  width?: number;
  /** Exact target height (overrides maxWidthOrHeight). Width auto if width is omitted */
  height?: number;
  /** When both width+height are set: fit-within-box instead of stretching (default false) */
  keepAspectRatio?: boolean;
  /** Manual rotation in degrees CW: 0 | 90 | 180 | 270. Set 0 to disable EXIF auto-rotation */
  rotate?: 0 | 90 | 180 | 270;
  /** Mirror/flip after rotation: 'horizontal' | 'vertical' */
  mirror?: 'horizontal' | 'vertical';
  /**
   * @deprecated No-op — re-encoding always discards EXIF/XMP/GPS, and this
   * option is not read by the pipeline. Use `passThroughUnderBytes` to keep
   * originals (and their metadata) untouched.
   */
  stripExif?: boolean;
  /** JPEG/WebP/AVIF quality 0..1 (default 0.85) */
  quality?: number;
  /**
   * Target maximum output size in MB — re-encodes until the output fits.
   * v1.1.0: **binary search** finds the highest quality that still fits
   * the budget (instead of the old fixed quality ladder, which overshot
   * and wasted quality), then a dimension ladder (down to 50%). Returns
   * the best result that meets the target, or the smallest achievable
   * with a warning.
   */
  maxSizeMB?: number;
  /** Output format: 'image/jpeg' | 'image/webp' | 'image/png' | 'image/avif' (default 'image/jpeg') */
  format?: OutputFormat;
  /**
   * Post-resize sharpening strength 0..1 (default 0 = off). A light
   * unsharp mask restores edge definition lost during downscaling.
   *   0.2 subtle · 0.5 noticeable · 1 strong
   * Runs on the main thread before encoding (canvas-only; ignored for
   * lossless PNG). See the benchmark feature comparison for cost.
   */
  sharpen?: number;
  /**
   * When the output format is WebP/AVIF, map `quality` up (+0.1, e.g.
   * 0.85 → 0.95). On typical photos (WebP ~30% smaller than JPEG at
   * equal quality) the boosted output lands near the JPEG-at-`quality`
   * size while being visibly sharper. On low-detail content (flat
   * graphics, screenshots) the WebP advantage shrinks and the output
   * can grow 1.5-2× — measure with your own content. Default false.
   */
  qualityBoost?: boolean;
  /** Force server-side processing (skip client compression) */
  forceServer?: boolean;
  /** Force a specific path: 'webcodecs-worker' | 'offscreen-worker' | 'canvas-main' | 'server-fallback' */
  forcePath?: CompressionPath;
  /** Skip compression if file is small + already in target format */
  passThroughUnderBytes?: number;
  /** AbortSignal for cancellation */
  signal?: AbortSignal;
  /** Progress callback */
  onProgress?: (progress: CompressionProgress) => void;
}
```

### Types

```ts
import type {
  CompressionOptions,
  CompressionResult,
  CompressionProgress,
  CompressionError,
  DeviceCapabilities,
  CompressionPath,
  OutputFormat,
  DeviceTier,
} from '@gkzlabs/image-compression';
```

## 🆚 vs `browser-image-compression`

The most popular browser compression lib (~6M downloads/month). Here's how
`@gkzlabs/image-compression` compares:

| Capability | **@gkzlabs/image-compression** | browser-image-compression |
|---|---|---|
| Runtime dependencies | **0** (self-contained RPC + Worker) | 1 (`uzip`) |
| Worker encode path | **WebCodecs + OffscreenCanvas** (hardware-accelerated) | Canvas2D |
| Output formats | **JPEG / WebP / PNG / AVIF** (auto-fallback if encoder unsupported) | JPEG / WebP / PNG |
| Target file size (`maxSizeMB`) | ✅ quality + dimension ladder | ✅ quality iteration only |
| HEIC decode | ✅ native ImageDecoder + WASM fallback | ❌ no |
| Transforms (rotate/mirror/exact size) | ✅ main-thread, Chrome-149-safe | partial (EXIF only) |
| Streaming API | ✅ `AsyncIterable` (no RxJS) | ❌ callback only |
| Cancellation | ✅ `AbortSignal` | ✅ |
| Batch with bounded concurrency | ✅ `compressAll()` (anti-OOM) | ❌ manual loop |
| Bundle (main, brotlied) | **~14 KB** | ~30 KB+ |
| Framework examples | 5 (Angular/React/Vue/Svelte/Vanilla) | docs only |

**TL;DR** — same core job, but ours is smaller, zero-dependency, encodes AVIF,
decodes HEIC, exposes a streaming API, and runs the resize/encode on WebCodecs
when available. If you only need a simple JPEG shrink, either works; if you
need format conversion, HEIC support, or hard size guarantees, this library
fits better.

## 🎯 Which output format should I use?

Measured on the same 1920×1080 landscape photo (libwebp 1.3 / libaom 3.8):

| Format | Size vs JPEG | Encode speed (4K) | Browser support |
|---|---|---|---|
| `image/jpeg` | baseline | 0.12s (fastest) | 100% |
| **`image/webp`** ⭐ | **−28 to −33%** | 0.48s (fast) | 99.1% |
| `image/avif` | −63 to −70% | 2.84s+ (**24× slower**) | 96.4% (decode) |

**Recommendation for client-side compression (this library's use case):**

- ⭐ **Use `image/webp`** for uploads. It's ~30% smaller than JPEG with
  essentially the same encode cost (0.48s vs 0.12s on 4K), and every modern
  browser supports it. This is the best size/speed trade-off for real-time
  browser compression.
- `image/jpeg` — only when the downstream server/API requires JPEG exactly.
- `image/avif` — technically the smallest (−50% vs WebP), but **AVIF encode is
  24× slower than WebP** (2.84s minimum even at max speed on an M2, longer on
  phones) and still requires a 3MB+ WASM encoder outside Chromium 130+. It
  shines for **server-side / build-time pre-generation**, not real-time
  client-side compression. The library will encode AVIF natively where the
  browser supports it (Chromium 130+) and transparently fall back to WebP/JPEG
  elsewhere — but for uploads, WebP is the pragmatic default.
- `image/png` — only for lossless / transparency needs (largest output).

## 🌐 Browser Support

| Browser | Minimum | Notes |
|---|---|---|
| Chrome / Edge | 94+ | Best path (WebCodecs + OffscreenCanvas) |
| Safari (macOS) | 16.3+ | OffscreenCanvas + Canvas2D cascade |
| Safari (iOS) | 16.3+ | HEIC native decode (16.4+) |
| Firefox | 105+ | OffscreenCanvas fallback |
| Opera | 80+ | Chromium-based, same as Chrome |

**Tier system:**
- **`high`** — Chrome/Edge with WebCodecs + OffscreenCanvas + 4+ cores + 4GB+ RAM
- **`mid`** — Safari 16.3+ with OffscreenCanvas, 2+ cores
- **`low`** — Any other browser. Falls back to `canvas-main` (main thread) or `server-fallback`

## 🧪 Tests

```bash
npm test              # 262 passed, 5 skipped, 0 failing
npm run test:coverage # v8 coverage + threshold gate (lines/stmts ≥70, branches ≥70, funcs ≥85)
npm run test:browser  # real Chromium: every cascade path, __IC_WORKER_URL, worker-404 fallback
npm run test:worker   # real Chromium: worker-thread evidence, pixel checks, mid-flight dispose
npm run lint          # tsc clean
npm run build         # ESM + CJS bundle + worker
```

**Coverage:**
- `service.ts` — `compress()`, `compressAll()`, cascade logic, error handling
- `stream.ts` — `compress$()`, `compressAll$()`, AsyncIterable semantics
- `types.ts` — `CompressionError`, all union types
- `capabilities.ts` — device feature detection
- `exif.ts` — JPEG EXIF orientation (1-8)
- `worker-helpers.ts` — EXIF auto-rotation, manual `applyRotation()`, exact `resizeExact()`, multi-step `downscaleInSteps()`, `applySharpen()` (real Canvas2D via @napi-rs/canvas)
- `quality.spec.ts` — v1.1.0 features: multi-step downscale, sharpen, qualityBoost, no-hang guards for 0/NaN/negative targets
- `applyTransforms.spec.ts` — 11 tests for rotation, mirror, exact resize, aspect ratio
- `rpc.spec.ts` — worker RPC protocol, including the fail-fast path when a worker never loads
- `worker-resolution.spec.ts` — the 3 worker-URL strategies (`__IC_WORKER_URL`, `new URL(..., import.meta.url)`, page-relative fallback)

**Skipped tests** (5) — need a real browser/hardware:
- 3 tests assume a Chrome 149+ environment. There is **no Playwright/JSDOM e2e
  suite in CI** yet: unit tests run under `happy-dom` with `@napi-rs/canvas` as a
  Canvas2D polyfill, so real `Worker` / `OffscreenCanvas` / WebCodecs paths are
  exercised by `npm run bench` (headless Chromium via Puppeteer) rather than by
  `npm test`. Adding a browser matrix is tracked as the next CI improvement.
- 2 tier-downgrade tests require real hardware mocks (happy-dom reports no
  `deviceMemory`/`hardwareConcurrency`, so `detectCapabilities()` returns `low`)

## 🔄 Transform Order

When multiple transforms are specified, they're applied in this order:

```
1. EXIF auto-rotation      (unless rotate is explicitly set)
2. Manual rotate           (rotate: 90 | 180 | 270)
3. Mirror                  (mirror: 'horizontal' | 'vertical')
4. Resize                  (width/height/maxWidthOrHeight)
5. Encode                  (format: 'image/jpeg' | 'image/webp' | 'image/png')
```

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────┐
│  ImageCompression (Promise API)                 │
│  ─────────────────────────────                  │
│  • getCapabilities()  (lazy, cached)            │
│  • compress()         (single file)             │
│  • compressAll()      (batched, maxConcurrent)  │
└──────────────────┬──────────────────────────────┘
                   │
        ┌──────────┴──────────┐
        │                     │
        ▼                     ▼
┌────────────────┐   ┌─────────────────────────┐
│ compress$()    │   │ compressAll$()          │
│ ─────────────  │   │ ────────────────────    │
│ AsyncIterable  │   │ AsyncIterable           │
│ Progress +     │   │ Per-file progress       │
│ Result         │   │ + final result array    │
└────────────────┘   └─────────────────────────┘
                   │
                   ▼
        ┌─────────────────────────────┐
        │  4-path cascade             │
        │  1. webcodecs-worker         │
        │  2. offscreen-worker         │
        │  3. canvas-main              │
        │  4. server-fallback          │
        └─────────────────────────────┘
```

## 📂 Project Structure

```
@gkzlabs/image-compression/
├── src/
│   ├── index.ts             # Public API
│   ├── service.ts           # ImageCompression class
│   ├── stream.ts            # AsyncIterable wrappers
│   ├── types.ts             # All types + CompressionError
│   ├── capabilities.ts      # detectCapabilities()
│   ├── exif.ts              # readExifOrientation()
│   ├── worker.ts            # Worker source
│   ├── worker-helpers.ts    # EXIF rotation + resize
│   ├── webcodecs.d.ts       # Type defs for WebCodecs
│   └── __stubs__/           # Test stubs
├── test/                    # Real-browser verification (Puppeteer)
│   ├── browser-smoke.mjs    # all cascade paths + worker-404 fallback
│   └── angular-cli-e2e.mjs  # Angular CLI production build (hostile bundler)
├── examples/                # react, vue, svelte, angular (Vite) + angular-cli
├── dist/                    # Built output (ESM)
├── package.json
├── tsconfig.json
├── tsconfig.build.json
├── tsconfig.test.json
├── vitest.config.ts
├── vitest.setup.ts          # Polyfills for tests
├── .editorconfig
├── .gitattributes
├── .gitignore
├── .gitlab-ci.yml           # ARCHIVED — GitHub Actions is the only CI
├── LICENSE                  # MIT
├── CHANGELOG.md
├── README.md
├── CONTRIBUTING.md
└── SECURITY.md
```

## 🤝 Related Packages

- **`angular-image-compression`** — Angular DI wrapper. Adds `Observable` variants, `@Injectable()` service. Depends on `@gkzlabs/image-compression`.

## 🎮 Live Demo

Try it in your browser — no install needed:

| Framework | Live Demo | Source |
| --- | --- | --- |
| <img src="https://raw.githubusercontent.com/gkzlabs/image-compression/main/docs/assets/logos/react.svg" width="18" height="18" valign="middle" alt="React"> React | [examples/react/](https://gkzlabs.github.io/image-compression/examples/react/) | [`examples/react/`](https://github.com/gkzlabs/image-compression/tree/main/examples/react/) |
| <img src="https://raw.githubusercontent.com/gkzlabs/image-compression/main/docs/assets/logos/vue.svg" width="18" height="18" valign="middle" alt="Vue"> Vue | [examples/vue/](https://gkzlabs.github.io/image-compression/examples/vue/) | [`examples/vue/`](https://github.com/gkzlabs/image-compression/tree/main/examples/vue/) |
| <img src="https://raw.githubusercontent.com/gkzlabs/image-compression/main/docs/assets/logos/svelte.svg" width="18" height="18" valign="middle" alt="Svelte"> Svelte | [examples/svelte/](https://gkzlabs.github.io/image-compression/examples/svelte/) | [`examples/svelte/`](https://github.com/gkzlabs/image-compression/tree/main/examples/svelte/) |
| <img src="https://raw.githubusercontent.com/gkzlabs/image-compression/main/docs/assets/logos/angular.svg" width="18" height="18" valign="middle" alt="Angular"> Angular | [examples/angular/](https://gkzlabs.github.io/image-compression/examples/angular/) | [`examples/angular/`](https://github.com/gkzlabs/image-compression/tree/main/examples/angular/) |
| <img src="https://raw.githubusercontent.com/gkzlabs/image-compression/main/docs/assets/logos/javascript.svg" width="18" height="18" valign="middle" alt="Vanilla JS"> Vanilla | [examples/vanilla/](https://gkzlabs.github.io/image-compression/examples/vanilla/) | [`examples/vanilla/`](https://github.com/gkzlabs/image-compression/tree/main/examples/vanilla/) |

**All examples** → [landing page](https://gkzlabs.github.io/image-compression/)

## 📚 Documentation

- **[Examples Overview](https://github.com/gkzlabs/image-compression/tree/main/examples)** — 5 framework examples (vanilla, react, vue, svelte, angular)
- **[Examples Guide](https://github.com/gkzlabs/image-compression/blob/main/docs/EXAMPLES.md)** — Detailed framework patterns, lifecycle management, batch processing, HEIC support
- **[Browser Compatibility](https://github.com/gkzlabs/image-compression/blob/main/docs/BROWSER_COMPAT.md)** — Per-bundler setup notes (Vite, Webpack, Rollup, esbuild)
- **[Server Fallback](https://github.com/gkzlabs/image-compression/blob/main/docs/SERVER_FALLBACK.md)** — How to build the server endpoint for `server-fallback` results (sharp + Node reference)
- **[API Reference](https://github.com/gkzlabs/image-compression/tree/main/docs/api)** — Generated TypeDoc reference
- **[Benchmarks](https://github.com/gkzlabs/image-compression/blob/main/bench/results/BENCHMARKS.md)** — Real-world performance numbers for all 3 cascade paths

## ⚡ Benchmarks

Run `npm run bench` to measure `webcodecs-worker` vs `offscreen-worker` vs `canvas-main` on your machine, plus the **v1.1.0 feature comparison** (cost of `sharpen`, `qualityBoost`, multi-step downscale, binary-search target-size — each feature measured on vs off). Latest numbers in the [📊 live dashboard](https://gkzlabs.github.io/image-compression/bench/) (interactive Chart.js view) or [raw BENCHMARKS.md](https://github.com/gkzlabs/image-compression/blob/main/bench/results/BENCHMARKS.md).

## 📄 License

[MIT](LICENSE)

## 🔗 Links

- [GitHub Repository](https://github.com/gkzlabs/image-compression)
- [Issue Tracker](https://github.com/gkzlabs/image-compression/issues)
- [Changelog](https://github.com/gkzlabs/image-compression/blob/main/CHANGELOG.md)
