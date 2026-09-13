# Benchmarks

> **TL;DR**
>
> - Compress a **4.14 MB** JPEG in **68.2 ms** on Chrome 149 (`canvas-main` path).
> - **`canvas-main`** is the fastest on this hardware (68.2 ms).
> - On modern browsers all 3 paths finish in well under 100ms — the real win is **universal compatibility** (works on every browser, no polyfill needed).
>
> [📊 Live interactive dashboard](https://gkzlabs.github.io/image-compression/bench/)

## Path verdict

When to use which path (the cascade picks automatically, but you can force by disabling features):

| Path | Best for | Browser support | Trade-off |
| --- | --- | --- | --- |
| `webcodecs-worker` ⚡ | Modern apps where you control the browser baseline | Chrome 94+, Edge 94+, Safari 16.4+, Firefox 130+ | GPU-accelerated decode; needs WebCodecs |
| `offscreen-worker` 🥈 | Mid-tier browser support without main-thread blocking | Same as above + older Chrome via fallback | OffscreenCanvas; ~10% slower than WebCodecs |
| `canvas-main` 🥉 | Universal fallback (works everywhere, including Node/test env) | 100% of browsers | Blocks main thread; no worker isolation |
| `server-fallback` | Last-resort passthrough | N/A | No compression — caller uploads original |

> **Practical tip:** on small files (<100 KB), the cascade may skip Worker paths because the postMessage overhead exceeds the decode cost. See the [live dashboard](https://gkzlabs.github.io/image-compression/bench/) for real numbers per fixture size.

**Library version:** `@gkzlabs/image-compression@1.3.0`
**Browser:** Chrome/152.0.7977.75
**Run at:** 2026-09-13T10:58:26.053Z
**Iterations per fixture:** 10 (median reported, with 1 warmup)

The library uses a 4-path cascade: `webcodecs-worker` → `offscreen-worker` → `canvas-main` → `server-fallback`. To compare paths, we launch headless Chrome three times with progressive feature disabling, forcing the cascade to fall back to a different path each time:

| Config | Description | Expected path |
| --- | --- | --- |
| `full` | Chrome (all features available) | `webcodecs-worker` |
| `no-webcodecs` | Chrome with ImageDecoder disabled → offscreen-worker | `offscreen-worker` |
| `no-workers` | Chrome with ImageDecoder + Worker disabled → canvas-main | `canvas-main` |

### Fixture: `medium-1500x1000.jpg`

| Config | Actual path | Time (median) | Time (best) | Output | Saved |
| --- | --- | --- | --- | --- | --- |
| `full` | `webcodecs-worker` | 21.7 ms | 21.1 ms | 448.8 KB | 18.8% |
| `no-webcodecs` | `offscreen-worker` | 21.6 ms | 21.1 ms | 448.8 KB | 18.8% |
| `no-workers` | `canvas-main` | 18.7 ms | 17.8 ms | 448.8 KB | 18.8% |

<svg viewBox="0 0 730 104" xmlns="http://www.w3.org/2000/svg" font-family="ui-sans-serif, system-ui, sans-serif" font-size="12" role="img" aria-label="Benchmark: medium-1500x1000.jpg">
  <line x1="160.0" y1="4" x2="160.0" y2="100" stroke="#30363d" stroke-width="0.5" stroke-dasharray="2,2"/>
  <text x="160.0" y="103" text-anchor="middle" fill="#6e83b8" font-size="10">0 ms</text>
  <line x1="277.5" y1="4" x2="277.5" y2="100" stroke="#30363d" stroke-width="0.5" stroke-dasharray="2,2"/>
  <text x="277.5" y="103" text-anchor="middle" fill="#6e83b8" font-size="10">5 ms</text>
  <line x1="395.0" y1="4" x2="395.0" y2="100" stroke="#30363d" stroke-width="0.5" stroke-dasharray="2,2"/>
  <text x="395.0" y="103" text-anchor="middle" fill="#6e83b8" font-size="10">11 ms</text>
  <line x1="512.5" y1="4" x2="512.5" y2="100" stroke="#30363d" stroke-width="0.5" stroke-dasharray="2,2"/>
  <text x="512.5" y="103" text-anchor="middle" fill="#6e83b8" font-size="10">16 ms</text>
  <line x1="630.0" y1="4" x2="630.0" y2="100" stroke="#30363d" stroke-width="0.5" stroke-dasharray="2,2"/>
  <text x="630.0" y="103" text-anchor="middle" fill="#6e83b8" font-size="10">22 ms</text>
  <text x="152" y="20" text-anchor="end" fill="#f1f5ff" font-weight="700">canvas-main</text>
  <rect x="160" y="10" width="405.0" height="18" fill="#7aa2ff" rx="3" opacity="1"/>
  <text x="571.023046067436" y="23" fill="#5dd39e" font-weight="700">18.7 ms ⚡</text>
  <text x="152" y="52" text-anchor="end" fill="#cbd5ff" font-weight="500">offscreen-worker</text>
  <rect x="160" y="42" width="467.8" height="18" fill="#9c7cff" rx="3" opacity="0.85"/>
  <text x="633.8341034290129" y="55" fill="#cbd5ff" font-weight="500">21.6 ms</text>
  <text x="152" y="84" text-anchor="end" fill="#cbd5ff" font-weight="500">webcodecs-worker</text>
  <rect x="160" y="74" width="470.0" height="18" fill="#61DAFB" rx="3" opacity="0.85"/>
  <text x="636" y="87" fill="#cbd5ff" font-weight="500">21.7 ms</text>
</svg>

### Fixture: `large-4000x3000.jpg`

| Config | Actual path | Time (median) | Time (best) | Output | Saved |
| --- | --- | --- | --- | --- | --- |
| `full` | `webcodecs-worker` | 75.4 ms | 74.4 ms | 406.9 KB | 90.4% |
| `no-webcodecs` | `offscreen-worker` | 76.5 ms | 75.2 ms | 406.9 KB | 90.4% |
| `no-workers` | `canvas-main` | 68.2 ms | 66.3 ms | 406.9 KB | 90.4% |

<svg viewBox="0 0 730 104" xmlns="http://www.w3.org/2000/svg" font-family="ui-sans-serif, system-ui, sans-serif" font-size="12" role="img" aria-label="Benchmark: large-4000x3000.jpg">
  <line x1="160.0" y1="4" x2="160.0" y2="100" stroke="#30363d" stroke-width="0.5" stroke-dasharray="2,2"/>
  <text x="160.0" y="103" text-anchor="middle" fill="#6e83b8" font-size="10">0 ms</text>
  <line x1="277.5" y1="4" x2="277.5" y2="100" stroke="#30363d" stroke-width="0.5" stroke-dasharray="2,2"/>
  <text x="277.5" y="103" text-anchor="middle" fill="#6e83b8" font-size="10">19 ms</text>
  <line x1="395.0" y1="4" x2="395.0" y2="100" stroke="#30363d" stroke-width="0.5" stroke-dasharray="2,2"/>
  <text x="395.0" y="103" text-anchor="middle" fill="#6e83b8" font-size="10">38 ms</text>
  <line x1="512.5" y1="4" x2="512.5" y2="100" stroke="#30363d" stroke-width="0.5" stroke-dasharray="2,2"/>
  <text x="512.5" y="103" text-anchor="middle" fill="#6e83b8" font-size="10">57 ms</text>
  <line x1="630.0" y1="4" x2="630.0" y2="100" stroke="#30363d" stroke-width="0.5" stroke-dasharray="2,2"/>
  <text x="630.0" y="103" text-anchor="middle" fill="#6e83b8" font-size="10">77 ms</text>
  <text x="152" y="20" text-anchor="end" fill="#f1f5ff" font-weight="700">canvas-main</text>
  <rect x="160" y="10" width="419.0" height="18" fill="#7aa2ff" rx="3" opacity="1"/>
  <text x="585.0065362406713" y="23" fill="#5dd39e" font-weight="700">68.2 ms ⚡</text>
  <text x="152" y="52" text-anchor="end" fill="#cbd5ff" font-weight="500">webcodecs-worker</text>
  <rect x="160" y="42" width="463.2" height="18" fill="#61DAFB" rx="3" opacity="0.85"/>
  <text x="629.241830651277" y="55" fill="#cbd5ff" font-weight="500">75.4 ms</text>
  <text x="152" y="84" text-anchor="end" fill="#cbd5ff" font-weight="500">offscreen-worker</text>
  <rect x="160" y="74" width="470.0" height="18" fill="#9c7cff" rx="3" opacity="0.85"/>
  <text x="636" y="87" fill="#cbd5ff" font-weight="500">76.5 ms</text>
</svg>

## Speedup vs canvas-main

| Fixture | Path | Median | Speedup |
| --- | --- | --- | --- |
| medium-1500x1000.jpg | `webcodecs-worker` | 21.7 ms | **0.86×** |
| large-4000x3000.jpg | `webcodecs-worker` | 75.4 ms | **0.90×** |
| medium-1500x1000.jpg | `offscreen-worker` | 21.6 ms | **0.87×** |
| large-4000x3000.jpg | `offscreen-worker` | 76.5 ms | **0.89×** |
| medium-1500x1000.jpg | `canvas-main` | 18.7 ms | **1.00×** |
| large-4000x3000.jpg | `canvas-main` | 68.2 ms | **1.00×** |

## Output size by format

Same fixture, same quality (0.85), same max dimension (2048) — only the output format changes. AVIF falls back to WebP/JPEG on browsers without an AVIF encoder (the reported mime type is shown).

### Fixture: `medium-1500x1000.jpg`

**Input:** 552.5 KB

| Requested format | Actual output | Size | vs JPEG |
| --- | --- | --- | --- |
| image/jpeg | image/jpeg | 448.8 KB | 0.0% |
| image/webp | image/webp | 394.4 KB | 12.1% |
| image/avif | `image/avif` → image/webp | 394.4 KB | 12.1% |

### Fixture: `large-4000x3000.jpg`

**Input:** 4.14 MB

| Requested format | Actual output | Size | vs JPEG |
| --- | --- | --- | --- |
| image/jpeg | image/jpeg | 406.9 KB | 0.0% |
| image/webp | image/webp | 381.0 KB | 6.4% |
| image/avif | `image/avif` → image/webp | 381.0 KB | 6.4% |

## Feature comparison (v1.1.0)

Same fixtures, different option combinations — isolates the cost of each new feature (`sharpen`, `qualityBoost`, multi-step downscale, binary-search target-size). The scenario list is identical across library versions, so old vs new runs are directly comparable.

### Fixture: `medium-1500x1000.jpg`

| Scenario | Path | Median | Output | vs baseline (time) | vs baseline (size) |
| --- | --- | --- | --- | --- | --- |
| Baseline (q0.85, ≤2048px, cascade) | `webcodecs-worker` | 21.3 ms | 448.8 KB | — | — |
| canvas-main baseline (no sharpen) | `canvas-main` | 18.6 ms | 448.8 KB | 0.87× (-2.7 ms) | 0.0% |
| canvas-main + sharpen 0.3 | `canvas-main` | 19.8 ms | 424.2 KB | 0.93× (-1.5 ms) | 5.5% |
| WebP (q0.85) | `webcodecs-worker` | 114.7 ms | 394.4 KB | 5.38× (+93.4 ms) | 12.1% |
| WebP + qualityBoost | `webcodecs-worker` | 133.4 ms | 656.8 KB | 6.26× (+112.1 ms) | -46.4% |
| maxSizeMB: 0.4 (target-size mode) | `webcodecs-worker` | 90.4 ms | 406.3 KB | 4.24× (+69.1 ms) | 9.5% |

_Note: `sharpen` only applies on the `canvas-main` path (workers don't sharpen). On builds before v1.1.0 the `sharpen`/`qualityBoost` scenarios are no-ops (options ignored), so they report the un-featured baseline — exactly the "feature on vs off" comparison._

### Fixture: `large-4000x3000.jpg`

| Scenario | Path | Median | Output | vs baseline (time) | vs baseline (size) |
| --- | --- | --- | --- | --- | --- |
| Baseline (q0.85, ≤2048px, cascade) | `webcodecs-worker` | 73.9 ms | 406.9 KB | — | — |
| canvas-main baseline (no sharpen) | `canvas-main` | 66.5 ms | 406.9 KB | 0.90× (-7.4 ms) | 0.0% |
| canvas-main + sharpen 0.3 | `canvas-main` | 71.3 ms | 406.9 KB | 0.96× (-2.6 ms) | 0.0% |
| WebP (q0.85) | `webcodecs-worker` | 242.9 ms | 381.0 KB | 3.29× (+169.0 ms) | 6.4% |
| WebP + qualityBoost | `webcodecs-worker` | 283.4 ms | 871.3 KB | 3.83× (+209.5 ms) | -114.2% |
| maxSizeMB: 0.4 (target-size mode) | `webcodecs-worker` | 93.2 ms | 406.9 KB | 1.26× (+19.3 ms) | 0.0% |

_Note: `sharpen` only applies on the `canvas-main` path (workers don't sharpen). On builds before v1.1.0 the `sharpen`/`qualityBoost` scenarios are no-ops (options ignored), so they report the un-featured baseline — exactly the "feature on vs off" comparison._

## Raw runs

### Config: `full`

#### medium-1500x1000.jpg

| Run | Path | Time | Ratio |
| --- | --- | --- | --- |
| 1 | `webcodecs-worker` | 22.8 ms | 18.8% |
| 2 | `webcodecs-worker` | 22.1 ms | 18.8% |
| 3 | `webcodecs-worker` | 21.3 ms | 18.8% |
| 4 | `webcodecs-worker` | 21.6 ms | 18.8% |
| 5 | `webcodecs-worker` | 21.2 ms | 18.8% |
| 6 | `webcodecs-worker` | 28.2 ms | 18.8% |
| 7 | `webcodecs-worker` | 21.5 ms | 18.8% |
| 8 | `webcodecs-worker` | 21.7 ms | 18.8% |
| 9 | `webcodecs-worker` | 22.1 ms | 18.8% |
| 10 | `webcodecs-worker` | 21.1 ms | 18.8% |

#### large-4000x3000.jpg

| Run | Path | Time | Ratio |
| --- | --- | --- | --- |
| 1 | `webcodecs-worker` | 75.8 ms | 90.4% |
| 2 | `webcodecs-worker` | 74.4 ms | 90.4% |
| 3 | `webcodecs-worker` | 75.1 ms | 90.4% |
| 4 | `webcodecs-worker` | 74.8 ms | 90.4% |
| 5 | `webcodecs-worker` | 74.4 ms | 90.4% |
| 6 | `webcodecs-worker` | 74.7 ms | 90.4% |
| 7 | `webcodecs-worker` | 76.0 ms | 90.4% |
| 8 | `webcodecs-worker` | 77.5 ms | 90.4% |
| 9 | `webcodecs-worker` | 76.8 ms | 90.4% |
| 10 | `webcodecs-worker` | 75.4 ms | 90.4% |

### Config: `no-webcodecs`

#### medium-1500x1000.jpg

| Run | Path | Time | Ratio |
| --- | --- | --- | --- |
| 1 | `offscreen-worker` | 23.5 ms | 18.8% |
| 2 | `offscreen-worker` | 22.1 ms | 18.8% |
| 3 | `offscreen-worker` | 21.1 ms | 18.8% |
| 4 | `offscreen-worker` | 22.0 ms | 18.8% |
| 5 | `offscreen-worker` | 21.4 ms | 18.8% |
| 6 | `offscreen-worker` | 21.4 ms | 18.8% |
| 7 | `offscreen-worker` | 21.3 ms | 18.8% |
| 8 | `offscreen-worker` | 27.8 ms | 18.8% |
| 9 | `offscreen-worker` | 21.4 ms | 18.8% |
| 10 | `offscreen-worker` | 21.6 ms | 18.8% |

#### large-4000x3000.jpg

| Run | Path | Time | Ratio |
| --- | --- | --- | --- |
| 1 | `offscreen-worker` | 76.6 ms | 90.4% |
| 2 | `offscreen-worker` | 75.2 ms | 90.4% |
| 3 | `offscreen-worker` | 75.3 ms | 90.4% |
| 4 | `offscreen-worker` | 75.5 ms | 90.4% |
| 5 | `offscreen-worker` | 75.3 ms | 90.4% |
| 6 | `offscreen-worker` | 87.6 ms | 90.4% |
| 7 | `offscreen-worker` | 75.3 ms | 90.4% |
| 8 | `offscreen-worker` | 76.5 ms | 90.4% |
| 9 | `offscreen-worker` | 78.9 ms | 90.4% |
| 10 | `offscreen-worker` | 83.9 ms | 90.4% |

### Config: `no-workers`

#### medium-1500x1000.jpg

| Run | Path | Time | Ratio |
| --- | --- | --- | --- |
| 1 | `canvas-main` | 21.1 ms | 18.8% |
| 2 | `canvas-main` | 20.9 ms | 18.8% |
| 3 | `canvas-main` | 21.4 ms | 18.8% |
| 4 | `canvas-main` | 18.0 ms | 18.8% |
| 5 | `canvas-main` | 17.9 ms | 18.8% |
| 6 | `canvas-main` | 19.2 ms | 18.8% |
| 7 | `canvas-main` | 18.3 ms | 18.8% |
| 8 | `canvas-main` | 17.9 ms | 18.8% |
| 9 | `canvas-main` | 17.8 ms | 18.8% |
| 10 | `canvas-main` | 18.7 ms | 18.8% |

#### large-4000x3000.jpg

| Run | Path | Time | Ratio |
| --- | --- | --- | --- |
| 1 | `canvas-main` | 72.1 ms | 90.4% |
| 2 | `canvas-main` | 68.9 ms | 90.4% |
| 3 | `canvas-main` | 68.2 ms | 90.4% |
| 4 | `canvas-main` | 67.9 ms | 90.4% |
| 5 | `canvas-main` | 66.9 ms | 90.4% |
| 6 | `canvas-main` | 67.4 ms | 90.4% |
| 7 | `canvas-main` | 66.3 ms | 90.4% |
| 8 | `canvas-main` | 66.4 ms | 90.4% |
| 9 | `canvas-main` | 69.0 ms | 90.4% |
| 10 | `canvas-main` | 68.8 ms | 90.4% |

## Methodology

- **Harness:** `bench/harness.html` loads the built `dist/index.js` and calls `svc.compress(file, { quality: 0.85, maxWidthOrHeight: 2048 })` in a loop.
- **Path forcing:** Three configs run sequentially in the same Chrome instance. Each config patches browser APIs (ImageDecoder, Worker) via `page.evaluate` BEFORE calling `compress()` — this is more reliable than `--disable-features` flags because the lib uses optimistic capability detection (per the v0.10.4 design principle: "trust main-thread caps optimistically").
  - `full` — no patches, cascade picks the best available path
  - `no-webcodecs` — `ImageDecoder` deleted → cascade falls to `offscreen-worker`
  - `no-workers` — `ImageDecoder` + `Worker` deleted → cascade falls to `canvas-main`
- **Warmup:** 1 unmeasured runs to prime JIT, V8 caches, and browser caches.
- **Iterations:** 10 measured runs per fixture. Median + best (min) reported.
- **Fixtures:** Generated deterministically via `bench/fixtures/generate.mjs` (uses `@napi-rs/canvas`); committed to the repo for reproducibility.
- **Variance:** Times vary 5-20% run-to-run. Use the median, not the mean, for stable comparisons.

## Live dashboard

See [https://gkzlabs.github.io/image-compression/bench/](https://gkzlabs.github.io/image-compression/bench/) for an interactive chart view with hover tooltips.

## Reproducing

```bash
npm run build         # build dist/
npm run bench         # run all fixtures on all 3 configs
# or:
BENCH_ITERATIONS=10 npm run bench   # more iterations for tighter median
```

## CI

The `Bench` GitHub Actions workflow runs on `workflow_dispatch` and weekly schedule, then commits `results/BENCHMARKS.md` back to the repo. See `.github/workflows/bench.yml`.
