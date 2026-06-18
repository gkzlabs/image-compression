# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-06-18

### Added
- **`rotate` option** — manual rotation in degrees clockwise (`0 | 90 | 180 | 270`). Override EXIF auto-rotation.
- **`mirror` option** — flip image (`'horizontal' | 'vertical'`). Applied after rotation.
- **`width` / `height` options** — exact target dimensions for resize.
  - Only `width`: height auto-computed (preserves aspect ratio)
  - Only `height`: width auto-computed (preserves aspect ratio)
  - Both + `keepAspectRatio: true`: fit-within-box (letterbox if needed)
  - Both + `keepAspectRatio: false` (default): stretch to exact
- **`keepAspectRatio` option** — preserve aspect ratio when both width+height are set.
- **`stripExif` option** — strip EXIF metadata from output (default: `true`). Re-encoding always strips most EXIF data; pass-through returns original unchanged.
- **Utility exports** — `applyExifOrientation()`, `applyRotation()`, `resizeExact()` now exported from `worker-helpers`.
- **12 new tests** in `transforms.test.ts` covering rotation, mirror, exact resize, aspect ratio, and combined transforms.

### Internal
- Refactored `canvas-main` path to use the same `applyExifOrientation()`, `applyRotation()`, `resizeExact()` helpers as the worker paths (consistency + less duplicated code).
- `worker.ts` now applies manual rotation AFTER EXIF auto-rotation (or instead of it, if `rotate` is set).
- Order of transforms: EXIF auto-rotation (if not overridden) → manual rotation → mirror → resize → encode.

### Notes
- Manual rotation is applied AFTER EXIF auto-rotation. Setting `rotate: 0` disables EXIF auto-rotation entirely.
- Total tests: 77 passing (up from 65), 7 skipped (browser-only).
- New test file: `src/transforms.test.ts`.

## [0.1.0] - 2026-06-18

### Added
- Initial release of `@GKz/image-compression` framework-agnostic core
- `ImageCompression` class with Promise-based API (`compress`, `compressAll`, `getCapabilities`)
- `compress$()` and `compressAll$()` — native `AsyncIterable` streaming API (no RxJS dependency)
- 4-path cascade: `webcodecs-worker` → `offscreen-worker` → `canvas-main` → `server-fallback`
- HEIC decode via lazy `heic2any` import (optional, ~256 KB)
- `passThroughUnderBytes` smart-skip option (skips compression for already-small JPEGs)
- `AbortSignal` support for clean cancellation
- `forceServer` and `forcePath` options for explicit path control
- `CompressionError` class with machine-readable codes (`HEIC_UNSUPPORTED`, `WORKER_INIT_FAILED`, `ALL_PATHS_FAILED`, `ABORTED`, `INVALID_FILE`, `INVALID_OPTIONS`, `FILE_TOO_LARGE`, `UNKNOWN`)
- Type guards: `isCompressionResult`, `isBatchResult`
- Utilities: `detectCapabilities`, `readExifOrientation`, `extensionForMimeType`
- Full TypeScript types (no `any` in public API)
- 65 unit tests via Vitest + `@napi-rs/canvas` polyfill
- ESM build output (33 dist files)

### Browser Support
- Chrome / Edge 94+ (best path with WebCodecs)
- Safari 16.3+ macOS / iOS (OffscreenCanvas + HEIC native on iOS 16.4+)
- Firefox 105+ (OffscreenCanvas fallback)
- Any other browser → falls through to `server-fallback`

### Notes
- Zero framework dependencies (no Angular, no React, no RxJS)
- Pure web APIs: Worker, OffscreenCanvas, Comlink, WebCodecs
- Bundle: ~44 KB (gzipped) for the core lib, +256 KB if `heic2any` is installed
