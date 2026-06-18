# @GKz/image-compression

[![Version](https://img.shields.io/badge/version-0.1.0-blue.svg)](https://gitlab.com/guidekungz/image-compression/-/releases)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-65%20passing-brightgreen.svg)](#tests)

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
- 🧪 **Well-tested** — 65 unit tests covering all paths and edge cases
- 📱 **Mobile-friendly** — Bounded concurrency (default 2) prevents OOM on phones

## 📦 Installation

```bash
npm install @GKz/image-compression
# or via GitLab
npm install git+ssh://git@gitlab.com:guidekungz/image-compression.git
```

## 🚀 Quick Start

### Promise-based (vanilla JS)

```ts
import { ImageCompression } from '@GKz/image-compression';

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
import { compress$ } from '@GKz/image-compression';

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
import { detectCapabilities, readExifOrientation, extensionForMimeType } from '@GKz/image-compression';
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
} from '@GKz/image-compression';
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
npm test              # 65 passed, 7 skipped, 0 failing
npm run lint          # tsc clean
npm run build         # 33 dist files
```

**Coverage:**
- `service.ts` — `compress()`, `compressAll()`, cascade logic, error handling
- `stream.ts` — `compress$()`, `compressAll$()`, AsyncIterable semantics
- `types.ts` — `CompressionError`, all union types
- `capabilities.ts` — device feature detection
- `exif.ts` — JPEG EXIF orientation (1-8)
- `worker-helpers.ts` — EXIF auto-rotation, resize (real Canvas2D via @napi-rs/canvas)

**Skipped tests** (7) — require real browser environment:
- 5 tests assume Chrome 149+ environment (run via Playwright e2e)
- 2 tier-downgrade tests require real hardware mocks

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
@GKz/image-compression/
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

- **`angular-image-compression`** — Angular DI wrapper. Adds `Observable` variants, `@Injectable()` service. Depends on `@GKz/image-compression`.

## 📄 License

[MIT](LICENSE)

## 🔗 Links

- [GitLab Repository](https://gitlab.com/guidekungz/image-compression)
- [Issue Tracker](https://gitlab.com/guidekungz/image-compression/-/issues)
- [Changelog](CHANGELOG.md)
