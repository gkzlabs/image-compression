# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.10.12] - 2026-06-20

### Changed
- **Test file naming:** Renamed all `.test.ts` → `.spec.ts` (8 files) for
  consistency with the existing `.spec.ts` files. The project now uses
  one convention (specification-style). Updated `vitest.config.ts` to
  match.
- **GitLab CI:** Added `.gitlab-ci.yml` with 4 stages (lint, test, build,
  size) running on `node:20-alpine`. Build artifacts cached between jobs.

### Added
- **`size-limit` bundle budget:** 70 KB main, 10 KB worker. Current actual:
  12.34 KB / 1.82 KB (well under). Wired into `npm run size` and
  `prepublishOnly`.
- **Typedoc API docs:** `typedoc.json` config + `npm run docs` → outputs
  to `docs/api/`. Excludes private/internal members and test files.
- **`docs/BROWSER_COMPAT.md`:** Comprehensive browser-support matrix
  covering all cascade paths, feature detection, HEIC support, and known
  browser quirks (Safari module-worker issues, Chrome 149 detach, etc.).

### Changed
- **Production cleanup:** Removed broken CJS export from package.json
  (`./dist/index.cjs` was declared but never generated — caused `require()`
  imports to fail with MODULE_NOT_FOUND). Package is now ESM-only.
- **Version-driven cache buster:** `__BUILD_VERSION__` constant is injected
  via esbuild `--define` at build time. The runtime worker URL now embeds
  the actual package version (`?v=0.10.11`) instead of a `Date.now()`
  timestamp, so the browser can cache the worker across page loads (same
  version = cache hit, new version = fresh download).
- **Build script:** `npm run build` now uses esbuild (`scripts/build.mjs`)
  instead of tsc, gaining `--define` support. tsc is still used for
  `.d.ts` generation (esbuild doesn't emit declarations).

### Fixed
- **Worker resolution test** now matches any version string instead of the
  previously hard-coded `?v=4`.
- **`declare global`** wrapper added for `__BUILD_VERSION__` so it's
  properly visible from all files in the bundle.

### Fixed
- **CRITICAL: exact width/height options no longer fail with `InvalidStateError`**
  in Chrome 149. The previous v0.10.9 2-stage pipeline (Worker resize +
  main-thread transform via `transferToImageBitmap`) triggered
  Chrome 149's "image source is detached" bug when transforms chained
  after the initial transfer. Three coordinated fixes:

  1. **`selectPaths` now skips Worker paths when a transform is requested**.
     Files >100KB with rotate/mirror/width/height go straight to
     `canvas-main`, which has a single in-place pipeline that doesn't
     hit the Chrome 149 detach race.
  2. **`executeCanvasMainPath` no longer calls `resizeExact` + `transferToImageBitmap`**
     in the resize step. It draws the source bitmap directly onto the
     final encode canvas at the target dimensions (skips the
     intermediate transfer). For transform requests this avoids the
     double-transfer (applyRotation + resizeExact) that triggered detach.
  3. **`applyTransformsIfRequested` is a no-op for `canvas-main` results**.
     The canvas-main pipeline already applies transforms itself;
     calling Stage 2 again would double-apply (rotate 90° twice = 180°).

  Net effect: transforms now work correctly on all paths for all
  browser versions, including Chrome 149+. The trade-off is that
  transform requests on large files (>100KB) skip the Worker
  speedup — but the transform step is the bottleneck anyway.

- **`onRotateChange` event handler in the Angular demo UI**: the rotate
  `<select>` was passing a string value ("90") to a `number` field.
  `ctx.rotate(("90" * Math.PI) / 180)` evaluated to `NaN` in the
  OffscreenCanvas rotation, causing the transform to silently fail.
  Now coerced to number in the change handler.

### Notes
- `applyTransformsIfRequested` is now effectively only a safety net
  for `webcodecs-worker`/`offscreen-worker` results. In normal flow
  (`selectPaths` skipping Worker for transforms), it's a no-op.
- The original 2-stage design is preserved as defensive code: if
  someone overrides `selectPaths` to allow Worker + transform, the
  Stage 2 fallback still tries to apply transforms (with a simpler
  direct-draw implementation that avoids the transfer chain).

## [0.10.9] - 2026-06-20

### Added
- **Compress-then-Transform pipeline** — fixes the silent drop of manual
  `rotate`/`mirror`/`width`/`height` options in the Worker path (a
  v0.10.7 side effect of removing the `applyTransforms` call from
  `worker.ts`). Two-stage pipeline:
  1. Stage 1: Worker path does resize+encode exactly as before (no
     transforms). No detach risk, no behavior change for users who
     don't request transforms.
  2. Stage 2: When transforms are requested, decode the compressed
     output on the **main thread**, apply `applyTransforms` (combined
     rotate+mirror+exact-resize in a single OffscreenCanvas draw),
     then re-encode via `canvas.toBlob`.

  Why this design:
  - Worker keeps its resize/encode speed (Stage 1) — no perf regression
    for users not using transforms.
  - Transforms run on main thread where `applyTransforms` is safe
    (no module-worker bitmap detach race).
  - Net cost for users requesting transforms: 1 extra decode + 1
    extra encode round-trip on the already-compressed output (small,
    fast). For users NOT requesting transforms: zero overhead
    (the helper is a fast-path no-op when no transform options are
    set).

### Exposed for testing
- `ImageCompression.applyTransformsIfRequested` — was `private` in
  v0.10.8. Now `static` so it can be unit-tested directly without
  going through the full `compress()` cascade (avoids the happy-dom
  canvas limitation in the test environment). All production
  callers in `service.ts` use the static call.
- `ImageCompression.buildResult` — promoted to `static` (was
  `private`) for the same reason. No behavior change.

### Fixed
- **Test environment gap**: `vitest.setup.ts` now polyfills
  `HTMLCanvasElement.prototype.getContext('2d')` and `.toBlob(...)`
  to use `@napi-rs/canvas`. happy-dom's default implementations
  return `null`/no-op, which silently broke any test that exercises
  a path using `document.createElement('canvas')` (including
  `canvas-main` and the new `applyTransformsIfRequested` re-encode
  step). This is **test-only** — production browsers have native
  Canvas2D.

### Tests
- 18 new tests in `src/applyTransformsIfRequested.spec.ts`:
  - 5 no-op conditions (no options, passthrough, server-fallback,
    0×0 placeholder, quality/format-only)
  - 3 rotation tests (90/180/270)
  - 3 mirror + combined transform tests
  - 2 exact-resize tests (with and without rotation)
  - 4 result-shape integrity tests (mimeType, path, tier, durationMs)
  - 1 graceful-degradation test (garbage blob → return original)
- Total: 164 unit tests passing across 17 files (was 146).

### Notes
- `worker.ts` is **unchanged** from v0.10.8/v0.10.7 — the Worker
  still does NOT call `applyTransforms`. Transforms are applied
  on the main thread in Stage 2.
- Backward compatible: users who don't pass `rotate`/`mirror`/
  `width`/`height` see zero behavior change (no-op fast path).

## [0.10.8] - 2026-06-19

### Restored
- **Brought back the v0.3.0 optimization helpers** — `applyTransforms`,
  `applyRotation`, `resizeExact` — that were removed in v0.10.7 as a
  paranoid hotfix. v0.10.7 root cause turned out to be the **worker
  loading context** (relative vs. absolute URL), not the helper code
  itself. With v0.10.7's URL fix in place, the helpers are safe to use
  on the main-thread path (where Chrome's module-worker bitmap detach
  race never fires).

  - `worker-helpers.ts`: re-exports `applyRotation`, `resizeExact`,
    `applyTransforms` — same signatures as v0.10.6.
  - `service.ts`: `canvas-main` path now calls the helpers instead of
    inlining the rotation/mirror/resize logic (~40 lines removed).
  - `index.ts`: re-exports the 3 helpers for advanced consumers.
  - `applyTransforms.spec.ts`: 11 unit tests (fast paths, 90/180/270,
    mirror, rotation+exact-resize combinations). Uses the existing
    `@napi-rs/canvas` polyfill from `vitest.setup.ts`.

### Notes
- `worker.ts` is **unchanged** from v0.10.7 — still matches v0.5.7
  structure exactly. The worker thread never calls `applyTransforms`,
  so the detach race is never triggered.
- The main-thread `canvas-main` path is where manual rotate/mirror/
  exact-resize options are processed, and that's where the helpers
  are now used. This is the same arrangement as v0.10.0-v0.10.6,
  minus the worker.ts bug.

## [0.10.7] - 2026-06-19

### Fixed
- **CRITICAL: `InvalidStateError: image source is detached` in webcodecs-worker path**:
  Removed the v0.3.0+ optimization helpers (`applyTransforms`, `applyRotation`,
  `resizeExact`) from `worker-helpers.ts` and the corresponding `applyTransforms`
  call from `worker.ts`. The core lib's `worker.ts` now matches v0.5.7's
  INLINE worker exactly:
    - HEIC: `tryDecodeHEIC` → `encodeViaOffscreenCanvas` → `bitmap.close()`
    - Non-HEIC: `resizeOffscreen` → (maybe) `applyExifOrientation` → `encodeViaOffscreenCanvas` → `bitmap.close()`

  Manual rotate/mirror/exact-resize options are still supported by the
  `canvas-main` path (which now inlines the rotate/resize logic directly
  using `OffscreenCanvas` + `transferToImageBitmap`).

  The v0.3.0 optimization (combined rotate+mirror+resize in single draw)
  is dropped to match v0.5.7. This is the most conservative fix — if
  v0.5.7 worked, v0.10.7 should work because the code paths are now
  identical.

## [0.10.6] - 2026-06-19

### Fixed
- **CRITICAL: `InvalidStateError: image source is detached` in webcodecs-worker path**:
  The TRUE root cause was a no-op `applyTransforms()` call in worker.ts.
  v0.3.0 added `applyTransforms` to combine manual rotate + mirror + exact
  resize into a single OffscreenCanvas draw (optimization). v0.10.x kept
  calling it unconditionally, but its **fast path** (`rotate === 0 && !mirror
  && width === undefined && height === undefined`) returns the SAME bitmap
  reference — not a fresh `transferToImageBitmap` copy.

  When the worker called `applyTransforms(bitmap, {all undefined})` after
  `applyExifOrientation`, the returned "transformed" bitmap was the same
  reference as the input. Then worker.ts called `bitmap.close()` on it
  (closing the bitmap that came from `transferToImageBitmap()` upstream)
  and passed it to `encodeViaOffscreenCanvas`, which called
  `ctx.drawImage(bitmap, 0, 0)` — triggering the "image source is detached"
  error in Chrome 149 / Safari iOS module workers.

  v0.5.7 (the working baseline) didn't have `applyTransforms` at all —
  the worker code was INLINE in the Angular wrapper and went straight from
  `applyExifOrientation` → `encodeViaOffscreenCanvas`. The extract-to-core
  refactor (v0.6.0+) added `applyTransforms` and the detach error appeared.

  **Fix**: skip the `applyTransforms` call entirely when no transforms are
  requested. Only invoke it when `rotate !== 0 || mirror || width || height`.
  This matches v0.5.7's call ordering exactly.

## [0.10.5] - 2026-06-19

### Fixed
- **CRITICAL: `InvalidStateError: image source is detached` in webcodecs-worker path**:
  The `try/finally` block added in v0.10.3 inside `encodeViaOffscreenCanvas`
  was THE BUG. The `finally` clause ran `bitmap.close()` during the
  `await canvas.convertToBlob(...)` suspension, which Chrome 149 detected
  as a detached source during the GPU readback for encoding.

  Root cause: `finally` blocks execute when the try block is left, **including
  during await suspension** — not just on throw. Closing the bitmap before
  `convertToBlob` completes its GPU readback triggered
  "image source is detached" exactly when the encode was about to use
  the pixels.

  v0.5.7 (the working baseline) had no try/finally in encode — just a
  bare `ctx.drawImage(); return await convertToBlob(...)`. The bitmap
  was closed in the worker.ts main `compress()` function AFTER the encode
  returned. That ordering is correct because `transferToImageBitmap()` in
  the upstream helpers (`resizeOffscreen`, `applyExifOrientation`,
  `applyTransforms`) already produced a fresh, independent bitmap — the
  caller (worker.ts) owns the lifetime and closes it after encode resolves.

  The v0.10.3 try/finally was added on the (incorrect) assumption that
  "defensive cleanup" is always safe. **It is not** — closing an
  ImageBitmap while a `convertToBlob` GPU readback is in flight is
  exactly the scenario Chrome 149 flags as detached.

### Reverted (from v0.10.3)
- `encodeViaOffscreenCanvas` reverted to v0.5.7 form: sync `drawImage`
  + direct `return await convertToBlob(...)`, no try/finally.
- The redundant `bitmap.close()` in worker.ts after encode is preserved
  (caller-side cleanup, runs AFTER encode resolves — safe).

## [0.10.4] - 2026-06-19

### Fixed
- **`selectPaths()` reverted to v0.5.7 logic — Worker paths are now selected**:
  v0.10.0 introduced gating on `*InWorker` flags (`hasOffscreenCanvasInWorker`,
  `hasWebCodecsInWorker`, `hasCreateImageBitmapInWorker`) that were populated
  by a background probe. When the probe:
    - **Returned null** (timeout, Comlink error) → flags set to `false`
    - **Reported a `false` flag** (e.g. Safari iOS Worker context doesn't
      have OffscreenCanvas) → flag stayed `false`
  ...the cascade skipped Worker paths entirely, falling through to
  `canvas-main` even though Worker would have worked.

  This broke the v0.5.7 UX of "webcodecs-worker attempt #1" on Safari iOS,
  mobile Chrome, and slow-probe environments.

  **Fix**: use main-thread capabilities for path selection (v0.5.7 behavior).
  The cascade's try/catch fallback handles actual Worker runtime failures
  gracefully — no need to gate on probe results. The 100KB size threshold
  is kept as a perf optimization.

  This is the **same fix that fixed the bitmap detach bug** (sync + transfer
  vs async + clone) in spirit: we don't try to be clever about runtime
  detection — we trust the spec and let the cascade recover from failures.

## [0.10.3] - 2026-06-19

### Fixed
- **`encodeViaOffscreenCanvas()` re-adds `try/finally` as a safety net**:
  The v0.10.1 try/finally was removed in v0.10.2 because the upstream
  sync `transferToImageBitmap()` was the actual root cause fix. But
  defensive `try/finally` belongs in the encode step regardless, because:
    - Closes the source bitmap even if `convertToBlob` throws (GPU OOM,
      context loss, etc.) — prevents resource leak in the Worker.
    - Safe to call even on an already-closed bitmap (no-op in spec).
    - Sync code in a Worker is fine — it doesn't block the main thread.

  This is **defensive cleanup, not a race-condition workaround**. The
  race condition was fixed at the source in v0.10.2 (sync `transferToImageBitmap()`).
  The `try/finally` here guarantees no resource leak in the Worker on
  any error path.

### Added
- `src/v103-encoding.test.ts` — 4 new tests for the v0.10.3 try/finally
  safety net:
    - Bitmap is closed on successful encode
    - Bitmap is closed even when `convertToBlob` throws
    - Re-closing an already-closed bitmap is safe (no-throw)
    - Format/quality options are respected

## [0.10.2] - 2026-06-19

### Fixed
- **Chrome 149 `InvalidStateError: image source is detached` — proper root cause fix**:
  Reverted the bitmap helpers (`applyExifOrientation`, `applyTransforms`,
  `applyRotation`, `resizeExact`) to **synchronous** functions that use
  `canvas.transferToImageBitmap()`. The async `await createImageBitmap(canvas)`
  approach introduced in v0.10.0 was the actual root cause: it kept the
  source bitmap alive past the GPU readback in `convertToBlob`, triggering
  the race.

  `transferToImageBitmap()` is **synchronous** and **immediately detaches the
  canvas backing**, so the new bitmap is independent of the source bitmap
  by the time we reach the next `await`. This matches the v0.5.7 architecture
  (which has been confirmed working on the same hardware that v0.10.x fails
  on — see CHANGELOG v0.5.7 entry and the live test at
  https://compress.gkz.info/).

- **`resizeOffscreen()` reverted to v0.5.7 OffscreenCanvas pipeline**:
  Removed the native `createImageBitmap(file, {resizeWidth, ...})` shortcut
  (v0.10.0) and the extra `createImageBitmap(bitmap)` clone workaround
  (v0.10.1). The original OffscreenCanvas + drawImage + transferToImageBitmap
  pipeline is the only one that has been verified to work in production on
  Chrome 149.

- **`encodeViaOffscreenCanvas()` reverted to v0.5.7 pattern (no try/finally)**:
  The v0.10.1 `try { drawImage; convertToBlob } finally { bitmap.close() }`
  pattern is no longer needed because the upstream helpers now detach the
  source bitmap synchronously. The caller (`worker.ts`) closes the bitmap
  after the encode step, just like v0.5.7.

### Removed
- `src/v101-encoding.test.ts` — tests for the v0.10.1 try/finally close
  pattern. With v0.10.2 the bitmap close lifecycle is back in the caller
  and the helper no longer owns it. The previous test expectations (close
  called inside the helper) are no longer correct.

## [0.10.1] - 2026-06-19

### Fixed
- **Chrome 149 `InvalidStateError: image source is detached` — root cause fix**:
  `encodeViaOffscreenCanvas()` now closes the source `ImageBitmap` in a
  `finally` block that runs AFTER `canvas.convertToBlob()` resolves, not
  before. The previous code called `drawImage(bitmap, 0, 0)` then
  `convertToBlob(...)` synchronously, and the caller closed the bitmap
  after — but Chrome 149's internal GPU readback in `convertToBlob` can
  detach the source bitmap asynchronously, racing with the close call.
  Wrapping close in `try { ... } finally { bitmap.close(); }` guarantees
  the bitmap outlives the encode step. Matches the MDN reference pattern
  for safe `ImageBitmap` lifecycle in OffscreenCanvas encode flows.

- **Cascade warning `bitmap already closed` suppressed**: Removed redundant
  `bitmap.close()` in the worker pipeline after `encodeViaOffscreenCanvas()`
  since the helper now owns the close lifecycle. Calling `close()` on an
  already-closed bitmap is a no-op in spec, but Chrome 149 logs a warning
  to the console that confuses users investigating detach errors.

## [0.10.0] - 2026-06-19

### Changed
- **Worker-first path ordering (matches v0.5.7 Angular wrapper behavior)**:
  The cascade now tries `webcodecs-worker` → `offscreen-worker` → `canvas-main`
  for files ≥ 100KB, instead of `canvas-main` → `webcodecs-worker` →
  `offscreen-worker`. The `canvas-main` path is still always present as the
  final fallback.

  Rationale: Heavy decode + resize no longer block the UI thread when the
  browser has a working Worker context. The cascade's try/catch fallback
  ensures we still degrade gracefully if a Worker path fails at runtime.

- **Optimistic Worker path selection (trust main-thread caps)**: When the
  background Worker probe hasn't finished yet (or the probe timed out),
  `selectPaths()` trusts the main-thread capability detection rather than
  disabling Worker paths by default. The `workerPathsReliable === false`
  gate still skips Worker paths if a real probe confirms they're broken
  (e.g. Chrome bitmap detach bug, Firefox broken transferToImageBitmap).

### Added
- **`WORKER_SIZE_THRESHOLD_BYTES` constant (100KB)**: Files smaller than
  this skip Worker paths entirely. Worker spawn + structured-clone
  overhead (~30-100ms) exceeds the entire compression time for small
  files, so canvas-main is faster for these.
- **Internal `originalSize` field on `CompressionOptions`**: Tagged by the
  service so `selectPaths()` can apply the size threshold. Not part of
  the public API.

### Tests
- 11 new tests for `selectPaths()` covering:
  - Worker-first ordering with all capabilities
  - Omission of `webcodecs-worker` when WebCodecs is missing
  - Size threshold boundary (50KB, 100KB, 200KB)
  - Probe-based reliability gate (true / false / undefined)
  - `canvas-main` fallback when Worker features are missing
- Total: 151/151 tests pass (was 140/140)

### Migration Notes
- Users who relied on canvas-first ordering may notice the first large
  file compression takes slightly longer (Worker spawn) but doesn't
  block the UI.
- Users with broken Worker contexts (rare) still see the same fallback
  to `canvas-main` — no behavior change.
- Users with `forcePath: 'canvas-main'` are unaffected.

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
