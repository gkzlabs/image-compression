# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.3] - 2026-06-18

### Fixed
- **Worker paths failing when main-thread has OffscreenCanvas but Worker doesn't** — The cascade previously filtered Worker paths based on main-thread capability detection, which gave false positives on browsers where main-thread OffscreenCanvas is available but Worker-context OffscreenCanvas is not (Safari iOS, some Firefox configs, headless Chrome). The service now queries the Worker's own `getWorkerCapabilities()` and uses those for the cascade filter. The user's environment: main thread has OffscreenCanvas + Web Worker, but Worker context lacks OffscreenCanvas → cascade correctly skips `offscreen-worker` and `webcodecs-worker` paths, going straight to `canvas-main`.
- **Progress events always labeled `webcodecs-worker`** — Even when the actual path was `offscreen-worker`, the worker's emit() function and the service's "Loading worker" event always said `webcodecs-worker`. Now both reflect the actual path being tried.

### Added
- **Worker-side capability fields** in `DeviceCapabilities`:
  - `hasOffscreenCanvasInWorker` (probed from Worker)
  - `hasWebCodecsInWorker` (probed from Worker)
  - `hasCreateImageBitmapInWorker` (probed from Worker)
  - All optional — fallback to main-thread caps if not yet probed.
- **`probeWorkerCapabilities()` method** in `ImageCompression` class — non-blocking, fails gracefully.
- **Internal `__path` field** in `CompressionOptions` — tags which path the worker is executing (used by worker emit() to label progress events correctly).
- **6 new tests** in `worker-caps.test.ts` covering:
  - Main-thread has OC but Worker doesn't → cascade skips worker paths
  - Worker has OC + CIB → include offscreen-worker
  - Worker has everything → include all 3 paths
  - No worker support → only canvas-main
  - No capability at all → empty cascade
  - Worker caps fallback to main-thread caps

### Notes
- Total tests: 90 passing (up from 84), 7 skipped.
- Backward compatible: existing consumers that don't read worker-side caps see the old behavior.
- This is a **real bug fix** — without it, the cascade was wasting time trying Worker paths that would always fail.

## [0.2.2] - 2026-06-18

### Added
- **`totalPaths` field in `CompressionProgress`** — when the cascade plan is known (typically 4 paths), every subsequent progress event includes `totalPaths`. UIs can display `[N/M]` prefix to show cascade progress (e.g., `[2/4] offscreen-worker`).
- **Clearer fallback messages** — `${path} failed → trying ${nextPath} (N/M)` instead of just `Falling back from ${path}...`. The new message explicitly tells you which path failed AND which path is being tried next, removing the ambiguity of the old message.
- **3 new tests** in `progress.test.ts` verifying the type, message format, and emit() wrapper logic.

### Changed
- `service.ts` `emit()` wrapper now auto-injects `totalPaths` into every event once the cascade plan is known (DRY — paths don't need to specify it themselves).
- `service.ts` `compress()` cascade loop now passes both `path` (failed) and `attempt+1` (next) in fallback events.

### Notes
- Total tests: 84 passing (up from 79), 7 skipped.
- Backward compatible: existing consumers that don't read `totalPaths` are unaffected.
- This is a UX fix for the demo's progress log (clearer cascade visualization).

## [0.2.1] - 2026-06-18

### Fixed
- **`onProgress` not working in worker paths** — The service was stripping `onProgress` before passing to the worker (Comlink can't serialize raw functions through `postMessage`). Fixed by wrapping with `Comlink.proxy()` so the callback works across the worker boundary. Progress events now flow correctly in `webcodecs-worker` and `offscreen-worker` paths.
- **Zombie Worker in long-lived SPAs** — Added 30-second idle timeout. The Web Worker is automatically terminated after 30s of inactivity to free memory. Reset on every `compress()` call. Disable by setting `WORKER_IDLE_TIMEOUT_MS = 0` (internal constant).
- **`heic2any` missing from `peerDependencies`** — Strict package managers (pnpm, yarn pnp) would fail because `heic2any` is dynamically imported. Added to `peerDependencies` with `peerDependenciesMeta: { heic2any: { optional: true } }`.

### Changed
- **`result.blob` marked `@deprecated`** — Use `result.file` instead. `File` extends `Blob`, so all Blob methods work. Kept for backward compatibility with v0.5.x; will be removed in v1.0.
- Refactored `service.ts` to preserve `onProgress` through the Comlink layer instead of stripping it.

### Added
- 2 new tests in `onprogress.test.ts` verifying the onProgress option is preserved.

### Notes
- Total tests: 79 passing (up from 77), 7 skipped.
- Code review addressed: 1.1 (onProgress bug), 2.1 (zombie worker), 3.1 (peerDependencies), 4.2 (@deprecated).
- **Deferred to follow-up:**
  - 1.2 (single-canvas transform pipeline) — refactor to do all transforms in a single draw instead of up to 4 separate `ImageBitmap` creations. Tracked for v0.3.0.
  - 4.1 (`continueOnError` for batch) — useful but orthogonal. Tracked for v0.3.0.
  - 2.2 (img.src cleanup) — minor. Tracked for v0.2.2.

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
