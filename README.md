# @gkzlabs/image-compression

[![npm version](https://img.shields.io/npm/v/@gkzlabs/image-compression)](https://www.npmjs.com/package/@gkzlabs/image-compression)
[![npm downloads](https://img.shields.io/npm/dm/@gkzlabs/image-compression)](https://www.npmjs.com/package/@gkzlabs/image-compression)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![CI](https://img.shields.io/github/actions/workflow/status/gkzlabs/image-compression/ci.yml?branch=main&label=CI)](https://github.com/gkzlabs/image-compression/actions/workflows/ci.yml)
[![Deploy Examples](https://img.shields.io/github/actions/workflow/status/gkzlabs/image-compression/deploy-examples.yml?branch=main&label=examples)](https://gkzlabs.github.io/image-compression/)
[![GitHub Pages](https://img.shields.io/badge/demo-live-success)](https://gkzlabs.github.io/image-compression/)
[![Bundle Size](https://img.shields.io/bundlephobia/minzip/@gkzlabs/image-compression)](https://bundlephobia.com/package/@gkzlabs/image-compression)
[![Tests](https://img.shields.io/badge/tests-77%20passing-brightgreen.svg)](#tests)
[![Provenance](https://img.shields.io/badge/npm-provenance-blue)](https://docs.npmjs.com/generating-provenance-statements)

**🎮 [Try the live demo](https://gkzlabs.github.io/image-compression/)** — 5 framework examples (React, Vue, Svelte, Angular, Vanilla) running in your browser. No install.

> **Framework-agnostic image compression for the browser.**
> Pure web APIs. Zero framework dependencies.

A modern, progressive-enhancement image compression library that runs entirely in the browser using native Web APIs. Works with **any** frontend framework (Angular, React, Vue, Svelte) or vanilla JS.

## ✨ Features

- 🚀 **4-path cascade** — WebCodecs → OffscreenCanvas → Canvas2D → server-fallback
- 🔄 **Manual rotation** — `rotate: 0 | 90 | 180 | 270` (overrides EXIF auto-rotation)
- 🪞 **Mirror/flip** — `mirror: 'horizontal' | 'vertical'`
- 📐 **Exact resize** — `width` / `height` / `keepAspectRatio` for precise dimensions
- 🖼️ **Auto EXIF rotation** — vertical phone photos auto-orient correctly
- 🌊 **Streaming API** — `compress$()` and `compressAll$()` return native `AsyncIterable` (no RxJS needed)
- 📦 **Framework-agnostic** — Zero dependencies on Angular, React, or RxJS
- 🖼️ **HEIC decode** — Lazy-loaded via `heic2any` (optional, ~256 KB)
- ⚡ **Smart pass-through** — Skip compression for already-small JPEGs (`passThroughUnderBytes`)
- 🛑 **Cancellable** — `AbortSignal` support for clean cancellation
- 🧪 **Well-tested** — 77 unit tests covering all paths and edge cases
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
.compressAll(files: (File|Blob)[], options?, maxConcurrent?: number): Promise<CompressionResult[]>
.getCapabilities(): Promise<DeviceCapabilities>
.terminate(): void   // Stop the Web Worker
.dispose(): void     // Same as terminate (for symmetry with framework lifecycles)
```

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
  /** Strip EXIF from output (default true). Re-encoding strips most EXIF anyway */
  stripExif?: boolean;
  /** JPEG/WebP quality 0..1 (default 0.85) */
  quality?: number;
  /** Output format (default 'image/jpeg') */
  format?: OutputFormat;
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
npm test              # 77 passed, 7 skipped, 0 failing
npm run lint          # tsc clean
npm run build         # 33 dist files
```

**Coverage:**
- `service.ts` — `compress()`, `compressAll()`, cascade logic, error handling
- `stream.ts` — `compress$()`, `compressAll$()`, AsyncIterable semantics
- `types.ts` — `CompressionError`, all union types
- `capabilities.ts` — device feature detection
- `exif.ts` — JPEG EXIF orientation (1-8)
- `worker-helpers.ts` — EXIF auto-rotation, manual `applyRotation()`, exact `resizeExact()` (real Canvas2D via @napi-rs/canvas)
- `transforms.test.ts` — 12 tests for rotation, mirror, exact resize, aspect ratio

**Skipped tests** (7) — require real browser environment:
- 5 tests assume Chrome 149+ environment (run via Playwright e2e)
- 2 tier-downgrade tests require real hardware mocks

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
├── .gitlab-ci.yml
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
| ⚛️ React | [examples/react/](https://gkzlabs.github.io/image-compression/examples/react/) | [`examples/react/`](examples/react/) |
| 💚 Vue | [examples/vue/](https://gkzlabs.github.io/image-compression/examples/vue/) | [`examples/vue/`](examples/vue/) |
| 🔥 Svelte | [examples/svelte/](https://gkzlabs.github.io/image-compression/examples/svelte/) | [`examples/svelte/`](examples/svelte/) |
| 🅰️ Angular | [examples/angular/](https://gkzlabs.github.io/image-compression/examples/angular/) | [`examples/angular/`](examples/angular/) |
| 🟨 Vanilla | [examples/vanilla/](https://gkzlabs.github.io/image-compression/examples/vanilla/) | [`examples/vanilla/`](examples/vanilla/) |

**All examples** → [landing page](https://gkzlabs.github.io/image-compression/)

## 📚 Documentation

- **[Examples Overview](examples/)** — 5 framework examples (vanilla, react, vue, svelte, angular)
- **[Examples Guide](docs/EXAMPLES.md)** — Detailed framework patterns, lifecycle management, batch processing, HEIC support
- **[Browser Compatibility](docs/BROWSER_COMPAT.md)** — Per-bundler setup notes (Vite, Webpack, Rollup, esbuild)
- **[API Reference](docs/api/)** — Generated TypeDoc reference

## 📄 License

[MIT](LICENSE)

## 🔗 Links

- [GitHub Repository](https://github.com/gkzlabs/image-compression)
- [Issue Tracker](https://github.com/gkzlabs/image-compression/issues)
- [Changelog](CHANGELOG.md)
