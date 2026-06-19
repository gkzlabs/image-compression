# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.9.0] - 2026-06-19

### Fixed
- **HEIC decode: `await import('heic2any')` failed in production browser bundles**
  (Angular esbuild, Vite, etc.) because bare specifiers are not resolved at
  runtime. The cascade would skip HEIC pre-decode and return `server-fallback`
  with 0x0 dimensions on browsers without native `ImageDecoder('image/heic')`
  support. Refactored `tryDecodeHEICLazy()` to try 3 strategies in order:

  1. **Deep import** `import('heic2any/dist/heic2any.js')` — bundler-friendly
     (resolves to actual file path via `heic2any@0.0.4`'s `main` field)
  2. **Bare specifier** `import('heic2any')` — original behavior, works in
     Node and some bundlers
  3. **URL escape hatch** `import(globalThis.__IC_HEIC2ANY_URL)` — user-provided
     URL (e.g. CDN, self-hosted), works in ALL environments

  The first strategy to resolve + decode wins. All strategies failing still
  returns `null` (existing behavior — graceful fallback to `server-fallback`).

### Added
- **`__IC_HEIC2ANY_URL` global flag** — set by consumers (e.g. Angular's
  `main.ts`) to point at a known URL of `heic2any.js`. Resolved at runtime
  via dynamic `import()`.

### Changed
- **No public API changes** — `tryDecodeHEICLazy()` signature unchanged.
  Internal refactor only.

### Tests
- **3 new tests** in `heic-decode.spec.ts` (10 → 13):
  - URL escape hatch attempted when `__IC_HEIC2ANY_URL` is set
  - All 3 strategies fail → returns `null` (existing behavior)
  - URL strategy skipped when flag is not set
- **vitest.config.ts**: refactored alias from object form to array form
  with regex `{ find: /^heic2any(\/.*)?$/, replacement: heic2anyStub }`
  to match both bare specifier and deep import path.

### Notes
- 139 passing tests (was 136, +3 new). 5 skipped (unchanged).
- Backward compatible — existing consumers see no behavior change in the
  happy path (native ImageDecoder still works without heic2any).
- Companion to `angular-image-compression` v0.9.0 wrapper that adds
  `scripts/copy-heic2any.js` + `__IC_HEIC2ANY_URL` injection in `main.ts`.
- No bundle size change (heic2any is still lazy-loaded, only on HEIC paths).

## [0.4.2] - 2026-06-19

### Added
- **`calculateTier()` exported helper** in `capabilities.ts` — pure function that
  encapsulates the tier calculation logic (base tier + low-spec heuristics).
  Previously this logic was inline in `detectCapabilities()`. Now it's exported
  and unit-testable in isolation, without depending on happy-dom or the real
  browser environment. Used internally by `detectCapabilities()`.
- **`tryDecodeHEICLazy()` exported helper** in `service.ts` — was a private
  method on `ImageCompression`. Now a top-level exported function for the
  same reason (testability). The class's HEIC pre-decode step calls this
  function instead of having a private method.
- **`resolveWorker()` exported helper** in `service.ts` — was a private
  method. Now top-level for the same reason. The class's `createWorker()`
  calls this function.

### Changed
- **Test coverage: 99 → 136 passing tests** (37 new). Test files: 13 → 16 (3 new).
- **Skipped tests: 7 → 5** — the 2 tier-downgrade tests in Group 2 are removed
  (their logic is now covered by `calculateTier()` tests in `tier-calculation.spec.ts`).
  The 5 Group 1 (real Chrome 149) tests remain skipped — they require a real
  browser environment and are out of scope for unit tests.

### New tests
- **`tier-calculation.spec.ts`** (19 tests) — pure unit tests for `calculateTier()`:
  - Base tier assignment (high/mid/low for all 6 capability combinations)
  - Low-memory heuristic (1GB, 2GB, 3GB, 0GB)
  - Low-core heuristic (1, 2, 3, 8 cores)
  - Combined heuristics (low-mem + low-core, low-mem + high-core, high-mem + low-core)
  - Override guard (heuristic only applies to `high` tier, not `mid`/`low`)
- **`heic-decode.spec.ts`** (10 tests) — tests for `tryDecodeHEICLazy()`:
  - Both paths fail (no native + no heic2any) → returns null
  - Function never throws (graceful fallback)
  - Native ImageDecoder path: `isTypeSupported` is called with `'image/heic'`
  - Skips native path when `isTypeSupported` returns false
  - Falls through to heic2any when native decode throws
  - heic2any returns Blob → wrapped and returned
  - heic2any returns array → first Blob taken
  - heic2any throws → null returned
  - heic2any returns null → null returned
  - heic2any called with `toType: 'image/jpeg'`
- **`worker-resolution.spec.ts`** (8 tests) — tests for `resolveWorker()`:
  - Strategy 1: `window.__IC_WORKER_URL` override (4 variations: relative URL,
    takes precedence over standard pattern, no fall-through, absolute CDN URL)
  - Strategy 3: hard-coded fallback when `import.meta.url` throws (URL constructor
    mocked to throw), logs warning, uses `type: 'module'`
  - Integration: returns the result of `new Worker(...)`

### Notes
- 141 total tests (136 pass + 5 skip). Test runtime: ~1 second.
- Backward compatible — no breaking changes. `calculateTier`, `tryDecodeHEICLazy`,
  and `resolveWorker` are new exports but existing API surface unchanged.
- The 5 still-skipped tests (Group 1) test features that are already covered by
  the passing 136 tests, so they remain skipped as out-of-scope-for-unit-tests
  markers. They can be enabled by adding Playwright e2e tests in a future
  release.

## [0.4.1] - 2026-06-19

### Removed
- **Dead test block in `capabilities.spec.ts`** — the "iOS Safari detection (removed in v0.2.5)" `describe.skip` block (4 tests, 51 lines) tested `caps.isIOS` / `caps.isSafari` fields that were removed in v0.2.5. Removing this dead code:
  - Eliminates 3 TypeScript compile errors (Property 'isIOS'/'isSafari' does not exist on DeviceCapabilities)
  - Removes 1 skipped `describe` + 3 skipped `it` blocks
  - Improves test discoverability (no more "why is this skipped?" confusion)

### Changed
- **Re-skipped 2 tier-downgrade tests with explanation** — the "downgrades high to mid" tests (low-core, low-memory) were originally skipped because happy-dom doesn't ship OffscreenCanvas/Worker/createImageBitmap, so `detectCapabilities()` returns `tier='low'` (default) instead of `tier='high'`. The heuristic override (lines 111-114 of `capabilities.ts`) only fires when `tier === 'high'`, so the tests see `tier='low'` instead of the expected `tier='mid'`. Re-skipping with an inline comment that documents the root cause so future contributors don't try to re-enable without addressing the environment coupling.
- **Net effect: 10 skipped → 7 skipped** in the vitest suite.

### Notes
- 99 tests passing (unchanged from v0.4.0).
- No public API changes.
- No production code changes — test-only cleanup.
- The 2 re-skipped tests can be properly enabled in a follow-up by extracting the tier calculation into a pure `calculateTier()` function and unit-testing it in isolation (no happy-dom dependency). Tracked mentally, not yet scheduled.

## [0.4.0] - 2026-06-19

### Added
- **`workerPathsReliable` field** in `DeviceCapabilities` — runtime gate that controls whether the cascade includes Worker paths. Default `true` (assume reliable). Set to `false` by `probeWorkerCapabilities()` when the actual decode→draw→encode roundtrip fails in the Worker.
- **`probeWorkerPath()` method** in `ImageWorkerApi` — runs an end-to-end roundtrip (decode 1x1 PNG → draw to OffscreenCanvas → convertToBlob) inside the Worker. Catches environment-specific bugs that simple feature detection misses (Chrome "InvalidStateError: image source is detached" in module workers, Firefox broken transferToImageBitmap, etc.).
- **`probeWorkerCapabilities()` now runs both probes in parallel** — `getWorkerCapabilities()` (fast static check) and `probeWorkerPath()` (roundtrip) fire together, bounded by the same 1s timeout. This means Worker capabilities + reliability are both known before the cascade picks paths.

### Changed
- **BREAKING-ish: Worker cascade paths are re-enabled.** `selectPaths()` now includes `webcodecs-worker` and `offscreen-worker` when capabilities match AND `workerPathsReliable` is `true`. The runtime probe auto-disables them on broken browsers (e.g. affected Chrome builds) without hardcoding browser/UA lists, and auto-re-enables when the underlying bug is fixed.
- **`selectPaths()` is now `protected`** (was `private`) so subclasses (e.g. Angular wrapper, custom builds) can override the cascade logic.
- **`createWorker()` now tries `new URL('./worker', import.meta.url)` first** (modern bundler pattern — works in Vite, esbuild, Angular CLI 17+). Falls back to the hard-coded `/image-compression.worker.js?v=2` for consumers that bundle the worker to a stable URL via a postbuild script. The `window.__IC_WORKER_URL` escape hatch is still honored.
- **iOS detection in `capabilities.ts` is now SSR-safe** — guards `'ontouchend' in document` with `typeof document !== 'undefined'`. This was previously a hard crash in Next.js, Nuxt, Angular SSR, and any other SSR framework that imported `detectCapabilities()`.

### Performance
- **Worker roundtrip probe runs in parallel with the static capability probe** — both fire in the same `Promise.all`, so the combined probe takes the same wall time as the slower of the two (not the sum).

### Internal
- Refactored `createWorker()` into a separate `resolveWorker()` method for clarity (user override → standard `import.meta.url` pattern → hard-coded fallback).
- Refactored `selectPaths()` to use a `workerReliable` const for clarity.

### Notes
- Total tests: 99 passing (up from 95), 10 skipped.
- **Backward compatible**: existing consumers see no behavior change in the happy path (Worker paths now active when working, same `canvas-main` fallback when not).
- Bundle size: main 39.4 KB → unchanged. Worker: 4.6 KB → ~5.2 KB (added `probeWorkerPath`).
- **Not a breaking change** in the SemVer sense — `selectPaths` is protected (not public API), `workerPathsReliable` is optional, and the cascade still ends in `canvas-main` for broken environments. The default behavior is more permissive (Worker paths active when reliable) but no consumer code changes are required.

## [0.3.0] - 2026-06-18

### Added
- **`applyTransforms()`** — new worker-helpers function that does manual rotation + mirror + exact resize in a SINGLE OffscreenCanvas draw. Replaces 3 separate bitmap operations with 1. Saves 2 ImageBitmap allocations per compression.
- **`continueOnError` option** in `CompressionOptions` — when true, `compressAll()` continues processing files even if individual files fail. Failed files are reported via `console.warn` instead of rejecting the whole batch. Inspired by `Promise.allSettled()`. Default: `false`.

### Performance
- **Single-canvas optimization (worker)** — transforms pipeline now does decode+max-resize (1 draw) → EXIF (1 draw) → combined manual+mirror+resize (1 draw) = 3 draws instead of up to 4. Big memory savings on mobile.
- **img.src cleanup** — `HTMLImageElement.src = ''` is now set in the canvas-main fallback path (after `createImageBitmap` succeeds) so the browser can garbage-collect the image data promptly instead of waiting for the page-level GC.

### Internal
- Refactored `worker.ts` to use the new `applyTransforms()` helper
- Refactored `compressAll()` to support `continueOnError`
- Updated `capabilities.spec.ts` to use new optional worker-side capability fields

### Notes
- Total tests: 95 passing (up from 87), 10 skipped.
- Backward compatible: existing consumers see no behavior change.
- Bundle size: unchanged.

## [0.2.5] - 2026-06-18

### Fixed
- **CRITICAL: Demo hung due to worker probe hang** — `probeWorkerCapabilities()` in v0.2.3 could hang indefinitely, blocking `getCapabilities()` which blocked the entire demo (Device Capabilities section missing, compression stuck). v0.2.4 added a 2s timeout to the probe — on timeout, falls back to main-thread caps (the old v0.2.2 behavior).

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
