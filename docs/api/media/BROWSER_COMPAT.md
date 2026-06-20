# Browser Compatibility Matrix

> Last updated: 2026-06-20
> Library version: v0.10.11

This matrix shows which browser features each compression path depends on, and the
minimum browser versions that support them. Use it to predict which cascade paths
will be selected on a given device.

## Path Requirements

| Path | Features required | Min Chrome | Min Firefox | Min Safari | Min Edge |
|---|---|---|---|---|---|
| **`webcodecs-worker`** | WebCodecs (`VideoEncoder` / `ImageDecoder`) + OffscreenCanvas + createImageBitmap + Worker (`type: 'module'`) | 94 | 105 | 16.4 | 94 |
| **`offscreen-worker`** | OffscreenCanvas + createImageBitmap + Worker (`type: 'module'`) | 69 | 105 | 16.4 | 79 |
| **`canvas-main`** | HTMLCanvasElement + Canvas2D + createImageBitmap (fallback path on main thread) | 50 | 19 | 11 | 12 |
| **`server-fallback`** | None — just returns the original file for server-side processing | All | All | All | All |

## Feature Detection (DeviceCapabilities)

The library probes these features at runtime. See `src/capabilities.ts` for the
authoritative detection logic.

| Feature | Detection | Notes |
|---|---|---|
| `hasWebCodecs` | `'VideoEncoder' in self && 'VideoFrame' in self` | Required for `webcodecs-worker` |
| `hasOffscreenCanvas` | `typeof OffscreenCanvas !== 'undefined'` | Required for any worker path |
| `hasWorker` | `typeof Worker !== 'undefined'` | Required for any worker path |
| `hasCreateImageBitmap` | `typeof self.createImageBitmap === 'function'` | Required for `offscreen-worker`+ |
| `hasImageDecoder` | `'ImageDecoder' in self` | HEIC native decode (Chrome 94+) |
| `hasCanvas2D` | `!!document.createElement('canvas').getContext('2d')` | Required for `canvas-main` |
| `hasOffscreenCanvasInWorker` | probed in worker context (`new OffscreenCanvas(1,1).getContext('2d') !== null`) | Module worker quirk on Safari 16 |
| `hasCreateImageBitmapInWorker` | probed in worker context (`typeof createImageBitmap === 'function'`) | |
| `hasWebCodecsInWorker` | probed in worker context (`typeof VideoEncoder === 'function'`) | |

## HEIC Decode Support

| Format | Native (ImageDecoder) | WASM (heic2any, optional) | None |
|---|---|---|---|
| `.heic` / `.heif` | Chrome 94+ on macOS 11+ / Win 11 / Android 12+ | All browsers (when bundled) | Pass through as-is |

`heic2any` is an **optional peer dependency**. Install only if you need HEIC
support in browsers without native ImageDecoder:

```bash
npm install heic2any
```

## Known Browser Quirks

| Browser | Quirk | Workaround |
|---|---|---|
| **Safari < 16.4** | No OffscreenCanvas in Worker → no worker paths | Falls back to `canvas-main` (always works) |
| **Safari (any)** | `OffscreenCanvas` in module workers is flaky | Library auto-detects and skips worker paths |
| **Chrome 149+** | "image source is detached" on rapid bitmap transfer chains | Fixed in v0.10.5–v0.10.10 via Compress-then-Transform pipeline |
| **iOS Safari** | Background tabs may pause workers | `requestIdleCallback` semantics; library doesn't hang on the worker |
| **Firefox < 105** | No module workers | Falls back to `canvas-main` |
| **Headless Chrome** | OffscreenCanvas in worker context returns null | Falls back to `canvas-main` (verified in tests) |

## Recommended Cascade Strategy by Use Case

| Use case | Recommended cascade |
|---|---|
| Photo gallery (mobile-first) | `webcodecs-worker` (WebCodecs HW accel) → fallback |
| Admin dashboard (desktop) | `offscreen-worker` (always available on modern Chrome) → fallback |
| Email attachment compression | `canvas-main` only (most compatible) |
| Server-side bulk processing | `server-fallback` only (just upload) |

## Testing Coverage

The library has 165 tests across 17 spec files (all `.spec.ts`). Run with:

```bash
npm test
```

Each path has dedicated tests:
- `worker-resolution.spec.ts` — worker URL resolution (3 strategies)
- `worker-caps.spec.ts` — feature detection in worker context
- `capabilities.spec.ts` — main-thread capability detection
- `progress.spec.ts` — progress event order + payload shape
- `service.spec.ts` — end-to-end compress() with each path
- `errors.spec.ts` — error class + codes
- `edge-cases.spec.ts` — empty files, corrupted data, boundary sizes