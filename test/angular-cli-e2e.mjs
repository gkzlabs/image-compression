#!/usr/bin/env node
/**
 * Angular CLI (hostile bundler) end-to-end check.
 *
 * Serves the PRODUCTION build produced by `ng build` and drives it in real
 * Chromium: uploads the bench fixture through the example's file input and
 * asserts the library used a Worker path. The failure this guards against is
 * specific and historical: Angular CLI's esbuild builder leaving
 * `new URL('./worker.js', import.meta.url)` unresolved inside node_modules, so
 * the worker 404s and every large file silently degrades to `canvas-main`
 * (or, before the rpc fail-fast fix, hung forever).
 *
 * Usage (from the repo root, after `npm run build` in examples/angular-cli/):
 *   node test/angular-cli-e2e.mjs [bundleDir]
 *
 * Default bundleDir: examples/angular-cli/dist/angular-cli/browser
 */

import puppeteer from 'puppeteer';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const BUNDLE_DIR = resolve(
  ROOT,
  process.argv[2] || 'examples/angular-cli/dist/angular-cli/browser',
);
const FIXTURE = resolve(ROOT, 'bench', 'fixtures', 'medium-1500x1000.jpg');
const TIMEOUT_MS = Number(process.env.E2E_TIMEOUT_MS || 60_000);

function log(msg) {
  process.stdout.write(`[ng-e2e] ${msg}\n`);
}

function fail(msg) {
  process.stderr.write(`[ng-e2e] ✗ ${msg}\n`);
  process.exit(1);
}

/** Worker chunks Angular's builder may have emitted (hashed names included). */
function findWorkerChunks(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) found.push(...findWorkerChunks(join(dir, entry.name)));
    else if (/^worker[.-].*\.js$|^worker\.js$/.test(entry.name)) found.push(entry.name);
  }
  return found;
}

function startServer(root) {
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json',
    '.jpg': 'image/jpeg',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
  };
  return new Promise((res) => {
    const server = http.createServer((req, res) => {
      const url = decodeURIComponent(req.url.split('?')[0]);
      let filePath = join(root, url === '/' ? '/index.html' : url);
      // SPA fallback for deep links, mirrors a real static host.
      if (!existsSync(filePath) && !url.includes('.')) filePath = join(root, 'index.html');
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

async function main() {
  if (!existsSync(BUNDLE_DIR)) fail(`bundle dir not found: ${BUNDLE_DIR} (run \`npm run build\` in examples/angular-cli)`);
  if (!existsSync(join(BUNDLE_DIR, 'index.html'))) fail(`index.html missing in ${BUNDLE_DIR}`);
  if (!existsSync(FIXTURE)) fail(`fixture missing: ${FIXTURE}`);

  const chunks = findWorkerChunks(BUNDLE_DIR);
  log(`bundle: ${BUNDLE_DIR}`);
  log(`worker chunks emitted: ${chunks.length ? chunks.join(', ') : '(none)'}`);

  const { server, port } = await startServer(BUNDLE_DIR);
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();
  const consoleLines = [];
  page.on('console', (msg) => consoleLines.push(`${msg.type()}: ${msg.text()}`));
  page.on('pageerror', (err) => consoleLines.push(`pageerror: ${err.message}`));

  let ok = false;
  try {
    log(`browser: ${await browser.version()}`);
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle0' });
    const input = await page.waitForSelector('[data-testid="file-input"]', { timeout: 15_000 });
    await input.uploadFile(FIXTURE);
    await page.waitForFunction(
      () => window.__lastResult !== undefined || window.__lastError !== undefined,
      { timeout: TIMEOUT_MS },
    );

    const result = await page.evaluate(() => ({
      result: window.__lastResult ?? null,
      error: window.__lastError ?? null,
    }));

    if (result.error) fail(`compression threw: ${result.error}`);
    const r = result.result;
    log(`result: ${JSON.stringify(r)}`);

    if (!r) fail('no result reported');
    if (!String(r.path).endsWith('worker')) {
      fail(
        `expected a Worker path, got "${r.path}" — Angular CLI likely failed to resolve/emit the worker (chunks: ${chunks.join(', ') || 'none'}). Plain "canvas-main" means large files silently lose the off-main-thread path.`,
      );
    }
    if (!(r.compressedSize < r.originalSize)) {
      fail(`no size win: ${r.compressedSize} >= ${r.originalSize}`);
    }
    if (String(r.name).indexOf('.jpg') === -1) {
      fail(`unexpected output filename: ${r.name}`);
    }
    if (consoleLines.some((l) => /worker failed to load|404/i.test(l))) {
      fail(`worker load failure logged:\n${consoleLines.filter((l) => /worker failed to load|404/i.test(l)).join('\n')}`);
    }
    ok = true;
    log(`✓ Angular CLI production build used ${r.path} (${Math.round((1 - r.compressedSize / r.originalSize) * 100)}% smaller)`);
  } finally {
    await browser.close();
    server.close();
  }

  if (!ok) process.exit(1);
  log('✓ e2e passed');
}

main().catch((err) => {
  process.stderr.write(`[ng-e2e] fatal: ${err && err.stack ? err.stack : err}\n`);
  process.exit(1);
});
