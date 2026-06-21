# Benchmarks

**Library version:** `@gkzlabs/image-compression@0.10.25`
**Browser:** Chrome/149.0.7827.22
**Run at:** 2026-06-21T14:22:29.569Z
**Iterations per fixture:** 5 (median reported, with 1 warmup)

## Path comparison

The library uses a 4-path cascade: `webcodecs-worker` → `offscreen-worker` → `canvas-main` → `server-fallback`. To compare paths, we launch headless Chrome three times with progressive feature disabling, forcing the cascade to fall back to a different path each time:

| Config | Description | Expected path |
| --- | --- | --- |
| `full` | Chrome (all features available) | `webcodecs-worker` |
| `no-webcodecs` | Chrome with ImageDecoder disabled → offscreen-worker | `offscreen-worker` |
| `no-workers` | Chrome with ImageDecoder + Worker disabled → canvas-main | `canvas-main` |

### Fixture: `medium-1500x1000.jpg`

| Config | Actual path | Time (median) | Time (best) | Output | Saved |
| --- | --- | --- | --- | --- | --- |
| `full` | `webcodecs-worker` | 24.8 ms | 21.7 ms | 448.8 KB | 18.8% |
| `no-webcodecs` | `offscreen-worker` | 23.9 ms | 22.1 ms | 448.8 KB | 18.8% |
| `no-workers` | `canvas-main` | 22.2 ms | 19.3 ms | 448.8 KB | 18.8% |

### Fixture: `large-4000x3000.jpg`

| Config | Actual path | Time (median) | Time (best) | Output | Saved |
| --- | --- | --- | --- | --- | --- |
| `full` | `webcodecs-worker` | 76.2 ms | 73.2 ms | 406.9 KB | 90.4% |
| `no-webcodecs` | `offscreen-worker` | 81.5 ms | 80.8 ms | 406.9 KB | 90.4% |
| `no-workers` | `canvas-main` | 83.7 ms | 75.1 ms | 406.9 KB | 90.4% |

## Speedup vs canvas-main

| Fixture | Path | Median | Speedup |
| --- | --- | --- | --- |
| medium-1500x1000.jpg | `webcodecs-worker` | 24.8 ms | **0.90×** |
| large-4000x3000.jpg | `webcodecs-worker` | 76.2 ms | **1.10×** |
| medium-1500x1000.jpg | `offscreen-worker` | 23.9 ms | **0.93×** |
| large-4000x3000.jpg | `offscreen-worker` | 81.5 ms | **1.03×** |
| medium-1500x1000.jpg | `canvas-main` | 22.2 ms | **1.00×** |
| large-4000x3000.jpg | `canvas-main` | 83.7 ms | **1.00×** |

## Raw runs

### Config: `full`

#### medium-1500x1000.jpg

| Run | Path | Time | Ratio |
| --- | --- | --- | --- |
| 1 | `webcodecs-worker` | 24.8 ms | 18.8% |
| 2 | `webcodecs-worker` | 29.6 ms | 18.8% |
| 3 | `webcodecs-worker` | 27.4 ms | 18.8% |
| 4 | `webcodecs-worker` | 23.2 ms | 18.8% |
| 5 | `webcodecs-worker` | 21.7 ms | 18.8% |

#### large-4000x3000.jpg

| Run | Path | Time | Ratio |
| --- | --- | --- | --- |
| 1 | `webcodecs-worker` | 76.2 ms | 90.4% |
| 2 | `webcodecs-worker` | 76.2 ms | 90.4% |
| 3 | `webcodecs-worker` | 73.2 ms | 90.4% |
| 4 | `webcodecs-worker` | 75.0 ms | 90.4% |
| 5 | `webcodecs-worker` | 76.5 ms | 90.4% |

### Config: `no-webcodecs`

#### medium-1500x1000.jpg

| Run | Path | Time | Ratio |
| --- | --- | --- | --- |
| 1 | `offscreen-worker` | 34.1 ms | 18.8% |
| 2 | `offscreen-worker` | 31.5 ms | 18.8% |
| 3 | `offscreen-worker` | 23.9 ms | 18.8% |
| 4 | `offscreen-worker` | 23.2 ms | 18.8% |
| 5 | `offscreen-worker` | 22.1 ms | 18.8% |

#### large-4000x3000.jpg

| Run | Path | Time | Ratio |
| --- | --- | --- | --- |
| 1 | `offscreen-worker` | 89.2 ms | 90.4% |
| 2 | `offscreen-worker` | 85.1 ms | 90.4% |
| 3 | `offscreen-worker` | 81.1 ms | 90.4% |
| 4 | `offscreen-worker` | 81.5 ms | 90.4% |
| 5 | `offscreen-worker` | 80.8 ms | 90.4% |

### Config: `no-workers`

#### medium-1500x1000.jpg

| Run | Path | Time | Ratio |
| --- | --- | --- | --- |
| 1 | `canvas-main` | 22.5 ms | 18.8% |
| 2 | `canvas-main` | 22.2 ms | 18.8% |
| 3 | `canvas-main` | 26.9 ms | 18.8% |
| 4 | `canvas-main` | 19.6 ms | 18.8% |
| 5 | `canvas-main` | 19.3 ms | 18.8% |

#### large-4000x3000.jpg

| Run | Path | Time | Ratio |
| --- | --- | --- | --- |
| 1 | `canvas-main` | 84.0 ms | 90.4% |
| 2 | `canvas-main` | 83.7 ms | 90.4% |
| 3 | `canvas-main` | 84.7 ms | 90.4% |
| 4 | `canvas-main` | 80.2 ms | 90.4% |
| 5 | `canvas-main` | 75.1 ms | 90.4% |

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

## Reproducing

```bash
npm run build         # build dist/
npm run bench         # run all fixtures on all 3 configs
# or:
BENCH_ITERATIONS=10 npm run bench   # more iterations for tighter median
```

## CI

The `Bench` GitHub Actions workflow runs on `workflow_dispatch` and weekly schedule, then commits `results/BENCHMARKS.md` back to the repo. See `.github/workflows/bench.yml`.
