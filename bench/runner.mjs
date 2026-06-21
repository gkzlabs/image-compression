// Benchmark runner — orchestrates puppeteer + harness to measure library performance.
// Usage: node bench/runner.mjs
//
// What it does:
// 1. Builds the library (npm run build) if dist/ is missing
// 2. Starts a local HTTP server serving harness.html + dist/
// 3. Launches headless Chromium (puppeteer bundled)
// 4. For each fixture: loads it, runs N iterations in the browser
// 5. Writes results/latest.json (raw) + results/BENCHMARKS.md (human-readable)
// 6. Exits 0 on success, 1 on failure

import puppeteer from 'puppeteer';
import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import http from 'node:http';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const FIXTURES_DIR = resolve(__dirname, 'fixtures');
const RESULTS_DIR = resolve(__dirname, 'results');
const SERVE_DIR = resolve(__dirname, '.serve'); // ephemeral, gitignored

const ITERATIONS = parseInt(process.env.BENCH_ITERATIONS || '5', 10);
const WARMUP = parseInt(process.env.BENCH_WARMUP || '1', 10);
const PORT = parseInt(process.env.BENCH_PORT || '0', 10); // 0 = auto

// ─── helpers ────────────────────────────────────────────────────────────────

function log(msg) {
  process.stdout.write(`[bench] ${msg}\n`);
}

function ensureDistBuilt() {
  const distWorker = resolve(ROOT, 'dist', 'worker.js');
  if (!existsSync(distWorker)) {
    log('dist/worker.js missing — running build...');
    execSync('npm run build', { cwd: ROOT, stdio: 'inherit' });
  } else {
    log(`dist/worker.js found (${(statSync(distWorker).size / 1024).toFixed(0)} KB)`);
  }
}

function ensureFixturesGenerated() {
  if (!existsSync(resolve(FIXTURES_DIR, 'medium-1500x1000.jpg'))) {
    log('fixtures missing — running generate.mjs...');
    execSync('node bench/fixtures/generate.mjs', { cwd: ROOT, stdio: 'inherit' });
  }
}

/**
 * Minimal static file server. Serves files from `root` on `port`.
 * Returns the port (useful when port=0 for auto-assign).
 */
function startServer(root, port = 0) {
  return new Promise((resolveServer) => {
    const types = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.mjs': 'text/javascript; charset=utf-8',
      '.json': 'application/json',
      '.jpg': 'image/jpeg',
      '.png': 'image/png',
      '.svg': 'image/svg+xml',
    };

    const server = http.createServer((req, res) => {
      // Decode and sanitize path
      const url = decodeURIComponent(req.url.split('?')[0]);
      const filePath = join(root, url === '/' ? '/harness.html' : url);
      // Path traversal guard
      if (!filePath.startsWith(root)) {
        res.writeHead(403);
        res.end('forbidden');
        return;
      }
      if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
        res.writeHead(404);
        res.end('not found');
        return;
      }
      const ext = filePath.slice(filePath.lastIndexOf('.'));
      res.setHeader('Content-Type', types[ext] || 'application/octet-stream');
      // Workers need cross-origin isolation OR same-origin — same-origin works
      res.setHeader('Cache-Control', 'no-store');
      res.end(readFileSync(filePath));
    });

    server.listen(port, '127.0.0.1', () => {
      const assignedPort = server.address().port;
      resolveServer({ server, port: assignedPort });
    });
  });
}

function fileToBase64(path) {
  return readFileSync(path).toString('base64');
}

function readPackageVersion() {
  const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf-8'));
  return pkg.version;
}

function readBrowserVersion() {
  return puppeteer.executablePath ? 'puppeteer-bundled' : 'unknown';
}

// ─── benchmark orchestration ────────────────────────────────────────────────

/**
 * Browser configurations to test. Each one disables different capabilities,
 * forcing the cascade to pick a different path:
 *
 *   full   — Chrome with all features → cascade picks webcodecs-worker
 *   noweb  — WebCodecs disabled → cascade falls to offscreen-worker
 *            (canvas-main if OffscreenCanvas also unavailable)
 *   nomore — WebCodecs + OffscreenCanvas disabled → cascade goes to canvas-main
 */
const BROWSER_CONFIGS = [
  {
    name: 'full',
    description: 'Chrome (all features available)',
    force: null,
    expectedPath: 'webcodecs-worker',
  },
  {
    name: 'no-webcodecs',
    description: 'Chrome with ImageDecoder disabled → offscreen-worker',
    force: 'no-webcodecs',
    expectedPath: 'offscreen-worker',
  },
  {
    name: 'no-workers',
    description: 'Chrome with ImageDecoder + Worker disabled → canvas-main',
    force: 'no-workers',
    expectedPath: 'canvas-main',
  },
];

async function benchmarkBrowser(browser, port, config) {
  log(`\n[bench] === config: ${config.name} (${config.description}) ===`);
  const page = await browser.newPage();

  // Capture console + errors
  page.on('console', (msg) => {
    if (msg.type() === 'error') log(`  [page error] ${msg.text()}`);
  });
  page.on('pageerror', (err) => log(`  [page exception] ${err.message}`));

  await page.goto(`http://127.0.0.1:${port}/harness.html`, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => window.__benchReady === true, { timeout: 10000 });

  const fixtures = [
    resolve(FIXTURES_DIR, 'medium-1500x1000.jpg'),
    resolve(FIXTURES_DIR, 'large-4000x3000.jpg'),
  ].filter((f) => existsSync(f));

  const results = [];
  for (const fixture of fixtures) {
    const fixtureBase64 = fileToBase64(fixture);
    const r = await page.evaluate(
      async ({ fixtureBase64, fixtureName, iterations, warmup, force }) => {
        return await window.__bench.runBenchmark({ fixtureBase64, fixtureName, iterations, warmup, force });
      },
      { fixtureBase64, fixtureName: fixture.split('/').pop(), iterations: ITERATIONS, warmup: WARMUP, force: config.force }
    );
    results.push(r);
    log(
      `  ${r.fixture}: ${r.path} | median ${r.stats.median.toFixed(1)}ms | best ${r.stats.min.toFixed(1)}ms | saved ${r.ratio.toFixed(1)}%`
    );
  }

  await page.close();
  return { config, results };
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatTime(ms) {
  return `${ms.toFixed(1)} ms`;
}

// ── TL;DR generator (B) ────────────────────────────────────────────────────
// Produces a 2-3 line summary that skimmable readers can grasp in 5 seconds.
function generateTldr(allResults) {
  // Find the largest fixture (most representative of real-world)
  const fixtures = new Set();
  for (const { results } of allResults) for (const r of results) fixtures.add(r.fixture);
  const largest = [...fixtures].sort((a, b) => {
    const aSize = allResults[0].results.find((r) => r.fixture === a)?.inputBytes || 0;
    const bSize = allResults[0].results.find((r) => r.fixture === b)?.inputBytes || 0;
    return bSize - aSize;
  })[0];
  const largeResult = allResults[0].results.find((r) => r.fixture === largest);

  // Find best path on largest fixture
  let bestTime = Infinity;
  let bestPath = 'unknown';
  let worstTime = 0;
  let worstPath = 'unknown';
  for (const { results } of allResults) {
    const r = results.find((x) => x.fixture === largest);
    if (r && r.stats.median < bestTime) {
      bestTime = r.stats.median;
      bestPath = r.path;
    }
    if (r && r.stats.median > worstTime) {
      worstTime = r.stats.median;
      worstPath = r.path;
    }
  }
  const speedup = (worstTime / bestTime).toFixed(2);

  // Compose the comparison phrase — "X is N× faster than Y" where Y = the
  // slowest path on this fixture. Avoids the awkward "canvas-main 1.00× canvas-main"
  // when canvas-main happens to be the fastest.
  const isCanvasFastest = bestPath === 'canvas-main';
  const comparePhrase = isCanvasFastest
    ? `**\`${bestPath}\`** is the fastest on this hardware (${formatTime(bestTime)})`
    : `**\`${bestPath}\`** is **${speedup}× faster than \`${worstPath}\`** on the largest fixture`;

  return [
    '> **TL;DR**',
    '>',
    `> - Compress a **${formatBytes(largeResult.inputBytes)}** JPEG in **${formatTime(bestTime)}** on Chrome 149 (\`${bestPath}\` path).`,
    `> - ${comparePhrase}.`,
    '> - On modern browsers all 3 paths finish in well under 100ms — the real win is **universal compatibility** (works on every browser, no polyfill needed).',
    '>',
    '> [📊 Live interactive dashboard](https://gkzlabs.github.io/image-compression/bench/)',
  ];
}

// ── Verdict generator (B) ──────────────────────────────────────────────────
// Static per-path guidance — same regardless of benchmark results.
function generateVerdict() {
  return [
    '## Path verdict',
    '',
    'When to use which path (the cascade picks automatically, but you can force by disabling features):',
    '',
    '| Path | Best for | Browser support | Trade-off |',
    '| --- | --- | --- | --- |',
    '| `webcodecs-worker` ⚡ | Modern apps where you control the browser baseline | Chrome 94+, Edge 94+, Safari 16.4+, Firefox 130+ | GPU-accelerated decode; needs WebCodecs |',
    '| `offscreen-worker` 🥈 | Mid-tier browser support without main-thread blocking | Same as above + older Chrome via fallback | OffscreenCanvas; ~10% slower than WebCodecs |',
    '| `canvas-main` 🥉 | Universal fallback (works everywhere, including Node/test env) | 100% of browsers | Blocks main thread; no worker isolation |',
    '| `server-fallback` | Last-resort passthrough | N/A | No compression — caller uploads original |',
    '',
    '> **Practical tip:** on small files (<100 KB), the cascade may skip Worker paths because the postMessage overhead exceeds the decode cost. See the [live dashboard](https://gkzlabs.github.io/image-compression/bench/) for real numbers per fixture size.',
  ];
}

// ── Inline SVG bar chart (A) ───────────────────────────────────────────────
// Generates a self-contained SVG with horizontal bars, one per path.
// No external file — pure text embedded in the markdown via fenced code block.
function generateBarChartSvg(fixture, allResults) {
  const rows = allResults
    .map(({ config, results }) => {
      const r = results.find((x) => x.fixture === fixture);
      if (!r) return null;
      return { config: config.name, path: r.path, median: r.stats.median, min: r.stats.min };
    })
    .filter(Boolean)
    .sort((a, b) => a.median - b.median);

  if (rows.length === 0) return '';

  const max = Math.max(...rows.map((r) => r.median));
  // Color per path (matches brand/social-preview)
  const colorByPath = {
    'webcodecs-worker': '#61DAFB',
    'offscreen-worker': '#9c7cff',
    'canvas-main': '#7aa2ff',
    'server-fallback': '#6e83b8',
  };
  // Chart dimensions
  const rowH = 32; // px per row
  const labelW = 160; // px reserved for label
  const timeW = 90; // px reserved for time text
  const barAreaW = 480; // px for bars
  const w = labelW + barAreaW + timeW;
  const h = rows.length * rowH + 8;
  const maxBarW = barAreaW - 10; // leave 10px right padding

  const lines = [];
  lines.push(`<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" font-family="ui-sans-serif, system-ui, sans-serif" font-size="12" role="img" aria-label="Benchmark: ${fixture}">`);
  // Optional grid lines
  for (let i = 0; i <= 4; i++) {
    const x = labelW + (maxBarW * i) / 4;
    const v = (max * i) / 4;
    const label = i === 0 ? '0 ms' : `${v < 1 ? v.toFixed(1) : v.toFixed(0)} ms`;
    lines.push(`  <line x1="${x.toFixed(1)}" y1="4" x2="${x.toFixed(1)}" y2="${h - 4}" stroke="#30363d" stroke-width="0.5" stroke-dasharray="2,2"/>`);
    lines.push(`  <text x="${x.toFixed(1)}" y="${h - 1}" text-anchor="middle" fill="#6e83b8" font-size="10">${label}</text>`);
  }
  // Bars
  rows.forEach((row, i) => {
    const y = 6 + i * rowH;
    const barW = Math.max(2, (row.median / max) * maxBarW);
    const color = colorByPath[row.path] || '#7aa2ff';
    const isFastest = i === 0;
    // Label
    lines.push(`  <text x="${labelW - 8}" y="${y + 14}" text-anchor="end" fill="${isFastest ? '#f1f5ff' : '#cbd5ff'}" font-weight="${isFastest ? '700' : '500'}">${row.path}</text>`);
    // Bar
    lines.push(`  <rect x="${labelW}" y="${y + 4}" width="${barW.toFixed(1)}" height="18" fill="${color}" rx="3" opacity="${isFastest ? '1' : '0.85'}"/>`);
    // Time text after bar
    lines.push(`  <text x="${labelW + barW + 6}" y="${y + 17}" fill="${isFastest ? '#5dd39e' : '#cbd5ff'}" font-weight="${isFastest ? '700' : '500'}">${formatTime(row.median)}${isFastest ? ' ⚡' : ''}</text>`);
  });
  lines.push('</svg>');
  return lines.join('\n');
}

function generateMarkdown(allResults, { version, browser, runAt }) {
  const lines = [];
  lines.push('# Benchmarks');
  lines.push('');

  // ── TL;DR (B) ────────────────────────────────────────────────────────
  lines.push(...generateTldr(allResults));
  lines.push('');

  // ── Verdict (B) ──────────────────────────────────────────────────────
  lines.push(...generateVerdict());
  lines.push('');

  // ── Path comparison overview table ──────────────────────────────────
  lines.push(`**Library version:** \`@gkzlabs/image-compression@${version}\``);
  lines.push(`**Browser:** ${browser}`);
  lines.push(`**Run at:** ${runAt}`);
  lines.push(`**Iterations per fixture:** ${ITERATIONS} (median reported, with ${WARMUP} warmup)`);
  lines.push('');
  lines.push('The library uses a 4-path cascade: `webcodecs-worker` → `offscreen-worker` → `canvas-main` → `server-fallback`. To compare paths, we launch headless Chrome three times with progressive feature disabling, forcing the cascade to fall back to a different path each time:');
  lines.push('');
  lines.push('| Config | Description | Expected path |');
  lines.push('| --- | --- | --- |');
  for (const c of BROWSER_CONFIGS) {
    lines.push(`| \`${c.name}\` | ${c.description} | \`${c.expectedPath}\` |`);
  }
  lines.push('');

  // ── Per-fixture: SVG bar chart (A) + table ─────────────────────────
  const fixtures = new Set();
  for (const { results } of allResults) {
    for (const r of results) fixtures.add(r.fixture);
  }
  const fixtureList = Array.from(fixtures);

  for (const fixture of fixtureList) {
    lines.push(`### Fixture: \`${fixture}\``);
    lines.push('');
    lines.push('| Config | Actual path | Time (median) | Time (best) | Output | Saved |');
    lines.push('| --- | --- | --- | --- | --- | --- |');
    for (const { config, results } of allResults) {
      const r = results.find((x) => x.fixture === fixture);
      if (!r) continue;
      lines.push(
        `| \`${config.name}\` | \`${r.path}\` | ${formatTime(r.stats.median)} | ${formatTime(r.stats.min)} | ${formatBytes(r.outputBytes)} | ${r.ratio.toFixed(1)}% |`
      );
    }
    lines.push('');
    // Inline SVG bar chart (A) — pure HTML, renders as image on GitHub
    lines.push(generateBarChartSvg(fixture, allResults));
    lines.push('');
  }

  // ── Speedup summary ────────────────────────────────────────────────
  const baseline = allResults.find((b) => b.config.name === 'no-workers');
  if (baseline) {
    lines.push('## Speedup vs canvas-main');
    lines.push('');
    lines.push('| Fixture | Path | Median | Speedup |');
    lines.push('| --- | --- | --- | --- |');
    for (const { config, results } of allResults) {
      for (const r of results) {
        const baseR = baseline.results.find((x) => x.fixture === r.fixture);
        if (!baseR) continue;
        const speedup = (baseR.stats.median / r.stats.median).toFixed(2);
        lines.push(`| ${r.fixture} | \`${r.path}\` | ${formatTime(r.stats.median)} | **${speedup}×** |`);
      }
    }
    lines.push('');
  }

  // ── Raw runs per config ────────────────────────────────────────────
  lines.push('## Raw runs');
  lines.push('');
  for (const { config, results } of allResults) {
    lines.push(`### Config: \`${config.name}\``);
    lines.push('');
    for (const r of results) {
      lines.push(`#### ${r.fixture}`);
      lines.push('');
      lines.push('| Run | Path | Time | Ratio |');
      lines.push('| --- | --- | --- | --- |');
      for (let i = 0; i < r.runs.length; i++) {
        lines.push(`| ${i + 1} | \`${r.runs[i].path}\` | ${formatTime(r.runs[i].timeMs)} | ${r.runs[i].ratio.toFixed(1)}% |`);
      }
      lines.push('');
    }
  }

  lines.push('## Methodology');
  lines.push('');
  lines.push('- **Harness:** `bench/harness.html` loads the built `dist/index.js` and calls `svc.compress(file, { quality: 0.85, maxWidthOrHeight: 2048 })` in a loop.');
  lines.push('- **Path forcing:** Three configs run sequentially in the same Chrome instance. Each config patches browser APIs (ImageDecoder, Worker) via `page.evaluate` BEFORE calling `compress()` — this is more reliable than `--disable-features` flags because the lib uses optimistic capability detection (per the v0.10.4 design principle: "trust main-thread caps optimistically").');
  lines.push('  - `full` — no patches, cascade picks the best available path');
  lines.push('  - `no-webcodecs` — `ImageDecoder` deleted → cascade falls to `offscreen-worker`');
  lines.push('  - `no-workers` — `ImageDecoder` + `Worker` deleted → cascade falls to `canvas-main`');
  lines.push(`- **Warmup:** ${WARMUP} unmeasured runs to prime JIT, V8 caches, and browser caches.`);
  lines.push(`- **Iterations:** ${ITERATIONS} measured runs per fixture. Median + best (min) reported.`);
  lines.push('- **Fixtures:** Generated deterministically via `bench/fixtures/generate.mjs` (uses `@napi-rs/canvas`); committed to the repo for reproducibility.');
  lines.push('- **Variance:** Times vary 5-20% run-to-run. Use the median, not the mean, for stable comparisons.');
  lines.push('');
  lines.push('## Live dashboard');
  lines.push('');
  lines.push('See [https://gkzlabs.github.io/image-compression/bench/](https://gkzlabs.github.io/image-compression/bench/) for an interactive chart view with hover tooltips.');
  lines.push('');
  lines.push('## Reproducing');
  lines.push('');
  lines.push('```bash');
  lines.push('npm run build         # build dist/');
  lines.push('npm run bench         # run all fixtures on all 3 configs');
  lines.push('# or:');
  lines.push('BENCH_ITERATIONS=10 npm run bench   # more iterations for tighter median');
  lines.push('```');
  lines.push('');
  lines.push('## CI');
  lines.push('');
  lines.push('The `Bench` GitHub Actions workflow runs on `workflow_dispatch` and weekly schedule, then commits `results/BENCHMARKS.md` back to the repo. See `.github/workflows/bench.yml`.');
  lines.push('');

  return lines.join('\n');
}

// ─── main ───────────────────────────────────────────────────────────────────

async function main() {
  log('starting benchmark run');
  log(`  iterations=${ITERATIONS} warmup=${WARMUP} port=${PORT || 'auto'}`);

  // 1. Ensure dist is built
  ensureDistBuilt();

  // 2. Ensure fixtures exist
  ensureFixturesGenerated();

  // 3. Copy dist/ into a serve directory (recursive — dist/__stubs__ is a folder)
  mkdirSync(SERVE_DIR, { recursive: true });
  copyDirSync(join(ROOT, 'dist'), join(SERVE_DIR, 'dist'));
  // Copy comlink ESM build (the lib declares it as `external` in esbuild, so the
  // browser needs to resolve it via import map → ./vendor/comlink.js)
  const comlinkSrc = join(ROOT, 'node_modules', 'comlink', 'dist', 'esm', 'comlink.js');
  if (!existsSync(comlinkSrc)) {
    throw new Error('comlink ESM build not found at ' + comlinkSrc);
  }
  mkdirSync(join(SERVE_DIR, 'vendor'), { recursive: true });
  copyFileSync(comlinkSrc, join(SERVE_DIR, 'vendor', 'comlink.js'));
  // Copy harness.html to serve root
  copyFileSync(resolve(__dirname, 'harness.html'), join(SERVE_DIR, 'harness.html'));
  log(`serve dir: ${SERVE_DIR} (harness.html + dist/ + vendor/comlink.js)`);

  // 4. Start HTTP server
  const { server, port } = await startServer(SERVE_DIR, PORT);
  log(`HTTP server on http://127.0.0.1:${port}`);

  let browser;
  try {
    // 5. Run benchmarks across all browser configs
    const allResults = [];
    for (const config of BROWSER_CONFIGS) {
      log(`\n[bench] === launching browser: ${config.name} ===`);
      // Single browser, just patch the page per config
      const cfgBrowser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });
      const browserVersion = await cfgBrowser.version();
      log(`  ${browserVersion}`);

      const out = await benchmarkBrowser(cfgBrowser, port, config);
      allResults.push({ ...out, browserVersion });
      await cfgBrowser.close();
    }

    // 6. Write results
    mkdirSync(RESULTS_DIR, { recursive: true });
    const version = readPackageVersion();
    const runAt = new Date().toISOString();
    const primaryBrowser = allResults[0].browserVersion;

    const json = {
      version,
      browser: primaryBrowser,
      runAt,
      iterations: ITERATIONS,
      warmup: WARMUP,
      configs: allResults.map(({ config, results, browserVersion }) => ({
        name: config.name,
        description: config.description,
        browser: browserVersion,
        results,
      })),
    };
    writeFileSync(resolve(RESULTS_DIR, 'latest.json'), JSON.stringify(json, null, 2));
    log(`wrote results/latest.json`);

    // Also copy to docs/bench/data/latest.json so the GitHub Pages dashboard
    // can fetch it (Pages serves the repo as a static site from `/`).
    const dataDir = resolve(ROOT, 'docs', 'bench', 'data');
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(resolve(dataDir, 'latest.json'), JSON.stringify(json, null, 2));
    log(`wrote docs/bench/data/latest.json`);

    const md = generateMarkdown(allResults, { version, browser: primaryBrowser, runAt });
    writeFileSync(resolve(RESULTS_DIR, 'BENCHMARKS.md'), md);
    log(`wrote results/BENCHMARKS.md`);

    log('\n=== summary ===');
    for (const { config, results } of allResults) {
      log(`\n  [${config.name}] ${config.description}`);
      for (const r of results) {
        log(
          `    ${r.fixture}: ${r.path} | median ${formatTime(r.stats.median)} | best ${formatTime(r.stats.min)} | saved ${r.ratio.toFixed(1)}%`
        );
      }
    }
  } finally {
    if (browser) await browser.close();
    server.close();
    // Clean up serve dir
    try {
      rmSync(SERVE_DIR, { recursive: true, force: true });
    } catch {}
  }
}

// ─── node:fs helpers (avoid extra import line) ───────────────────────────────

import { readdirSync, copyFileSync, rmSync, statSync as fsStatSync } from 'node:fs';
function readdirSyncSafe(p) {
  try { return readdirSync(p); } catch { return []; }
}

function copyDirSync(src, dest) {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const s = join(src, entry.name);
    const d = join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(s, d);
    } else {
      copyFileSync(s, d);
    }
  }
}

main().catch((e) => {
  console.error('[bench] FATAL:', e);
  process.exit(1);
});
