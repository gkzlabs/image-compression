# Benchmarks

Performance benchmarks for the 3 main cascade paths.

## Quick start

```bash
npm run build && npm run bench
```

Output is written to `results/BENCHMARKS.md` (human-readable) and `results/latest.json` (raw).

## What it does

1. Builds the library (`dist/index.js`)
2. Generates 2 deterministic JPEG fixtures (medium 553KB + large 4.14MB)
3. Launches headless Chrome 3 times — each run patches browser APIs to force the cascade to pick a different path
4. Runs each path 5 times (1 warmup + 5 measured) per fixture
5. Aggregates results (median + best) into `BENCHMARKS.md`

## Files

```
bench/
├── README.md                # this file
├── harness.html             # web page that runs the lib in-browser
├── runner.mjs               # Node script: puppeteer + HTTP server + aggregation
├── fixtures/
│   ├── generate.mjs         # creates deterministic JPEG fixtures
│   ├── medium-1500x1000.jpg # committed
│   └── large-4000x3000.jpg  # committed
└── results/
    ├── BENCHMARKS.md        # generated, committed
    └── latest.json          # generated, gitignored
```

## How path forcing works

The library's `selectPaths()` is intentionally optimistic (per v0.10.4 design) — it tries Worker paths even if capability detection says they might fail. So Chrome's `--disable-features` flags don't reliably force path selection.

Instead, the harness uses `page.evaluate` to patch browser APIs BEFORE calling `compress()`:

| Config | Patches | Cascade falls to |
| --- | --- | --- |
| `full` | (none) | best available (usually `webcodecs-worker`) |
| `no-webcodecs` | `ImageDecoder = undefined` | `offscreen-worker` |
| `no-workers` | `ImageDecoder = undefined` + `Worker` throws | `canvas-main` |

## Environment variables

| Var | Default | Description |
| --- | --- | --- |
| `BENCH_ITERATIONS` | `5` | Measured runs per fixture (median) |
| `BENCH_WARMUP` | `1` | Warmup runs (not measured) |
| `BENCH_PORT` | `0` (auto) | HTTP server port for the harness |

Example: `BENCH_ITERATIONS=20 npm run bench` for tighter medians.

## CI

The `.github/workflows/bench.yml` workflow runs on `workflow_dispatch` and weekly schedule. It commits updated `results/BENCHMARKS.md` back to the repo.

## Interpreting results

Times vary 5-20% run-to-run. Use the **median**, not the mean, for stable comparisons.

The "Speedup vs canvas-main" table is a relative comparison. Note that for small files in headless Chrome on fast hardware, all paths are similar — the differences show up more on:
- Slow CPUs (mobile devices)
- Large files (10+ MB)
- Under contention (other tabs, processes)

Use the benchmark to detect **regressions** (sudden 2-3x slowdown) more than to compare absolute speeds.
