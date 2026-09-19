#!/usr/bin/env node
/**
 * Browser smoke test — proves the SHIPPED bundle works in a real browser.
 *
 * Why this exists: the unit suite runs on happy-dom with @napi-rs/canvas as a
 * Canvas2D polyfill, so it cannot cover the parts that actually break in
 * production — real Worker loading, OffscreenCanvas, WebCodecs, and
 * `new URL('./worker.js', import.meta.url)` resolution. Every "works on my
 * machine, 404 in production" bug in this project's history lived in that gap.
 *
 * What it does:
 *   1. Ensures dist/ is built and the bench fixture exists
 *   2. Serves the repo root over HTTP (so /dist/* is reachable same-origin)
 *   3. Loads test/smoke.html in real Chromium and drives window.__icSmoke
 *   4. Asserts each cascade path, the __IC_WORKER_URL escape hatch, and — most
 *      importantly — that a worker URL that 404s makes the cascade FALL BACK
 *      instead of hanging forever
 *
 * Usage:
 *   npm run test:browser
 *   SMOKE_CHROME=/path/to/chrome npm run test:browser   # e.g. Chrome 149
 *
 * Exit code 0 = all cases passed (skips allowed), 1 = a failure.
 */

import puppeteer from 'puppeteer';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import http from 'node:http';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const FIXTURE = resolve(ROOT, 'bench', 'fixtures', 'medium-1500x1000.jpg');

const CASE_TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS || 30_000);
const MAX_EDGE = 1024;

const results = [];

function log(msg) {
  process.stdout.write(`[smoke] ${msg}\n`);
}

function record(name, status, detail) {
  results.push({ name, status, detail });
  const icon = status === 'PASS' ? '✓' : status === 'SKIP' ? '○' : '✗';
  process.stdout.write(`  ${icon} ${name} — ${detail}\n`);
}

// ─── setup ──────────────────────────────────────────────────────────────────

function ensureBuild() {
  const bundle = resolve(ROOT, 'dist', 'index.js');
  const worker = resolve(ROOT, 'dist', 'worker.js');
  if (existsSync(bundle) && existsSync(worker)) return;
  log('dist/ missing — running build...');
  execSync('npm run build', { cwd: ROOT, stdio: 'inherit' });
}

function ensureFixture() {
  if (!existsSync(FIXTURE)) {
    log('bench fixture missing — generating...');
    execSync('node bench/fixtures/generate.mjs', { cwd: ROOT, stdio: 'inherit' });
  }
  if (!existsSync(FIXTURE)) throw new Error(`fixture missing: ${FIXTURE}`);
  return readFileSync(FIXTURE).toString('base64');
}

/** Minimal static server rooted at the repo (serves /dist/* and /test/*). */
function startServer(root) {
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.json': 'application/json',
    '.jpg': 'image/jpeg',
    '.png': 'image/png',
  };
  return new Promise((res) => {
    const server = http.createServer((req, res) => {
      const url = decodeURIComponent(req.url.split('?')[0]);
      const filePath = join(root, url);
      if (!filePath.startsWith(root) || !existsSync(filePath) || statSync(filePath).isDirectory()) {
        res.writeHead(404);
        res.end('not found');
        return;
      }
      const ext = filePath.slice(filePath.lastIndexOf('.'));
      res.setHeader('Content-Type', types[ext] || 'application/octet-stream');
      res.setHeader('Cache-Control', 'no-store');
      res.end(readFileSync(filePath));
    });
    server.listen(0, '127.0.0.1', () => res({ server, port: server.address().port }));
  });
}

/** page.evaluate + hard timeout, so a hang is a failure instead of a stall. */
async function evalCase(page, args) {
  return page.evaluate(
    async ({ args, timeoutMs }) => {
      const timeout = new Promise((res) => setTimeout(() => res({ hung: true }), timeoutMs));
      return Promise.race([window.__icSmoke.compress(args), timeout]);
    },
    { args, timeoutMs: CASE_TIMEOUT_MS },
  );
}

// ─── main ───────────────────────────────────────────────────────────────────

async function main() {
  ensureBuild();
  const fixtureBase64 = ensureFixture();
  const { server, port } = await startServer(ROOT);
  const base = `http://127.0.0.1:${port}`;

  const launchOptions = { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] };
  if (process.env.SMOKE_CHROME) launchOptions.executablePath = process.env.SMOKE_CHROME;
  const browser = await puppeteer.launch(launchOptions);
  const browserVersion = await browser.version();
  log(`browser: ${browserVersion}`);
  log(`fixture: ${(statSync(FIXTURE).size / 1024).toFixed(0)} KB\n`);

  const page = await browser.newPage();
  const consoleLines = [];
  page.on('console', (msg) => consoleLines.push(`${msg.type()}: ${msg.text()}`));
  page.on('pageerror', (err) => consoleLines.push(`pageerror: ${err.message}`));

  try {
    await page.goto(`${base}/test/smoke.html`, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => window.__smokeReady === true, { timeout: 15_000 });

    const caps = await page.evaluate(() => window.__icSmoke.capabilities());
    log(`capabilities: ${JSON.stringify(caps)}\n`);

    const common = { fixtureBase64, name: 'medium-1500x1000.jpg' };
    const opts = { quality: 0.85, maxWidthOrHeight: MAX_EDGE };

    // 1–3. Each explicit cascade path
    for (const path of ['webcodecs-worker', 'offscreen-worker', 'canvas-main']) {
      const r = await evalCase(page, { ...common, options: { ...opts, forcePath: path } });
      if (r.hung) {
        record(`forcePath: ${path}`, 'FAIL', `hung > ${CASE_TIMEOUT_MS}ms`);
      } else if (!r.ok) {
        if (path === 'canvas-main') {
          record(`forcePath: ${path}`, 'FAIL', `${r.code}: ${r.message}`);
        } else {
          record(`forcePath: ${path}`, 'SKIP', `not viable here (${r.code})`);
        }
      } else if (r.path !== path) {
        record(`forcePath: ${path}`, 'FAIL', `reported path ${r.path}`);
      } else if (path !== 'server-fallback' && r.compressedSize >= r.originalSize) {
        record(`forcePath: ${path}`, 'FAIL', `no size win (${r.compressedSize} >= ${r.originalSize})`);
      } else {
        record(
          `forcePath: ${path}`,
          'PASS',
          `${r.width}x${r.height} ${(r.compressedSize / 1024).toFixed(0)}KB (-${(100 - (r.compressedSize / r.originalSize) * 100).toFixed(0)}%) ${r.durationMs}ms`,
        );
      }
    }

    // 4. server-fallback returns the original bytes untouched
    {
      const r = await evalCase(page, { ...common, options: { ...opts, forcePath: 'server-fallback' } });
      if (r.ok && r.path === 'server-fallback' && r.compressedSize === r.originalSize) {
        record('forcePath: server-fallback', 'PASS', `original bytes returned (${(r.originalSize / 1024).toFixed(0)}KB)`);
      } else {
        record('forcePath: server-fallback', 'FAIL', JSON.stringify(r).slice(0, 160));
      }
    }

    // 5. Default cascade (no forcePath) — the path a real user hits
    {
      const r = await evalCase(page, { ...common, options: opts });
      if (r.ok && r.compressedSize < r.originalSize) {
        record('cascade (default)', 'PASS', `picked ${r.path}, ${(r.compressedSize / 1024).toFixed(0)}KB, max edge ${Math.max(r.width, r.height)}`);
      } else {
        record('cascade (default)', 'FAIL', JSON.stringify(r).slice(0, 160));
      }
    }

    // 6. maxSizeMB budget is honoured on the real encode path
    {
      const r = await evalCase(page, { ...common, options: { ...opts, maxSizeMB: 0.2 } });
      const budget = 0.2 * 1024 * 1024;
      if (r.ok && r.compressedSize <= budget) {
        record('maxSizeMB: 0.2', 'PASS', `${(r.compressedSize / 1024).toFixed(0)}KB ≤ 205KB (${r.path})`);
      } else {
        record('maxSizeMB: 0.2', 'FAIL', r.ok ? `${r.compressedSize} bytes > budget` : r.code);
      }
    }

    // 7. __IC_WORKER_URL escape hatch (absolute URL — the Chrome 149 rule)
    {
      const r = await evalCase(page, { ...common, options: opts, workerUrl: '/dist/worker.js' });
      if (r.ok && String(r.path).endsWith('worker')) {
        record('__IC_WORKER_URL override', 'PASS', `used ${r.path} from the override URL`);
      } else {
        record('__IC_WORKER_URL override', 'FAIL', JSON.stringify(r).slice(0, 160));
      }
    }

    // 8. REGRESSION GUARD (P0, 2026-09-19): a worker URL that 404s must make the
    //    cascade fall back — never hang. Before the rpc.ts fail-fast fix the
    //    RPC promise never settled, so this case timed out with no result.
    {
      const before = consoleLines.length;
      const r = await evalCase(page, { ...common, options: opts, workerUrl: 'missing' });
      const newLines = consoleLines.slice(before);
      const sawWorkerWarning = newLines.some((l) => /worker failed to load|worker error/i.test(l));
      if (r.hung) {
        record('worker 404 → no hang', 'FAIL', `compress() never settled (> ${CASE_TIMEOUT_MS}ms)`);
      } else if (r.ok && r.path === 'webcodecs-worker') {
        record(
          'worker 404 → no hang',
          'FAIL',
          `reported ${r.path} even though the worker URL 404s (silent wrong result)`,
        );
      } else if (r.ok) {
        record(
          'worker 404 → no hang',
          'PASS',
          `fell back to ${r.path} in ${r.durationMs}ms${sawWorkerWarning ? ' (warning logged)' : ''}`,
        );
      } else {
        record('worker 404 → no hang', 'FAIL', `threw ${r.code} instead of falling back`);
      }
    }

    // 9. A second compress() after a dead worker must still work (no poisoned state)
    {
      const r = await evalCase(page, { ...common, options: opts });
      if (r.ok && r.compressedSize < r.originalSize) {
        record('recovery after 404', 'PASS', `${r.path}, ${(r.compressedSize / 1024).toFixed(0)}KB`);
      } else {
        record('recovery after 404', 'FAIL', JSON.stringify(r).slice(0, 160));
      }
    }
  } finally {
    await browser.close();
    server.close();
  }

  const failed = results.filter((r) => r.status === 'FAIL');
  const skipped = results.filter((r) => r.status === 'SKIP');
  process.stdout.write(
    `\n[smoke] ${results.length - failed.length - skipped.length} passed, ${skipped.length} skipped, ${failed.length} failed\n`,
  );
  if (failed.length > 0) {
    process.stdout.write('\nFailed cases:\n');
    for (const f of failed) process.stdout.write(`  ✗ ${f.name} — ${f.detail}\n`);
    process.exit(1);
  }
}

main().catch((err) => {
  process.stderr.write(`[smoke] fatal: ${err && err.stack ? err.stack : err}\n`);
  process.exit(1);
});
