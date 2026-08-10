# Benchmarks

> **TL;DR**
>
> - Compress a **4.14 MB** JPEG in **74.0 ms** on Chrome 149 (`canvas-main` path).
> - **`canvas-main`** is the fastest on this hardware (74.0 ms).
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

**Library version:** `@gkzlabs/image-compression@1.0.2`
**Browser:** Chrome/151.0.7922.47
**Run at:** 2026-08-10T09:20:19.853Z
**Iterations per fixture:** 5 (median reported, with 1 warmup)

The library uses a 4-path cascade: `webcodecs-worker` → `offscreen-worker` → `canvas-main` → `server-fallback`. To compare paths, we launch headless Chrome three times with progressive feature disabling, forcing the cascade to fall back to a different path each time:

| Config | Description | Expected path |
| --- | --- | --- |
| `full` | Chrome (all features available) | `webcodecs-worker` |
| `no-webcodecs` | Chrome with ImageDecoder disabled → offscreen-worker | `offscreen-worker` |
| `no-workers` | Chrome with ImageDecoder + Worker disabled → canvas-main | `canvas-main` |

### Fixture: `medium-1500x1000.jpg`

| Config | Actual path | Time (median) | Time (best) | Output | Saved |
| --- | --- | --- | --- | --- | --- |
| `full` | `webcodecs-worker` | 23.3 ms | 22.1 ms | 448.8 KB | 18.8% |
| `no-webcodecs` | `offscreen-worker` | 22.0 ms | 20.9 ms | 448.8 KB | 18.8% |
| `no-workers` | `canvas-main` | 21.9 ms | 18.3 ms | 448.8 KB | 18.8% |

<svg viewBox="0 0 730 104" xmlns="http://www.w3.org/2000/svg" font-family="ui-sans-serif, system-ui, sans-serif" font-size="12" role="img" aria-label="Benchmark: medium-1500x1000.jpg">
  <line x1="160.0" y1="4" x2="160.0" y2="100" stroke="#30363d" stroke-width="0.5" stroke-dasharray="2,2"/>
  <text x="160.0" y="103" text-anchor="middle" fill="#6e83b8" font-size="10">0 ms</text>
  <line x1="277.5" y1="4" x2="277.5" y2="100" stroke="#30363d" stroke-width="0.5" stroke-dasharray="2,2"/>
  <text x="277.5" y="103" text-anchor="middle" fill="#6e83b8" font-size="10">6 ms</text>
  <line x1="395.0" y1="4" x2="395.0" y2="100" stroke="#30363d" stroke-width="0.5" stroke-dasharray="2,2"/>
  <text x="395.0" y="103" text-anchor="middle" fill="#6e83b8" font-size="10">12 ms</text>
  <line x1="512.5" y1="4" x2="512.5" y2="100" stroke="#30363d" stroke-width="0.5" stroke-dasharray="2,2"/>
  <text x="512.5" y="103" text-anchor="middle" fill="#6e83b8" font-size="10">17 ms</text>
  <line x1="630.0" y1="4" x2="630.0" y2="100" stroke="#30363d" stroke-width="0.5" stroke-dasharray="2,2"/>
  <text x="630.0" y="103" text-anchor="middle" fill="#6e83b8" font-size="10">23 ms</text>
  <text x="152" y="20" text-anchor="end" fill="#f1f5ff" font-weight="700">canvas-main</text>
  <rect x="160" y="10" width="441.8" height="18" fill="#7aa2ff" rx="3" opacity="1"/>
  <text x="607.7596546708455" y="23" fill="#5dd39e" font-weight="700">21.9 ms ⚡</text>
  <text x="152" y="52" text-anchor="end" fill="#cbd5ff" font-weight="500">offscreen-worker</text>
  <rect x="160" y="42" width="443.8" height="18" fill="#9c7cff" rx="3" opacity="0.85"/>
  <text x="609.7768249425292" y="55" fill="#cbd5ff" font-weight="500">22.0 ms</text>
  <text x="152" y="84" text-anchor="end" fill="#cbd5ff" font-weight="500">webcodecs-worker</text>
  <rect x="160" y="74" width="470.0" height="18" fill="#61DAFB" rx="3" opacity="0.85"/>
  <text x="636" y="87" fill="#cbd5ff" font-weight="500">23.3 ms</text>
</svg>

### Fixture: `large-4000x3000.jpg`

| Config | Actual path | Time (median) | Time (best) | Output | Saved |
| --- | --- | --- | --- | --- | --- |
| `full` | `webcodecs-worker` | 82.4 ms | 79.1 ms | 406.9 KB | 90.4% |
| `no-webcodecs` | `offscreen-worker` | 75.3 ms | 74.0 ms | 406.9 KB | 90.4% |
| `no-workers` | `canvas-main` | 74.0 ms | 67.9 ms | 406.9 KB | 90.4% |

<svg viewBox="0 0 730 104" xmlns="http://www.w3.org/2000/svg" font-family="ui-sans-serif, system-ui, sans-serif" font-size="12" role="img" aria-label="Benchmark: large-4000x3000.jpg">
  <line x1="160.0" y1="4" x2="160.0" y2="100" stroke="#30363d" stroke-width="0.5" stroke-dasharray="2,2"/>
  <text x="160.0" y="103" text-anchor="middle" fill="#6e83b8" font-size="10">0 ms</text>
  <line x1="277.5" y1="4" x2="277.5" y2="100" stroke="#30363d" stroke-width="0.5" stroke-dasharray="2,2"/>
  <text x="277.5" y="103" text-anchor="middle" fill="#6e83b8" font-size="10">21 ms</text>
  <line x1="395.0" y1="4" x2="395.0" y2="100" stroke="#30363d" stroke-width="0.5" stroke-dasharray="2,2"/>
  <text x="395.0" y="103" text-anchor="middle" fill="#6e83b8" font-size="10">41 ms</text>
  <line x1="512.5" y1="4" x2="512.5" y2="100" stroke="#30363d" stroke-width="0.5" stroke-dasharray="2,2"/>
  <text x="512.5" y="103" text-anchor="middle" fill="#6e83b8" font-size="10">62 ms</text>
  <line x1="630.0" y1="4" x2="630.0" y2="100" stroke="#30363d" stroke-width="0.5" stroke-dasharray="2,2"/>
  <text x="630.0" y="103" text-anchor="middle" fill="#6e83b8" font-size="10">82 ms</text>
  <text x="152" y="20" text-anchor="end" fill="#f1f5ff" font-weight="700">canvas-main</text>
  <rect x="160" y="10" width="422.1" height="18" fill="#7aa2ff" rx="3" opacity="1"/>
  <text x="588.0873793735448" y="23" fill="#5dd39e" font-weight="700">74.0 ms ⚡</text>
  <text x="152" y="52" text-anchor="end" fill="#cbd5ff" font-weight="500">offscreen-worker</text>
  <rect x="160" y="42" width="429.5" height="18" fill="#9c7cff" rx="3" opacity="0.85"/>
  <text x="595.5024276581246" y="55" fill="#cbd5ff" font-weight="500">75.3 ms</text>
  <text x="152" y="84" text-anchor="end" fill="#cbd5ff" font-weight="500">webcodecs-worker</text>
  <rect x="160" y="74" width="470.0" height="18" fill="#61DAFB" rx="3" opacity="0.85"/>
  <text x="636" y="87" fill="#cbd5ff" font-weight="500">82.4 ms</text>
</svg>

## Speedup vs canvas-main

| Fixture | Path | Median | Speedup |
| --- | --- | --- | --- |
| medium-1500x1000.jpg | `webcodecs-worker` | 23.3 ms | **0.94×** |
| large-4000x3000.jpg | `webcodecs-worker` | 82.4 ms | **0.90×** |
| medium-1500x1000.jpg | `offscreen-worker` | 22.0 ms | **1.00×** |
| large-4000x3000.jpg | `offscreen-worker` | 75.3 ms | **0.98×** |
| medium-1500x1000.jpg | `canvas-main` | 21.9 ms | **1.00×** |
| large-4000x3000.jpg | `canvas-main` | 74.0 ms | **1.00×** |

## Raw runs

### Config: `full`

#### medium-1500x1000.jpg

| Run | Path | Time | Ratio |
| --- | --- | --- | --- |
| 1 | `webcodecs-worker` | 23.4 ms | 18.8% |
| 2 | `webcodecs-worker` | 23.3 ms | 18.8% |
| 3 | `webcodecs-worker` | 23.3 ms | 18.8% |
| 4 | `webcodecs-worker` | 22.1 ms | 18.8% |
| 5 | `webcodecs-worker` | 22.1 ms | 18.8% |

#### large-4000x3000.jpg

| Run | Path | Time | Ratio |
| --- | --- | --- | --- |
| 1 | `webcodecs-worker` | 89.7 ms | 90.4% |
| 2 | `webcodecs-worker` | 82.0 ms | 90.4% |
| 3 | `webcodecs-worker` | 79.1 ms | 90.4% |
| 4 | `webcodecs-worker` | 82.8 ms | 90.4% |
| 5 | `webcodecs-worker` | 82.4 ms | 90.4% |

### Config: `no-webcodecs`

#### medium-1500x1000.jpg

| Run | Path | Time | Ratio |
| --- | --- | --- | --- |
| 1 | `offscreen-worker` | 27.0 ms | 18.8% |
| 2 | `offscreen-worker` | 22.0 ms | 18.8% |
| 3 | `offscreen-worker` | 21.3 ms | 18.8% |
| 4 | `offscreen-worker` | 24.6 ms | 18.8% |
| 5 | `offscreen-worker` | 20.9 ms | 18.8% |

#### large-4000x3000.jpg

| Run | Path | Time | Ratio |
| --- | --- | --- | --- |
| 1 | `offscreen-worker` | 78.8 ms | 90.4% |
| 2 | `offscreen-worker` | 74.5 ms | 90.4% |
| 3 | `offscreen-worker` | 74.0 ms | 90.4% |
| 4 | `offscreen-worker` | 81.5 ms | 90.4% |
| 5 | `offscreen-worker` | 75.3 ms | 90.4% |

### Config: `no-workers`

#### medium-1500x1000.jpg

| Run | Path | Time | Ratio |
| --- | --- | --- | --- |
| 1 | `canvas-main` | 28.0 ms | 18.8% |
| 2 | `canvas-main` | 21.1 ms | 18.8% |
| 3 | `canvas-main` | 21.9 ms | 18.8% |
| 4 | `canvas-main` | 18.3 ms | 18.8% |
| 5 | `canvas-main` | 30.5 ms | 18.8% |

#### large-4000x3000.jpg

| Run | Path | Time | Ratio |
| --- | --- | --- | --- |
| 1 | `canvas-main` | 76.2 ms | 90.4% |
| 2 | `canvas-main` | 74.0 ms | 90.4% |
| 3 | `canvas-main` | 74.6 ms | 90.4% |
| 4 | `canvas-main` | 67.9 ms | 90.4% |
| 5 | `canvas-main` | 69.8 ms | 90.4% |

## Methodology

- **Harness:** `bench/harness.html` loads the built `dist/index.js` and calls `svc.compress(file, { quality: 0.85, maxWidthOrHeight: 2048 })` in a loop.
- **Path forcing:** Three configs run sequentially in the same Chrome instance. Each config patches browser APIs (ImageDecoder, Worker) via `page.evaluate` BEFORE calling `compress()` — this is more reliable than `--disable-features` flags because the lib uses optimistic capability detection (per the v0.10.4 design principle: "trust main-thread caps optimistically").
  - `full` — no patches, cascade picks the best available path
  - `no-webcodecs` — `ImageDecoder` deleted → cascade falls to `offscreen-worker`
  - `no-workers` — `ImageDecoder` + `Worker` deleted → cascade falls to `canvas-main`
- **Warmup:** 1 unmeasured runs to prime JIT, V8 caches, and browser caches.
- **Iterations:** 5 measured runs per fixture. Median + best (min) reported.
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
