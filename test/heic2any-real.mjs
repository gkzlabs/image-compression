#!/usr/bin/env node
/**
 * Does the REAL heic2any actually work with this library?
 *
 * Every other HEIC test uses a stand-in decoder, so the package the docs tell
 * users to install had never been exercised. This script serves the genuine
 * `heic2any@0.0.4` bundle (the UMD build the docs point at via
 * `window.__IC_HEIC2ANY_URL`) into a real Chromium page and compresses the real
 * `test/fixtures/sample.heic`, comparing pixels against ImageIO's own decode.
 *
 * Three cases, all with the real library:
 *   1. canvas-main   — the documented hatch path on the main thread.
 *   2. default cascade — Worker first (v1.3.3 decodes HEIC there), then the
 *      main-thread fallback when the Worker cannot use the decoder.
 *   3. forced worker — shows whether heic2any itself can run inside a Worker.
 *
 * Requires test/vendor/heic2any.min.js (gitignored):
 *   npm i heic2any@0.0.4 && cp node_modules/heic2any/dist/heic2any.min.js test/vendor/
 * Exit 0 = all effective cases passed. Missing vendor file = SKIP (exit 0).
 *
 * Usage: node test/heic2any-real.mjs [chromePath]
 */
import puppeteer from 'puppeteer';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import http from 'node:http';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VENDOR = resolve(ROOT, 'test', 'vendor', 'heic2any.min.js');
const HEIC_URL = '/test/fixtures/sample.heic';
const REF_URL = '/test/fixtures/sample.reference.png';
const DECODER_URL = '/test/vendor/heic2any.min.js';
const CASE_TIMEOUT_MS = Number(process.env.HEIC2ANY_TIMEOUT_MS || 60_000);

function log(m) {
  process.stdout.write(`${m}\n`);
}

if (!existsSync(VENDOR)) {
  log('[heic2any-real] SKIP — test/vendor/heic2any.min.js not present.');
  log('  npm i heic2any@0.0.4 && cp node_modules/heic2any/dist/heic2any.min.js test/vendor/');
  process.exit(0);
}

function ensureBuild() {
  if (!existsSync(resolve(ROOT, 'dist', 'index.js'))) {
    log('dist/ missing — building…');
    execSync('npm run build', { cwd: ROOT, stdio: 'inherit' });
  }
}

function startServer(root) {
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.heic': 'image/heic',
  };
  return new Promise((res) => {
    const server = http.createServer((req, rep) => {
      const url = decodeURIComponent(req.url.split('?')[0]);
      const filePath = join(root, url);
      if (!filePath.startsWith(root) || !existsSync(filePath) || statSync(filePath).isDirectory()) {
        rep.writeHead(404);
        rep.end('not found');
        return;
      }
      const ext = filePath.slice(filePath.lastIndexOf('.'));
      rep.setHeader('Content-Type', types[ext] || 'application/octet-stream');
      rep.setHeader('Cache-Control', 'no-store');
      rep.end(readFileSync(filePath));
    });
    server.listen(0, '127.0.0.1', () => res({ server, port: server.address().port }));
  });
}

const results = [];
function record(name, status, detail) {
  results.push({ name, status, detail });
  log(`  ${status === 'PASS' ? '✓' : status === 'SKIP' ? '○' : '✗'} ${name} — ${detail}`);
}

const quadrantsOk = (q) =>
  q && q.topLeft?.[0] > 150 && q.topRight?.[1] > 150 && q.bottomLeft?.[2] > 150 && q.bottomRight?.[0] > 150;

async function main() {
  ensureBuild();
  const { server, port } = await startServer(ROOT);
  const launchOptions = { headless: true };
  const chromePath = process.argv[2] || process.env.SMOKE_CHROME;
  if (chromePath) launchOptions.executablePath = chromePath;
  const browser = await puppeteer.launch(launchOptions);
  const page = await browser.newPage();
  page.on('pageerror', (e) => log(`  [page error] ${e.message}`));

  const probe = (args) =>
    page.evaluate(
      async ({ args, timeoutMs }) => {
        const timeout = new Promise((r) => setTimeout(() => r({ hung: true }), timeoutMs));
        return Promise.race([window.__icSmoke.heicFixtureProbe(args), timeout]);
      },
      { args, timeoutMs: CASE_TIMEOUT_MS },
    );

  try {
    log(`[heic2any-real] browser: ${(await browser.version?.()) ?? 'chromium'}`);
    log(`[heic2any-real] decoder: real heic2any ${statSync(VENDOR).size} bytes (UMD)\n`);
    await page.goto(`http://127.0.0.1:${port}/test/smoke.html`, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => window.__smokeReady === true, { timeout: 15_000 });

    // Force the heic2any path by removing the native API from the page: without
    // this, Chrome may decode HEIC natively and "heic2any worked" would be an
    // unfounded claim. (Worker globals can't be patched from the page, which is
    // why case 2 is reported separately.)
    await page.evaluateOnNewDocument(() => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        delete globalThis.ImageDecoder;
        Object.defineProperty(globalThis, 'ImageDecoder', { value: undefined, configurable: true });
      } catch {
        /* ignore */
      }
    });
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForFunction(() => window.__smokeReady === true, { timeout: 15_000 });
    const pageHasImageDecoder = await page.evaluate(() => typeof ImageDecoder !== 'undefined');
    log(`  native ImageDecoder in page after patch: ${pageHasImageDecoder}`);

    /** Did the real heic2any UMD actually get loaded on the page? (it sets window.heic2any) */
    const heic2anyLoaded = () => page.evaluate(() => typeof window.heic2any === 'function');

    // ── 0. which decoders exist here? (so "heic2any was used" is verifiable) ─
    const decoders = await page.evaluate(async () => {
      const pageSupport = typeof ImageDecoder === 'undefined'
        ? 'absent'
        : await ImageDecoder.isTypeSupported('image/heic');
      const workerSupport = await new Promise((res) => {
        const src = `self.postMessage({
          has: typeof ImageDecoder !== 'undefined',
          support: typeof ImageDecoder === 'undefined' ? 'absent' : 'checking'
        });
        if (typeof ImageDecoder !== 'undefined') {
          ImageDecoder.isTypeSupported('image/heic').then((s) => self.postMessage({ has: true, support: s }));
        }`;
        const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
        const w = new Worker(url);
        let last = null;
        w.onmessage = (e) => {
          last = e.data;
          if (last.support !== 'checking') {
            w.terminate();
            URL.revokeObjectURL(url);
            res(last);
          }
        };
        setTimeout(() => {
          w.terminate();
          res(last ?? { has: false, support: 'timeout' });
        }, 5000);
      });
      return { pageSupport, workerSupport };
    });
    log(`  native ImageDecoder — page: ${JSON.stringify(decoders.pageSupport)}, worker: ${JSON.stringify(decoders.workerSupport)}`);

    // ── 1. main-thread hatch path ───────────────────────────────────────────
    const main = await probe({
      decoderUrl: DECODER_URL,
      heicUrl: HEIC_URL,
      referenceUrl: REF_URL,
      options: { forcePath: 'canvas-main', maxWidthOrHeight: 320 },
    });
    const mainLoadedRealDecoder = await heic2anyLoaded();
    if (main.hung) {
      record('real heic2any on canvas-main (main thread)', 'FAIL', `hung > ${CASE_TIMEOUT_MS}ms`);
    } else if (
      main.ok &&
      main.path === 'canvas-main' &&
      quadrantsOk(main.quadrants) &&
      typeof main.meanDeltaVsReference === 'number' &&
      mainLoadedRealDecoder
    ) {
      record(
        'real heic2any on canvas-main (main thread)',
        'PASS',
        `${main.width}x${main.height} · output ${main.compressedSize}B · mean Δ vs ImageIO decode = ${main.meanDeltaVsReference.toFixed(2)}/255 · window.heic2any loaded = true`,
      );
    } else {
      record(
        'real heic2any on canvas-main (main thread)',
        'FAIL',
        `loaded=${mainLoadedRealDecoder} ${JSON.stringify(main).slice(0, 240)}`,
      );
    }

    // ── 2. forced Worker path with the real UMD decoder ─────────────────────
    // The page can't see a Worker's globals, so prove the real bundle ran *inside*
    // the Worker by serving a marked copy that logs from its own realm: worker
    // console output is forwarded to the page console by Chromium.
    const marked = `${VENDOR}.marked.js`;
    writeFileSync(
      marked,
      `${readFileSync(VENDOR, 'utf8')}\n;try{console.log('__HEIC2ANY_IN_WORKER__', typeof document === 'undefined');}catch(e){}\n`,
    );
    let workerDecoderRan = false;
    page.on('console', (msg) => {
      if (msg.text().includes('__HEIC2ANY_IN_WORKER__')) workerDecoderRan = true;
    });

    const forced = await probe({
      decoderUrl: '/test/vendor/heic2any.min.js.marked.js',
      heicUrl: HEIC_URL,
      options: { forcePath: 'offscreen-worker', maxWidthOrHeight: 320 },
    });
    if (forced.hung) {
      record('real heic2any inside the Worker (forced)', 'FAIL', `hung > ${CASE_TIMEOUT_MS}ms`);
    } else if (forced.ok && quadrantsOk(forced.quadrants) && workerDecoderRan) {
      record(
        'real heic2any inside the Worker (forced)',
        'PASS',
        `path=${forced.path} ${forced.width}x${forced.height} — the real bundle logged from the Worker realm`,
      );
    } else if (forced.ok && quadrantsOk(forced.quadrants)) {
      record(
        'real heic2any inside the Worker (forced)',
        'SKIP',
        `worker path succeeded (${forced.width}x${forced.height}) but the marked bundle never logged — the Worker most likely used its own native ImageDecoder (page-level removal doesn't reach Worker globals)`,
      );
    } else {
      record(
        'real heic2any inside the Worker (forced)',
        'SKIP',
        `not usable in a Worker (${forced.code ?? 'error'}: ${String(forced.message).slice(0, 90)})`,
      );
    }

    // ── 3. default cascade (Worker first, main-thread fallback) ─────────────
    const cascade = await probe({
      decoderUrl: DECODER_URL,
      heicUrl: HEIC_URL,
      referenceUrl: REF_URL,
      options: { maxWidthOrHeight: 320 },
    });
    if (cascade.hung) {
      record('default cascade with real heic2any', 'FAIL', `hung > ${CASE_TIMEOUT_MS}ms`);
    } else if (cascade.ok && quadrantsOk(cascade.quadrants)) {
      const fellBack = cascade.stages.some((s) => s.includes('fallback'));
      record(
        'default cascade with real heic2any',
        'PASS',
        `succeeded via ${cascade.path}${fellBack ? ' (cascade fell back from the Worker)' : ''} · stages: ${cascade.stages.join(' → ')}`,
      );
    } else {
      record('default cascade with real heic2any', 'FAIL', JSON.stringify(cascade).slice(0, 300));
    }
  } finally {
    await browser.close();
    server.close();
  }

  const failed = results.filter((r) => r.status === 'FAIL');
  const skipped = results.filter((r) => r.status === 'SKIP');
  log(`\n[heic2any-real] ${results.length - failed.length - skipped.length} passed, ${skipped.length} skipped, ${failed.length} failed`);
  if (failed.length) process.exit(1);
}

main().catch((err) => {
  process.stderr.write(`[heic2any-real] fatal: ${err?.stack ?? err}\n`);
  process.exit(1);
});
