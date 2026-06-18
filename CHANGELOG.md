# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
