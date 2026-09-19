#!/usr/bin/env node
/**
 * Cross-engine browser matrix (ข้อ 4) — Firefox + WebKit via Playwright.
 *
 * Why this exists: the CI browser suites ran Chromium only, while the risky APIs
 * differ sharply per engine. Measured on this machine with the very first run:
 *
 *   engine    OffscreenCanvas  Worker  WebCodecs (ImageDecoder)  WebP encode
 *   Chromium       yes           yes            yes                  yes
 *   Firefox        yes           yes            NO                   yes
 *   WebKit         yes           yes            NO                   NO
 *
 * So Firefox/WebKit always take the non-WebCodecs cascade and WebKit cannot
 * produce WebP at all (canvas silently falls back to PNG) — both are exactly the
 * kind of environment a Chromium-only suite would never catch.
 *
 * It drives the SAME page and harness as the Puppeteer suites
 * (test/smoke.html + test/smoke-harness.mjs) against the BUILT bundle, so this is
 * the shipped artifact, not source.
 *
 * Usage: node test/browser-matrix.mjs [firefox|webkit|all]     (default: all)
 * Exit 0 = every case passed (SKIP counts as pass-with-note).
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import http from 'node:http';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE = resolve(ROOT, 'bench', 'fixtures', 'medium-1500x1000.jpg');
const CASE_TIMEOUT_MS = Number(process.env.MATRIX_TIMEOUT_MS || 90_000);
const requested = (process.argv[2] || 'all').toLowerCase();
const ENGINES = requested === 'all' ? ['firefox', 'webkit'] : [requested];

function log(m) {
  process.stdout.write(`${m}\n`);
}

function ensureBuild() {
  if (!existsSync(resolve(ROOT, 'dist', 'index.js'))) {
    log('dist/ missing — building…');
    execSync('npm run build', { cwd: ROOT, stdio: 'inherit' });
  }
}

function ensureFixture() {
  if (!existsSync(FIXTURE)) execSync('node bench/fixtures/generate.mjs', { cwd: ROOT, stdio: 'inherit' });
  return readFileSync(FIXTURE).toString('base64');
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
function record(engine, name, status, detail) {
  results.push({ engine, name, status });
  const icon = status === 'PASS' ? '✓' : status === 'SKIP' ? '○' : '✗';
  log(`  ${icon} [${engine}] ${name} — ${detail}`);
}

async function runEngine(playwright, engine, origin, fixtureBase64) {
  let browser;
  try {
    browser = await playwright[engine].launch();
  } catch (err) {
    record(engine, 'launch', 'FAIL', `cannot launch: ${String(err.message).split('\n')[0].slice(0, 120)}`);
    return;
  }

  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e.message)));
  const probe = (method, args) =>
    page.evaluate(
      async ({ method, args, timeoutMs }) => {
        const timeout = new Promise((res) => setTimeout(() => res({ hung: true }), timeoutMs));
        return Promise.race([window.__icSmoke[method](args), timeout]);
      },
      { method, args, timeoutMs: CASE_TIMEOUT_MS },
    );

  try {
    await page.goto(`${origin}/test/smoke.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__smokeReady === true, { timeout: 30_000 });

    const caps = await probe('capabilities', {});
    record(
      engine,
      'library loads + capabilities detected',
      caps && caps.tier ? 'PASS' : 'FAIL',
      `tier=${caps?.tier} webcodecs=${caps?.hasWebCodecs} offscreen=${caps?.hasOffscreenCanvas} worker=${caps?.hasWorker} webcodecsInWorker=${caps?.hasWebCodecsInWorker}`,
    );

    // 1. Default cascade on a real photo.
    const cascade = await probe('compress', { fixtureBase64, name: 'matrix.jpg', options: { maxWidthOrHeight: 1200, quality: 0.8 } });
    if (cascade.hung) {
      record(engine, 'default cascade compresses a real photo', 'FAIL', `hung > ${CASE_TIMEOUT_MS}ms`);
    } else {
      const won = cascade.ok && cascade.compressedSize < cascade.originalSize && Math.max(cascade.width, cascade.height) <= 1200;
      record(
        engine,
        'default cascade compresses a real photo',
        won ? 'PASS' : 'FAIL',
        cascade.ok
          ? `path=${cascade.path} ${cascade.width}x${cascade.height} ${(cascade.originalSize / 1024).toFixed(0)}KB → ${(cascade.compressedSize / 1024).toFixed(0)}KB`
          : `${cascade.code}: ${cascade.message}`,
      );
    }

    // 2. Transforms (rotate) produce correct pixels.
    const rotated = await probe('compressAdvanced', {
      fixtureBase64,
      tone: true,
      name: 'tone.jpg',
      options: { rotate: 90, quality: 0.9, maxWidthOrHeight: 400 },
    });
    if (rotated.hung) {
      record(engine, 'rotate 90 keeps pixel orientation', 'FAIL', `hung > ${CASE_TIMEOUT_MS}ms`);
    } else if (rotated.ok && rotated.colors) {
      const { top, bottom } = rotated.colors;
      // The 2-tone fixture is red|blue side by side; after 90° CW the red half is on top.
      const ok = top.r > top.b && bottom.b > bottom.r;
      record(engine, 'rotate 90 keeps pixel orientation', ok ? 'PASS' : 'FAIL', `top=(${top.r.toFixed(0)},${top.b.toFixed(0)}) bottom=(${bottom.r.toFixed(0)},${bottom.b.toFixed(0)}) via ${rotated.path}`);
    } else {
      record(engine, 'rotate 90 keeps pixel orientation', 'FAIL', JSON.stringify(rotated).slice(0, 160));
    }

    // 3. The Worker path itself (no WebCodecs on FF/WebKit → offscreen-worker).
    const forced = await probe('compress', { fixtureBase64, name: 'matrix.jpg', options: { forcePath: 'offscreen-worker', maxWidthOrHeight: 1200, quality: 0.8 } });
    if (forced.hung) {
      record(engine, 'offscreen-worker path works', 'FAIL', `hung > ${CASE_TIMEOUT_MS}ms`);
    } else if (forced.ok && forced.path === 'offscreen-worker') {
      record(engine, 'offscreen-worker path works', 'PASS', `${forced.width}x${forced.height} ${(forced.compressedSize / 1024).toFixed(0)}KB`);
    } else {
      record(engine, 'offscreen-worker path works', 'SKIP', `${forced.code ?? forced.path}: ${String(forced.message ?? '').slice(0, 80)}`);
    }

    // 4. HEIC via the runtime-import hatch (no eval) — main-thread path.
    const heic = await probe('heicFixtureProbe', {
      decoderUrl: '/test/fixtures/reference-decoder.mjs',
      heicUrl: '/test/fixtures/sample.heic',
      options: { forcePath: 'canvas-main', maxWidthOrHeight: 320 },
    });
    if (heic.hung) {
      record(engine, 'real .heic decodes through the hatch', 'FAIL', `hung > ${CASE_TIMEOUT_MS}ms`);
    } else if (heic.ok && heic.width === 320 && heic.height === 240) {
      record(engine, 'real .heic decodes through the hatch', 'PASS', `${heic.width}x${heic.height} via ${heic.path}`);
    } else {
      record(engine, 'real .heic decodes through the hatch', 'SKIP', `${heic.code ?? ''}: ${String(heic.message ?? '').slice(0, 90)}`);
    }

    // 5. C4 <picture> set: sources must only be formats this engine encodes.
    const picture = await probe('pictureSetProbe', { fixtureBase64, name: 'matrix.jpg', options: { maxWidthOrHeight: 640 } });
    if (picture.hung) {
      record(engine, '<picture> set builds and revokes', 'FAIL', `hung > ${CASE_TIMEOUT_MS}ms`);
    } else if (picture.ok && picture.fallback.type === 'image/jpeg' && picture.fetchAfterRevoke === 'failed') {
      record(
        engine,
        '<picture> set builds and revokes',
        'PASS',
        `fallback jpeg ${(picture.fallback.bytes / 1024).toFixed(0)}KB · sources [${picture.sources.map((s) => s.type.replace('image/', '')).join(', ') || 'none'}] · revoked URL unreachable (${picture.fetchAfterRevoke})`,
      );
    } else if (picture.ok) {
      record(engine, '<picture> set builds and revokes', 'FAIL', `revoke did not release: ${picture.fetchAfterRevoke}; ${JSON.stringify(picture.sources)}`);
    } else {
      record(engine, '<picture> set builds and revokes', 'FAIL', String(picture.message).slice(0, 140));
    }

    record(
      engine,
      'no uncaught page errors',
      pageErrors.length === 0 ? 'PASS' : 'FAIL',
      pageErrors.length ? pageErrors.slice(0, 2).join(' | ').slice(0, 160) : 'console clean',
    );
  } catch (err) {
    record(engine, 'suite', 'FAIL', String(err.message).split('\n')[0].slice(0, 160));
  } finally {
    await browser.close();
  }
}

async function main() {
  ensureBuild();
  const fixtureBase64 = ensureFixture();
  const { server, port } = await startServer(ROOT);
  const origin = `http://127.0.0.1:${port}`;

  let playwright;
  try {
    playwright = (await import('playwright-core')).default ?? (await import('playwright-core'));
  } catch {
    log('[matrix] SKIP — playwright-core is not installed (npm i -D playwright-core && npx playwright install firefox webkit)');
    server.close();
    process.exit(0);
  }

  try {
    for (const engine of ENGINES) {
      log(`\n[matrix] ${engine}`);
      await runEngine(playwright, engine, origin, fixtureBase64);
    }
  } finally {
    server.close();
  }

  const failed = results.filter((r) => r.status === 'FAIL');
  const skipped = results.filter((r) => r.status === 'SKIP');
  log(`\n[matrix] ${results.length - failed.length - skipped.length} passed, ${skipped.length} skipped, ${failed.length} failed`);
  if (failed.length) process.exit(1);
}

main().catch((err) => {
  process.stderr.write(`[matrix] fatal: ${err?.stack ?? err}\n`);
  process.exit(1);
});
