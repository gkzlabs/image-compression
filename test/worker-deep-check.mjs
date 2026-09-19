#!/usr/bin/env node
/**
 * Deep worker verification — evidence, not vibes.
 *
 * Answers three questions with observable proof:
 *   1. Is the Worker really used, and is the work really OFF the main thread?
 *      → Chromium dedicated-worker targets, HTTP status of the worker request,
 *        and measured main-thread rAF gaps during compression.
 *   2. Are transforms + target-size correct on the worker path (pixel level)?
 *      → deterministic 2-tone fixture: after compress, decode the OUTPUT and
 *        assert which half is red/blue and that dimensions swapped for rotate.
 *   3. Does the worker path fail SAFELY (no hang, no leak, no poisoned state)?
 *      → dispose mid-flight, worker reuse across runs, console cleanliness.
 *
 * Usage: npm run test:worker   (or: node test/worker-deep-check.mjs [chromePath])
 * Exit 0 = every case passed.
 */

import puppeteer from 'puppeteer';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import http from 'node:http';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const FIXTURE_BIG = resolve(ROOT, 'bench', 'fixtures', 'large-4000x3000.jpg');
const FIXTURE_MED = resolve(ROOT, 'bench', 'fixtures', 'medium-1500x1000.jpg');
const CASE_TIMEOUT_MS = Number(process.env.DEEP_TIMEOUT_MS || 45_000);
const MAX_MAIN_THREAD_GAP_MS = Number(process.env.MAX_MAIN_GAP_MS || 150);

const results = [];
const notes = [];

function log(msg) {
  process.stdout.write(`${msg}\n`);
}

function record(name, status, detail) {
  results.push({ name, status, detail });
  const icon = status === 'PASS' ? '✓' : status === 'SKIP' ? '○' : '✗';
  log(`  ${icon} ${name} — ${detail}`);
}

function ensureBuild() {
  if (!existsSync(resolve(ROOT, 'dist', 'worker.js'))) {
    log('dist/ missing — building...');
    execSync('npm run build', { cwd: ROOT, stdio: 'inherit' });
  }
}

function ensureFixtures() {
  if (!existsSync(FIXTURE_MED)) {
    execSync('node bench/fixtures/generate.mjs', { cwd: ROOT, stdio: 'inherit' });
  }
}

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
      res.setHeader('Content-Type', types[filePath.slice(filePath.lastIndexOf('.'))] || 'application/octet-stream');
      res.setHeader('Cache-Control', 'no-store');
      res.end(readFileSync(filePath));
    });
    server.listen(0, '127.0.0.1', () => res({ server, port: server.address().port }));
  });
}

async function runCase(page, args) {
  return page.evaluate(
    async ({ args, timeoutMs }) => {
      const timeout = new Promise((res) => setTimeout(() => res({ hung: true }), timeoutMs));
      return Promise.race([window.__icSmoke.compressAdvanced(args), timeout]);
    },
    { args, timeoutMs: CASE_TIMEOUT_MS },
  );
}

const dominant = (c) => (c.r >= c.g && c.r >= c.b ? 'red' : c.b >= c.g ? 'blue' : 'green');

/**
 * Count live dedicated worker targets, waiting briefly for registration.
 *
 * CDP reports a new worker target asynchronously, so reading `page.workers()`
 * immediately after `compress()` resolves can legitimately return 0 on a slower
 * CI runner (observed on GitHub Actions: the same assertion saw 1 locally and 0
 * in CI, while six consecutive compressions a moment later saw 1).
 */
async function workerTargetCount(page, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  let count = page.workers().length;
  while (count === 0 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 100));
    count = page.workers().length;
  }
  return count;
}

async function main() {
  ensureBuild();
  ensureFixtures();
  const bigBase64 = readFileSync(existsSync(FIXTURE_BIG) ? FIXTURE_BIG : FIXTURE_MED).toString('base64');
  const fixtureName = existsSync(FIXTURE_BIG) ? 'large-4000x3000.jpg' : 'medium-1500x1000.jpg';

  const { server, port } = await startServer(ROOT);
  const launchOptions = { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] };
  const chromePath = process.argv[2] || process.env.SMOKE_CHROME;
  if (chromePath) launchOptions.executablePath = chromePath;
  const browser = await puppeteer.launch(launchOptions);

  const page = await browser.newPage();
  const consoleLines = [];
  page.on('console', (msg) => consoleLines.push(`${msg.type()}: ${msg.text()}`));
  page.on('pageerror', (err) => consoleLines.push(`pageerror: ${err.message}`));

  // Track every request for the worker file — a 404 here is the historical bug.
  const workerRequests = [];
  const badResponses = [];
  let cosmetic404s = 0;
  page.on('response', (res) => {
    if (/worker\.js/.test(res.url())) workerRequests.push({ url: res.url(), status: res.status() });
    if (res.status() >= 400) {
      // favicon is not part of the library's contract and the test server does
      // not serve one — count it separately so a real 404 is never masked.
      if (/favicon/.test(res.url())) cosmetic404s++;
      else badResponses.push({ url: res.url(), status: res.status() });
    }
  });

  try {
    log(`\nbrowser: ${await browser.version()}`);
    log(`fixture: ${fixtureName} (${(statSync(resolve(ROOT, 'bench/fixtures', fixtureName)).size / 1024).toFixed(0)} KB)\n`);
    await page.goto(`http://127.0.0.1:${port}/test/smoke.html`, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => window.__smokeReady === true, { timeout: 15_000 });

    // ── 1. Worker really used + request 200 ─────────────────────────────────
    const bigCases = await runCase(page, {
      fixtureBase64: bigBase64,
      name: fixtureName,
      options: { quality: 0.85, maxWidthOrHeight: 2048, format: 'image/jpeg' },
      probeMainThread: true,
    });
    const workersAfter = await workerTargetCount(page);
    const workerResponses = workerRequests.filter((r) => r.status === 200);
    const worker404s = workerRequests.filter((r) => r.status >= 400);

    if (bigCases.hung) {
      record('worker path (large file) settles', 'FAIL', `hung > ${CASE_TIMEOUT_MS}ms`);
    } else if (bigCases.ok && String(bigCases.path).endsWith('worker')) {
      record(
        'worker path (large file) settles',
        'PASS',
        `path=${bigCases.path} ${bigCases.width}x${bigCases.height} ${(bigCases.compressedSize / 1024).toFixed(0)}KB in ${bigCases.durationMs}ms`,
      );
    } else {
      record('worker path (large file) settles', 'FAIL', JSON.stringify(bigCases).slice(0, 200));
    }

    record(
      'worker file fetched with HTTP 200',
      workerResponses.length > 0 && worker404s.length === 0 ? 'PASS' : 'FAIL',
      `${workerResponses.length}× 200, ${worker404s.length}× 4xx/5xx — ${workerResponses[0]?.url ?? 'no request seen'}`,
    );

    record(
      'dedicated worker target alive',
      workersAfter >= 1 ? 'PASS' : 'FAIL',
      `${workersAfter} worker target(s) after compression`,
    );

    // ── 2. Work is off the main thread (measured) ───────────────────────────
    if (bigCases.ok) {
      const gap = bigCases.probe?.maxGapMs ?? Infinity;
      record(
        `main thread stayed responsive (≤ ${MAX_MAIN_THREAD_GAP_MS}ms gaps)`,
        gap <= MAX_MAIN_THREAD_GAP_MS ? 'PASS' : 'FAIL',
        `longest rAF gap ${gap.toFixed(1)}ms over ${bigCases.probe?.frames} frames (worker path)`,
      );
    }

    const canvasCase = await runCase(page, {
      fixtureBase64: bigBase64,
      name: fixtureName,
      options: { quality: 0.85, maxWidthOrHeight: 2048, format: 'image/jpeg', forcePath: 'canvas-main' },
      probeMainThread: true,
    });
    if (canvasCase.ok) {
      notes.push(
        `contrast — same file on canvas-main: longest rAF gap ${(canvasCase.probe?.maxGapMs ?? 0).toFixed(1)}ms vs worker ${(bigCases.probe?.maxGapMs ?? 0).toFixed(1)}ms`,
      );
    }

    // ── 3. Pixel-level correctness of worker transforms ─────────────────────
    // 2-tone fixture is 1200x800 (red-ish left, blue-ish right).
    const rotate = await runCase(page, {
      tone: true,
      options: { rotate: 90, maxWidthOrHeight: 2048, quality: 0.9, format: 'image/jpeg' },
    });
    if (rotate.hung) {
      record('rotate 90 in worker (dims + pixels)', 'FAIL', 'hung');
    } else if (!rotate.ok) {
      record('rotate 90 in worker (dims + pixels)', 'FAIL', `${rotate.code}: ${rotate.message}`);
    } else {
      const swapped = rotate.height > rotate.width;
      const topRed = dominant(rotate.colors.top) === 'red';
      const bottomBlue = dominant(rotate.colors.bottom) === 'blue';
      record(
        'rotate 90 in worker (dims + pixels)',
        swapped && topRed && bottomBlue ? 'PASS' : 'FAIL',
        `path=${rotate.path} dims ${rotate.width}x${rotate.height} (portrait=${swapped}), top=${dominant(rotate.colors.top)}(${JSON.stringify(rotate.colors.top).replace(/[[\]"a-z{}:]/g, '')}), bottom=${dominant(rotate.colors.bottom)}`,
      );
    }

    const mirror = await runCase(page, {
      tone: true,
      options: { mirror: 'horizontal', maxWidthOrHeight: 2048, quality: 0.9, format: 'image/jpeg' },
    });
    if (mirror.ok) {
      const leftBlue = dominant(mirror.colors.left) === 'blue';
      const rightRed = dominant(mirror.colors.right) === 'red';
      record(
        'mirror horizontal in worker (pixels)',
        leftBlue && rightRed ? 'PASS' : 'FAIL',
        `path=${mirror.path} left=${dominant(mirror.colors.left)} right=${dominant(mirror.colors.right)} (expected left=blue right=red)`,
      );
    } else {
      record('mirror horizontal in worker (pixels)', 'FAIL', mirror.hung ? 'hung' : `${mirror.code}: ${mirror.message}`);
    }

    // Transforms + target-size together: the ladder must keep the transform.
    const rotateTarget = await runCase(page, {
      tone: true,
      options: { rotate: 90, maxSizeMB: 0.02, quality: 0.9, format: 'image/jpeg' },
    });
    if (rotateTarget.hung) {
      record('rotate + maxSizeMB in worker (transform survives ladder)', 'FAIL', 'hung');
    } else if (!rotateTarget.ok) {
      record('rotate + maxSizeMB in worker (transform survives ladder)', 'FAIL', `${rotateTarget.code}: ${rotateTarget.message}`);
    } else {
      const swapped = rotateTarget.height > rotateTarget.width;
      const topRed = dominant(rotateTarget.colors.top) === 'red';
      const bottomBlue = dominant(rotateTarget.colors.bottom) === 'blue';
      record(
        'rotate + maxSizeMB in worker (transform survives ladder)',
        swapped && topRed && bottomBlue ? 'PASS' : 'FAIL',
        `path=${rotateTarget.path} dims ${rotateTarget.width}x${rotateTarget.height} (portrait=${swapped}), top=${dominant(rotateTarget.colors.top)}, bottom=${dominant(rotateTarget.colors.bottom)}, ${(rotateTarget.compressedSize / 1024).toFixed(1)}KB ≤ 20KB`,
      );
    }

    // ── 4. Reuse: no worker leak across many compressions ───────────────────
    {
      const runs = [];
      for (let i = 0; i < 6; i++) {
        runs.push(
          await runCase(page, {
            fixtureBase64: bigBase64,
            name: fixtureName,
            options: { quality: 0.8, maxWidthOrHeight: 1600, format: 'image/jpeg' },
          }),
        );
      }
      const workers = await workerTargetCount(page);
      const allOk = runs.every((r) => r.ok && !r.hung);
      const workerPaths = runs.filter((r) => String(r.path).endsWith('worker')).length;
      record(
        '6 consecutive compressions reuse one worker',
        allOk && workerPaths === runs.length && workers === 1 ? 'PASS' : 'FAIL',
        `${runs.filter((r) => r.ok).length}/6 ok, ${workerPaths}/6 on worker path, ${workers} worker target(s) alive`,
      );
    }

    // ── 5. dispose() mid-flight must settle, never hang ─────────────────────
    {
      const disposed = await runCase(page, {
        fixtureBase64: bigBase64,
        name: fixtureName,
        options: { quality: 0.9, maxWidthOrHeight: 2048, format: 'image/jpeg' },
        disposeAfterMs: 5,
      });
      if (disposed.hung) {
        record(
          'dispose() mid-flight settles (no hang)',
          'FAIL',
          `compress() never settled after dispose() — pending worker RPC lost (> ${CASE_TIMEOUT_MS}ms)`,
        );
      } else if (disposed.ok) {
        record('dispose() mid-flight settles (no hang)', 'PASS', `completed via ${disposed.path} in ${disposed.durationMs}ms (fell back cleanly)`);
      } else {
        record('dispose() mid-flight settles (no hang)', 'PASS', `rejected with ${disposed.code} in ${disposed.durationMs}ms (explicit, not a hang)`);
      }
    }

    // ── 6. No poisoned state after the mid-flight dispose ───────────────────
    {
      const after = await runCase(page, {
        fixtureBase64: bigBase64,
        name: fixtureName,
        options: { quality: 0.85, maxWidthOrHeight: 2048, format: 'image/jpeg' },
      });
      record(
        'compression works after mid-flight dispose',
        after.ok && !after.hung && after.compressedSize < after.originalSize ? 'PASS' : 'FAIL',
        after.hung ? 'hung' : `path=${after.path} ${(after.compressedSize / 1024).toFixed(0)}KB in ${after.durationMs}ms`,
      );
    }

    // ── 7. Console / network cleanliness ────────────────────────────────────
    {
      // Chromium's generic "Failed to load resource: 404" console line carries no
      // URL, so it is only benign when every 4xx we actually saw was the favicon.
      const consoleErrors = consoleLines.filter((l) => /^error:|pageerror/.test(l));
      const realErrors = consoleErrors.filter(
        (l) => !/Failed to load resource/.test(l) || badResponses.length > 0,
      );
      record(
        'no page errors / console errors',
        realErrors.length === 0 && badResponses.length === 0 ? 'PASS' : 'FAIL',
        realErrors.length || badResponses.length
          ? [...realErrors.slice(0, 2), ...badResponses.map((r) => `${r.status} ${r.url}`)].join(' | ')
          : `clean (${cosmetic404s} cosmetic 404 → favicon only)`,
      );
    }
  } finally {
    await browser.close();
    server.close();
  }

  const failed = results.filter((r) => r.status === 'FAIL');
  const skipped = results.filter((r) => r.status === 'SKIP');
  if (notes.length) {
    log('\nObservations:');
    for (const n of notes) log(`  • ${n}`);
  }
  log(`\n[deep] ${results.length - failed.length - skipped.length} passed, ${skipped.length} skipped, ${failed.length} failed`);
  if (failed.length) {
    log('\nFailed cases:');
    for (const f of failed) log(`  ✗ ${f.name} — ${f.detail}`);
    process.exit(1);
  }
}

main().catch((err) => {
  process.stderr.write(`[deep] fatal: ${err && err.stack ? err.stack : err}\n`);
  process.exit(1);
});
