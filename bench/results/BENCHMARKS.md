# Benchmarks

> **TL;DR**
>
> - Compress a **4.14 MB** JPEG in **127.5 ms** on Chrome 149 (`canvas-main` path).
> - **`canvas-main`** is the fastest on this hardware (127.5 ms).
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

**Library version:** `@gkzlabs/image-compression@0.10.26`
**Browser:** Chrome/149.0.7827.22
**Run at:** 2026-06-28T14:59:44.622Z
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
| `full` | `webcodecs-worker` | 38.4 ms | 36.7 ms | 448.8 KB | 18.8% |
| `no-webcodecs` | `offscreen-worker` | 38.5 ms | 37.2 ms | 448.8 KB | 18.8% |
| `no-workers` | `canvas-main` | 31.7 ms | 30.8 ms | 448.8 KB | 18.8% |

<svg viewBox="0 0 730 104" xmlns="http://www.w3.org/2000/svg" font-family="ui-sans-serif, system-ui, sans-serif" font-size="12" role="img" aria-label="Benchmark: medium-1500x1000.jpg">
  <line x1="160.0" y1="4" x2="160.0" y2="100" stroke="#30363d" stroke-width="0.5" stroke-dasharray="2,2"/>
  <text x="160.0" y="103" text-anchor="middle" fill="#6e83b8" font-size="10">0 ms</text>
  <line x1="277.5" y1="4" x2="277.5" y2="100" stroke="#30363d" stroke-width="0.5" stroke-dasharray="2,2"/>
  <text x="277.5" y="103" text-anchor="middle" fill="#6e83b8" font-size="10">10 ms</text>
  <line x1="395.0" y1="4" x2="395.0" y2="100" stroke="#30363d" stroke-width="0.5" stroke-dasharray="2,2"/>
  <text x="395.0" y="103" text-anchor="middle" fill="#6e83b8" font-size="10">19 ms</text>
  <line x1="512.5" y1="4" x2="512.5" y2="100" stroke="#30363d" stroke-width="0.5" stroke-dasharray="2,2"/>
  <text x="512.5" y="103" text-anchor="middle" fill="#6e83b8" font-size="10">29 ms</text>
  <line x1="630.0" y1="4" x2="630.0" y2="100" stroke="#30363d" stroke-width="0.5" stroke-dasharray="2,2"/>
  <text x="630.0" y="103" text-anchor="middle" fill="#6e83b8" font-size="10">39 ms</text>
  <text x="152" y="20" text-anchor="end" fill="#f1f5ff" font-weight="700">canvas-main</text>
  <rect x="160" y="10" width="387.0" height="18" fill="#7aa2ff" rx="3" opacity="1"/>
  <text x="552.9870129869776" y="23" fill="#5dd39e" font-weight="700">31.7 ms ⚡</text>
  <text x="152" y="52" text-anchor="end" fill="#cbd5ff" font-weight="500">webcodecs-worker</text>
  <rect x="160" y="42" width="468.8" height="18" fill="#61DAFB" rx="3" opacity="0.85"/>
  <text x="634.7792207793274" y="55" fill="#cbd5ff" font-weight="500">38.4 ms</text>
  <text x="152" y="84" text-anchor="end" fill="#cbd5ff" font-weight="500">offscreen-worker</text>
  <rect x="160" y="74" width="470.0" height="18" fill="#9c7cff" rx="3" opacity="0.85"/>
  <text x="636" y="87" fill="#cbd5ff" font-weight="500">38.5 ms</text>
</svg>

### Fixture: `large-4000x3000.jpg`

| Config | Actual path | Time (median) | Time (best) | Output | Saved |
| --- | --- | --- | --- | --- | --- |
| `full` | `webcodecs-worker` | 138.3 ms | 137.2 ms | 414.2 KB | 90.2% |
| `no-webcodecs` | `offscreen-worker` | 139.4 ms | 137.2 ms | 414.2 KB | 90.2% |
| `no-workers` | `canvas-main` | 127.5 ms | 126.1 ms | 414.2 KB | 90.2% |

<svg viewBox="0 0 730 104" xmlns="http://www.w3.org/2000/svg" font-family="ui-sans-serif, system-ui, sans-serif" font-size="12" role="img" aria-label="Benchmark: large-4000x3000.jpg">
  <line x1="160.0" y1="4" x2="160.0" y2="100" stroke="#30363d" stroke-width="0.5" stroke-dasharray="2,2"/>
  <text x="160.0" y="103" text-anchor="middle" fill="#6e83b8" font-size="10">0 ms</text>
  <line x1="277.5" y1="4" x2="277.5" y2="100" stroke="#30363d" stroke-width="0.5" stroke-dasharray="2,2"/>
  <text x="277.5" y="103" text-anchor="middle" fill="#6e83b8" font-size="10">35 ms</text>
  <line x1="395.0" y1="4" x2="395.0" y2="100" stroke="#30363d" stroke-width="0.5" stroke-dasharray="2,2"/>
  <text x="395.0" y="103" text-anchor="middle" fill="#6e83b8" font-size="10">70 ms</text>
  <line x1="512.5" y1="4" x2="512.5" y2="100" stroke="#30363d" stroke-width="0.5" stroke-dasharray="2,2"/>
  <text x="512.5" y="103" text-anchor="middle" fill="#6e83b8" font-size="10">105 ms</text>
  <line x1="630.0" y1="4" x2="630.0" y2="100" stroke="#30363d" stroke-width="0.5" stroke-dasharray="2,2"/>
  <text x="630.0" y="103" text-anchor="middle" fill="#6e83b8" font-size="10">139 ms</text>
  <text x="152" y="20" text-anchor="end" fill="#f1f5ff" font-weight="700">canvas-main</text>
  <rect x="160" y="10" width="429.9" height="18" fill="#7aa2ff" rx="3" opacity="1"/>
  <text x="595.8780487804609" y="23" fill="#5dd39e" font-weight="700">127.5 ms ⚡</text>
  <text x="152" y="52" text-anchor="end" fill="#cbd5ff" font-weight="500">webcodecs-worker</text>
  <rect x="160" y="42" width="466.3" height="18" fill="#61DAFB" rx="3" opacity="0.85"/>
  <text x="632.2912482065803" y="55" fill="#cbd5ff" font-weight="500">138.3 ms</text>
  <text x="152" y="84" text-anchor="end" fill="#cbd5ff" font-weight="500">offscreen-worker</text>
  <rect x="160" y="74" width="470.0" height="18" fill="#9c7cff" rx="3" opacity="0.85"/>
  <text x="636" y="87" fill="#cbd5ff" font-weight="500">139.4 ms</text>
</svg>

## Speedup vs canvas-main

| Fixture | Path | Median | Speedup |
| --- | --- | --- | --- |
| medium-1500x1000.jpg | `webcodecs-worker` | 38.4 ms | **0.83×** |
| large-4000x3000.jpg | `webcodecs-worker` | 138.3 ms | **0.92×** |
| medium-1500x1000.jpg | `offscreen-worker` | 38.5 ms | **0.82×** |
| large-4000x3000.jpg | `offscreen-worker` | 139.4 ms | **0.91×** |
| medium-1500x1000.jpg | `canvas-main` | 31.7 ms | **1.00×** |
| large-4000x3000.jpg | `canvas-main` | 127.5 ms | **1.00×** |

## Raw runs

### Config: `full`

#### medium-1500x1000.jpg

| Run | Path | Time | Ratio |
| --- | --- | --- | --- |
| 1 | `webcodecs-worker` | 38.7 ms | 18.8% |
| 2 | `webcodecs-worker` | 38.3 ms | 18.8% |
| 3 | `webcodecs-worker` | 37.5 ms | 18.8% |
| 4 | `webcodecs-worker` | 36.7 ms | 18.8% |
| 5 | `webcodecs-worker` | 37.2 ms | 18.8% |
| 6 | `webcodecs-worker` | 37.9 ms | 18.8% |
| 7 | `webcodecs-worker` | 38.4 ms | 18.8% |
| 8 | `webcodecs-worker` | 38.8 ms | 18.8% |
| 9 | `webcodecs-worker` | 38.5 ms | 18.8% |
| 10 | `webcodecs-worker` | 38.8 ms | 18.8% |

#### large-4000x3000.jpg

| Run | Path | Time | Ratio |
| --- | --- | --- | --- |
| 1 | `webcodecs-worker` | 138.0 ms | 90.2% |
| 2 | `webcodecs-worker` | 142.7 ms | 90.2% |
| 3 | `webcodecs-worker` | 140.8 ms | 90.2% |
| 4 | `webcodecs-worker` | 138.3 ms | 90.2% |
| 5 | `webcodecs-worker` | 137.2 ms | 90.2% |
| 6 | `webcodecs-worker` | 137.2 ms | 90.2% |
| 7 | `webcodecs-worker` | 142.6 ms | 90.2% |
| 8 | `webcodecs-worker` | 138.4 ms | 90.2% |
| 9 | `webcodecs-worker` | 137.2 ms | 90.2% |
| 10 | `webcodecs-worker` | 137.7 ms | 90.2% |

### Config: `no-webcodecs`

#### medium-1500x1000.jpg

| Run | Path | Time | Ratio |
| --- | --- | --- | --- |
| 1 | `offscreen-worker` | 37.6 ms | 18.8% |
| 2 | `offscreen-worker` | 38.7 ms | 18.8% |
| 3 | `offscreen-worker` | 38.7 ms | 18.8% |
| 4 | `offscreen-worker` | 38.0 ms | 18.8% |
| 5 | `offscreen-worker` | 37.7 ms | 18.8% |
| 6 | `offscreen-worker` | 38.5 ms | 18.8% |
| 7 | `offscreen-worker` | 38.6 ms | 18.8% |
| 8 | `offscreen-worker` | 38.8 ms | 18.8% |
| 9 | `offscreen-worker` | 37.9 ms | 18.8% |
| 10 | `offscreen-worker` | 37.2 ms | 18.8% |

#### large-4000x3000.jpg

| Run | Path | Time | Ratio |
| --- | --- | --- | --- |
| 1 | `offscreen-worker` | 137.8 ms | 90.2% |
| 2 | `offscreen-worker` | 144.1 ms | 90.2% |
| 3 | `offscreen-worker` | 141.4 ms | 90.2% |
| 4 | `offscreen-worker` | 139.3 ms | 90.2% |
| 5 | `offscreen-worker` | 140.1 ms | 90.2% |
| 6 | `offscreen-worker` | 139.3 ms | 90.2% |
| 7 | `offscreen-worker` | 139.5 ms | 90.2% |
| 8 | `offscreen-worker` | 137.8 ms | 90.2% |
| 9 | `offscreen-worker` | 137.2 ms | 90.2% |
| 10 | `offscreen-worker` | 139.4 ms | 90.2% |

### Config: `no-workers`

#### medium-1500x1000.jpg

| Run | Path | Time | Ratio |
| --- | --- | --- | --- |
| 1 | `canvas-main` | 31.7 ms | 18.8% |
| 2 | `canvas-main` | 32.4 ms | 18.8% |
| 3 | `canvas-main` | 31.7 ms | 18.8% |
| 4 | `canvas-main` | 32.0 ms | 18.8% |
| 5 | `canvas-main` | 32.4 ms | 18.8% |
| 6 | `canvas-main` | 31.4 ms | 18.8% |
| 7 | `canvas-main` | 31.5 ms | 18.8% |
| 8 | `canvas-main` | 31.3 ms | 18.8% |
| 9 | `canvas-main` | 31.5 ms | 18.8% |
| 10 | `canvas-main` | 30.8 ms | 18.8% |

#### large-4000x3000.jpg

| Run | Path | Time | Ratio |
| --- | --- | --- | --- |
| 1 | `canvas-main` | 127.5 ms | 90.2% |
| 2 | `canvas-main` | 127.0 ms | 90.2% |
| 3 | `canvas-main` | 129.1 ms | 90.2% |
| 4 | `canvas-main` | 127.9 ms | 90.2% |
| 5 | `canvas-main` | 128.6 ms | 90.2% |
| 6 | `canvas-main` | 127.3 ms | 90.2% |
| 7 | `canvas-main` | 126.3 ms | 90.2% |
| 8 | `canvas-main` | 126.1 ms | 90.2% |
| 9 | `canvas-main` | 127.2 ms | 90.2% |
| 10 | `canvas-main` | 127.9 ms | 90.2% |

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
