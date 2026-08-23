# Benchmarks

> **TL;DR**
>
> - Compress a **4.14 MB** JPEG in **141.6 ms** on Chrome 149 (`canvas-main` path).
> - **`canvas-main`** is the fastest on this hardware (141.6 ms).
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

**Library version:** `@gkzlabs/image-compression@1.1.1`
**Browser:** Chrome/150.0.7871.24
**Run at:** 2026-08-23T09:16:47.718Z
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
| `full` | `webcodecs-worker` | 40.5 ms | 38.9 ms | 448.8 KB | 18.8% |
| `no-webcodecs` | `offscreen-worker` | 41.8 ms | 39.7 ms | 448.8 KB | 18.8% |
| `no-workers` | `canvas-main` | 34.1 ms | 33.5 ms | 448.8 KB | 18.8% |

<svg viewBox="0 0 730 104" xmlns="http://www.w3.org/2000/svg" font-family="ui-sans-serif, system-ui, sans-serif" font-size="12" role="img" aria-label="Benchmark: medium-1500x1000.jpg">
  <line x1="160.0" y1="4" x2="160.0" y2="100" stroke="#30363d" stroke-width="0.5" stroke-dasharray="2,2"/>
  <text x="160.0" y="103" text-anchor="middle" fill="#6e83b8" font-size="10">0 ms</text>
  <line x1="277.5" y1="4" x2="277.5" y2="100" stroke="#30363d" stroke-width="0.5" stroke-dasharray="2,2"/>
  <text x="277.5" y="103" text-anchor="middle" fill="#6e83b8" font-size="10">10 ms</text>
  <line x1="395.0" y1="4" x2="395.0" y2="100" stroke="#30363d" stroke-width="0.5" stroke-dasharray="2,2"/>
  <text x="395.0" y="103" text-anchor="middle" fill="#6e83b8" font-size="10">21 ms</text>
  <line x1="512.5" y1="4" x2="512.5" y2="100" stroke="#30363d" stroke-width="0.5" stroke-dasharray="2,2"/>
  <text x="512.5" y="103" text-anchor="middle" fill="#6e83b8" font-size="10">31 ms</text>
  <line x1="630.0" y1="4" x2="630.0" y2="100" stroke="#30363d" stroke-width="0.5" stroke-dasharray="2,2"/>
  <text x="630.0" y="103" text-anchor="middle" fill="#6e83b8" font-size="10">42 ms</text>
  <text x="152" y="20" text-anchor="end" fill="#f1f5ff" font-weight="700">canvas-main</text>
  <rect x="160" y="10" width="383.4" height="18" fill="#7aa2ff" rx="3" opacity="1"/>
  <text x="549.4210526316177" y="23" fill="#5dd39e" font-weight="700">34.1 ms ⚡</text>
  <text x="152" y="52" text-anchor="end" fill="#cbd5ff" font-weight="500">webcodecs-worker</text>
  <rect x="160" y="42" width="455.4" height="18" fill="#61DAFB" rx="3" opacity="0.85"/>
  <text x="621.3827751195855" y="55" fill="#cbd5ff" font-weight="500">40.5 ms</text>
  <text x="152" y="84" text-anchor="end" fill="#cbd5ff" font-weight="500">offscreen-worker</text>
  <rect x="160" y="74" width="470.0" height="18" fill="#9c7cff" rx="3" opacity="0.85"/>
  <text x="636" y="87" fill="#cbd5ff" font-weight="500">41.8 ms</text>
</svg>

### Fixture: `large-4000x3000.jpg`

| Config | Actual path | Time (median) | Time (best) | Output | Saved |
| --- | --- | --- | --- | --- | --- |
| `full` | `webcodecs-worker` | 167.7 ms | 141.0 ms | 414.2 KB | 90.2% |
| `no-webcodecs` | `offscreen-worker` | 150.5 ms | 145.8 ms | 414.2 KB | 90.2% |
| `no-workers` | `canvas-main` | 141.6 ms | 137.4 ms | 414.2 KB | 90.2% |

<svg viewBox="0 0 730 104" xmlns="http://www.w3.org/2000/svg" font-family="ui-sans-serif, system-ui, sans-serif" font-size="12" role="img" aria-label="Benchmark: large-4000x3000.jpg">
  <line x1="160.0" y1="4" x2="160.0" y2="100" stroke="#30363d" stroke-width="0.5" stroke-dasharray="2,2"/>
  <text x="160.0" y="103" text-anchor="middle" fill="#6e83b8" font-size="10">0 ms</text>
  <line x1="277.5" y1="4" x2="277.5" y2="100" stroke="#30363d" stroke-width="0.5" stroke-dasharray="2,2"/>
  <text x="277.5" y="103" text-anchor="middle" fill="#6e83b8" font-size="10">42 ms</text>
  <line x1="395.0" y1="4" x2="395.0" y2="100" stroke="#30363d" stroke-width="0.5" stroke-dasharray="2,2"/>
  <text x="395.0" y="103" text-anchor="middle" fill="#6e83b8" font-size="10">84 ms</text>
  <line x1="512.5" y1="4" x2="512.5" y2="100" stroke="#30363d" stroke-width="0.5" stroke-dasharray="2,2"/>
  <text x="512.5" y="103" text-anchor="middle" fill="#6e83b8" font-size="10">126 ms</text>
  <line x1="630.0" y1="4" x2="630.0" y2="100" stroke="#30363d" stroke-width="0.5" stroke-dasharray="2,2"/>
  <text x="630.0" y="103" text-anchor="middle" fill="#6e83b8" font-size="10">168 ms</text>
  <text x="152" y="20" text-anchor="end" fill="#f1f5ff" font-weight="700">canvas-main</text>
  <rect x="160" y="10" width="396.9" height="18" fill="#7aa2ff" rx="3" opacity="1"/>
  <text x="562.8515205724332" y="23" fill="#5dd39e" font-weight="700">141.6 ms ⚡</text>
  <text x="152" y="52" text-anchor="end" fill="#cbd5ff" font-weight="500">offscreen-worker</text>
  <rect x="160" y="42" width="421.8" height="18" fill="#9c7cff" rx="3" opacity="0.85"/>
  <text x="587.7948717948791" y="55" fill="#cbd5ff" font-weight="500">150.5 ms</text>
  <text x="152" y="84" text-anchor="end" fill="#cbd5ff" font-weight="500">webcodecs-worker</text>
  <rect x="160" y="74" width="470.0" height="18" fill="#61DAFB" rx="3" opacity="0.85"/>
  <text x="636" y="87" fill="#cbd5ff" font-weight="500">167.7 ms</text>
</svg>

## Speedup vs canvas-main

| Fixture | Path | Median | Speedup |
| --- | --- | --- | --- |
| medium-1500x1000.jpg | `webcodecs-worker` | 40.5 ms | **0.84×** |
| large-4000x3000.jpg | `webcodecs-worker` | 167.7 ms | **0.84×** |
| medium-1500x1000.jpg | `offscreen-worker` | 41.8 ms | **0.82×** |
| large-4000x3000.jpg | `offscreen-worker` | 150.5 ms | **0.94×** |
| medium-1500x1000.jpg | `canvas-main` | 34.1 ms | **1.00×** |
| large-4000x3000.jpg | `canvas-main` | 141.6 ms | **1.00×** |

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
| image/jpeg | image/jpeg | 414.2 KB | 0.0% |
| image/webp | image/webp | 396.7 KB | 4.2% |
| image/avif | `image/avif` → image/webp | 396.7 KB | 4.2% |

## Feature comparison (v1.1.0)

Same fixtures, different option combinations — isolates the cost of each new feature (`sharpen`, `qualityBoost`, multi-step downscale, binary-search target-size). The scenario list is identical across library versions, so old vs new runs are directly comparable.

### Fixture: `medium-1500x1000.jpg`

| Scenario | Path | Median | Output | vs baseline (time) | vs baseline (size) |
| --- | --- | --- | --- | --- | --- |
| Baseline (q0.85, ≤2048px, cascade) | `webcodecs-worker` | 40.7 ms | 448.8 KB | — | — |
| canvas-main baseline (no sharpen) | `canvas-main` | 33.9 ms | 448.8 KB | 0.83× (-6.8 ms) | 0.0% |
| canvas-main + sharpen 0.3 | `canvas-main` | 54.0 ms | 438.8 KB | 1.33× (+13.3 ms) | 2.2% |
| WebP (q0.85) | `webcodecs-worker` | 220.9 ms | 394.4 KB | 5.43× (+180.2 ms) | 12.1% |
| WebP + qualityBoost | `webcodecs-worker` | 253.4 ms | 656.8 KB | 6.23× (+212.7 ms) | -46.4% |
| maxSizeMB: 0.4 (target-size mode) | `webcodecs-worker` | 198.8 ms | 404.3 KB | 4.88× (+158.1 ms) | 9.9% |

_Note: `sharpen` only applies on the `canvas-main` path (workers don't sharpen). On builds before v1.1.0 the `sharpen`/`qualityBoost` scenarios are no-ops (options ignored), so they report the un-featured baseline — exactly the "feature on vs off" comparison._

### Fixture: `large-4000x3000.jpg`

| Scenario | Path | Median | Output | vs baseline (time) | vs baseline (size) |
| --- | --- | --- | --- | --- | --- |
| Baseline (q0.85, ≤2048px, cascade) | `webcodecs-worker` | 144.2 ms | 414.2 KB | — | — |
| canvas-main baseline (no sharpen) | `canvas-main` | 137.7 ms | 414.2 KB | 0.95× (-6.5 ms) | 0.0% |
| canvas-main + sharpen 0.3 | `canvas-main` | 187.0 ms | 414.2 KB | 1.30× (+42.8 ms) | 0.0% |
| WebP (q0.85) | `webcodecs-worker` | 457.7 ms | 396.7 KB | 3.17× (+313.5 ms) | 4.2% |
| WebP + qualityBoost | `webcodecs-worker` | 522.9 ms | 885.4 KB | 3.63× (+378.7 ms) | -113.8% |
| maxSizeMB: 0.4 (target-size mode) | `webcodecs-worker` | 347.1 ms | 408.4 KB | 2.41× (+202.9 ms) | 1.4% |

_Note: `sharpen` only applies on the `canvas-main` path (workers don't sharpen). On builds before v1.1.0 the `sharpen`/`qualityBoost` scenarios are no-ops (options ignored), so they report the un-featured baseline — exactly the "feature on vs off" comparison._

## Raw runs

### Config: `full`

#### medium-1500x1000.jpg

| Run | Path | Time | Ratio |
| --- | --- | --- | --- |
| 1 | `webcodecs-worker` | 40.2 ms | 18.8% |
| 2 | `webcodecs-worker` | 40.0 ms | 18.8% |
| 3 | `webcodecs-worker` | 43.4 ms | 18.8% |
| 4 | `webcodecs-worker` | 39.7 ms | 18.8% |
| 5 | `webcodecs-worker` | 40.6 ms | 18.8% |
| 6 | `webcodecs-worker` | 40.5 ms | 18.8% |
| 7 | `webcodecs-worker` | 38.9 ms | 18.8% |
| 8 | `webcodecs-worker` | 39.9 ms | 18.8% |
| 9 | `webcodecs-worker` | 40.5 ms | 18.8% |
| 10 | `webcodecs-worker` | 40.8 ms | 18.8% |

#### large-4000x3000.jpg

| Run | Path | Time | Ratio |
| --- | --- | --- | --- |
| 1 | `webcodecs-worker` | 167.7 ms | 90.2% |
| 2 | `webcodecs-worker` | 145.8 ms | 90.2% |
| 3 | `webcodecs-worker` | 141.0 ms | 90.2% |
| 4 | `webcodecs-worker` | 185.4 ms | 90.2% |
| 5 | `webcodecs-worker` | 188.8 ms | 90.2% |
| 6 | `webcodecs-worker` | 148.7 ms | 90.2% |
| 7 | `webcodecs-worker` | 181.6 ms | 90.2% |
| 8 | `webcodecs-worker` | 223.7 ms | 90.2% |
| 9 | `webcodecs-worker` | 146.4 ms | 90.2% |
| 10 | `webcodecs-worker` | 146.6 ms | 90.2% |

### Config: `no-webcodecs`

#### medium-1500x1000.jpg

| Run | Path | Time | Ratio |
| --- | --- | --- | --- |
| 1 | `offscreen-worker` | 42.0 ms | 18.8% |
| 2 | `offscreen-worker` | 41.9 ms | 18.8% |
| 3 | `offscreen-worker` | 41.8 ms | 18.8% |
| 4 | `offscreen-worker` | 40.5 ms | 18.8% |
| 5 | `offscreen-worker` | 41.5 ms | 18.8% |
| 6 | `offscreen-worker` | 39.7 ms | 18.8% |
| 7 | `offscreen-worker` | 40.4 ms | 18.8% |
| 8 | `offscreen-worker` | 40.1 ms | 18.8% |
| 9 | `offscreen-worker` | 43.7 ms | 18.8% |
| 10 | `offscreen-worker` | 48.2 ms | 18.8% |

#### large-4000x3000.jpg

| Run | Path | Time | Ratio |
| --- | --- | --- | --- |
| 1 | `offscreen-worker` | 148.6 ms | 90.2% |
| 2 | `offscreen-worker` | 171.8 ms | 90.2% |
| 3 | `offscreen-worker` | 197.1 ms | 90.2% |
| 4 | `offscreen-worker` | 156.9 ms | 90.2% |
| 5 | `offscreen-worker` | 147.7 ms | 90.2% |
| 6 | `offscreen-worker` | 146.5 ms | 90.2% |
| 7 | `offscreen-worker` | 145.8 ms | 90.2% |
| 8 | `offscreen-worker` | 206.2 ms | 90.2% |
| 9 | `offscreen-worker` | 149.2 ms | 90.2% |
| 10 | `offscreen-worker` | 150.5 ms | 90.2% |

### Config: `no-workers`

#### medium-1500x1000.jpg

| Run | Path | Time | Ratio |
| --- | --- | --- | --- |
| 1 | `canvas-main` | 33.8 ms | 18.8% |
| 2 | `canvas-main` | 33.9 ms | 18.8% |
| 3 | `canvas-main` | 33.5 ms | 18.8% |
| 4 | `canvas-main` | 34.1 ms | 18.8% |
| 5 | `canvas-main` | 33.6 ms | 18.8% |
| 6 | `canvas-main` | 34.8 ms | 18.8% |
| 7 | `canvas-main` | 34.1 ms | 18.8% |
| 8 | `canvas-main` | 34.2 ms | 18.8% |
| 9 | `canvas-main` | 35.5 ms | 18.8% |
| 10 | `canvas-main` | 34.2 ms | 18.8% |

#### large-4000x3000.jpg

| Run | Path | Time | Ratio |
| --- | --- | --- | --- |
| 1 | `canvas-main` | 137.7 ms | 90.2% |
| 2 | `canvas-main` | 141.7 ms | 90.2% |
| 3 | `canvas-main` | 143.3 ms | 90.2% |
| 4 | `canvas-main` | 155.0 ms | 90.2% |
| 5 | `canvas-main` | 141.6 ms | 90.2% |
| 6 | `canvas-main` | 144.3 ms | 90.2% |
| 7 | `canvas-main` | 138.2 ms | 90.2% |
| 8 | `canvas-main` | 137.4 ms | 90.2% |
| 9 | `canvas-main` | 138.0 ms | 90.2% |
| 10 | `canvas-main` | 137.9 ms | 90.2% |

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
