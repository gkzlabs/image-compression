#!/usr/bin/env node
/**
 * HEIC hatch verification in plain Node (the "Node consumer" path).
 *
 * The vitest module runner intercepts dynamic `import()` calls, so the hatch's
 * module-loading mechanics can only be proven outside it. This script imports
 * the **built** bundle (`dist/index.js`) in a normal Node process, points
 * `__IC_HEIC2ANY_URL` at the reference decoder module (a real file URL), and
 * asserts:
 *   1. the decoder module is really imported at runtime (no eval anywhere),
 *   2. it receives the real `test/fixtures/sample.heic` bytes, byte for byte,
 *   3. the decoded pixels match the ImageIO ground truth,
 *   4. a full compress() of the .heic keeps the image content.
 *
 * Usage: npm run build && node test/heic-hatch-node.mjs
 */
import { existsSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createCanvas, loadImage } from '@napi-rs/canvas';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixtures = resolve(ROOT, 'test', 'fixtures');
const heicBytes = new Uint8Array(readFileSync(resolve(fixtures, 'sample.heic')));

if (!existsSync(resolve(ROOT, 'dist', 'index.js'))) {
  console.log('dist/ missing — building…');
  execSync('npm run build', { cwd: ROOT, stdio: 'inherit' });
}

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? '✓' : '✗'} ${name} — ${detail}`);
};

// The library reads the hatch URL from globalThis at call time.
globalThis.__IC_HEIC2ANY_URL = pathToFileURL(resolve(fixtures, 'reference-decoder.mjs')).href;

const { tryDecodeHEICLazy } = await import(pathToFileURL(resolve(ROOT, 'dist', 'index.js')).href);
const { isHEICFile } = await import(pathToFileURL(resolve(ROOT, 'dist', 'heic.js')).href);

function fnv1a(bytes) {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

const file = new File([heicBytes], 'sample.heic', { type: 'image/heic' });
check('detects the real .heic', isHEICFile(file) === true, 'isHEICFile(sample.heic) === true');

const decoded = await tryDecodeHEICLazy(file);
check('hatch loaded a module at runtime and decoded', decoded instanceof Blob, decoded ? `${decoded.size} bytes back` : 'returned null');

const seen = globalThis.__IC_REFERENCE_DECODER;
check(
  'decoder received the exact fixture bytes',
  seen && seen.size === heicBytes.length && seen.fnv1a === fnv1a(heicBytes),
  seen ? `size=${seen.size} fnv1a=${seen.fnv1a} expected=${fnv1a(heicBytes)}` : 'decoder never ran',
);

// Pixel check against the ImageIO ground truth.
const img = await loadImage(Buffer.from(await decoded.arrayBuffer()));
const canvas = createCanvas(img.width, img.height);
const ctx = canvas.getContext('2d');
ctx.drawImage(img, 0, 0);
const at = (x, y) => [...ctx.getImageData(x, y, 1, 1).data].slice(0, 3);
const [tr, tg] = at(40, 40);
const [gr, gg] = at(280, 40);
const [,, bb] = at(40, 200);
const [yr, yg] = at(280, 200);
const quadrantsOk = tr > 180 && tg < 80 && gg > 180 && gr < 80 && bb > 180 && yr > 180 && yg > 180;
check('decoded pixels match the ground truth', quadrantsOk, `dims ${img.width}x${img.height}, TL=(${tr},${tg}) TR=(${gr},${gg}) BL blue=${bb} BR=(${yr},${yg})`);

// Full cascade on the real file.
const { ImageCompression } = await import(pathToFileURL(resolve(ROOT, 'dist', 'index.js')).href);
const ic = new ImageCompression();
const out = await ic.compress(file, { maxWidthOrHeight: 320, quality: 0.9 });
check('compress() of the real .heic succeeds', out.blob.size > 0, `${out.blob.size} bytes, ${out.width}x${out.height}`);

const failed = results.filter((r) => !r.ok);
console.log(`\n[heic-node] ${results.length - failed.length} passed, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
