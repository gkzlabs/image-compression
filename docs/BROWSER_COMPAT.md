# Browser Compatibility Matrix

> Last updated: 2026-08-12
> Library version: v1.1.0

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

## Output Format Encoding (v1.0.0+)

The library supports `format: 'image/jpeg' | 'image/webp' | 'image/png' | 'image/avif'`.
Native **encode** support varies by browser — `resolveOutputFormat()` probes at
runtime and falls back `avif → webp → jpeg` automatically:

| Format | Chrome | Firefox | Safari | Notes |
|---|---|---|---|---|
| `image/jpeg` | ✅ all | ✅ all | ✅ all | Universal |
| `image/webp` | ✅ 50+ | ✅ 65+ | ✅ 16.4+ (17+ encode) | Safari < 16.4 decode-only |
| `image/png` | ✅ all | ✅ all | ✅ all | Lossless — quality ignored |
| `image/avif` | ✅ **130+** (encode) | ❌ encode | ❌ encode | Decode: Chrome 85+, Safari 16.4+, FF 77+. Encode via `canvas` is **Chromium-only**; others fall back to WebP/JPEG |

> ℹ️ A progress event (`⚠️ image/avif encode not supported in this browser — using image/webp instead`) is emitted when a requested format falls back. `canEncodeFormat()` / `resolveEncodeFormat()` are exported for pre-flight checks.

### Encode cost — why WebP is the recommended upload format

Measured encoding a 4K (3840×2160) photo on an Apple M2 laptop (libwebp 1.3 / libaom 3.8):

| Format | Encode time | vs JPEG | Note |
|---|---|---|---|
| `image/jpeg` | 0.12s | baseline | libjpeg-turbo |
| `image/webp` ⭐ | 0.48s | 4× | default settings — recommended for client-side uploads |
| `image/webp` (method 6) | 1.92s | 16× | max quality preset |
| `image/avif` (speed 8) | 2.84s | **24×** | fastest AVIF preset — still 6× slower than WebP |
| `image/avif` (speed 4) | 18.2s | 152× | balanced preset |

**Guidance for this library (client-side, before upload):**
- **WebP** is the sweet spot: ~30% smaller than JPEG with negligible encode cost on every modern browser.
- **AVIF** saves another ~50% vs WebP but costs **24×+ encode time** — acceptable for server-side/build-time pre-generation, not for real-time browser uploads. The library encodes AVIF natively where available (Chromium 130+) and falls back automatically; it deliberately does **not** bundle a WASM AVIF encoder (3.3 MB) for client-side use.

See the [README "Which output format" section](https://github.com/gkzlabs/image-compression#-which-output-format-should-i-use) for the full trade-off table.

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