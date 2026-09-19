/**
 * Reference HEIC decoder used by the test suites (NOT shipped).
 *
 * Mimics heic2any's contract — `default({ blob, toType }) => Promise<Blob>` — so
 * the library's `__IC_HEIC2ANY_URL` hatch can load it through a plain runtime
 * dynamic import (no eval). It cannot decode HEVC itself, so it returns the
 * **ground truth** for `sample.heic`: `sample.reference.png`, produced by macOS
 * ImageIO (see make-fixtures.mjs). That makes every downstream pixel assertion
 * meaningful — the pixels really are what the .heic decodes to.
 *
 * It also records what it received on `globalThis.__IC_REFERENCE_DECODER` so the
 * tests can prove the *real* .heic bytes (not a stand-in) reached the decoder:
 *   { calls, size, type, fnv1a }
 *
 * Works in Node (vitest) and in the browser (fetched over HTTP).
 */
const FN = { calls: 0, size: 0, type: '', fnv1a: 0 };

function fnv1a(bytes) {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * Node vs browser/worker detection. NOT `typeof window`: this module also runs
 * inside a Web Worker (v1.3.3 decodes HEIC there), where `window` is undefined
 * but canvas/fetch are available.
 */
const isNode =
  typeof process !== 'undefined' &&
  typeof process.versions?.node === 'string' &&
  typeof document === 'undefined';

async function loadReferenceBytes() {
  if (isNode) {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { dirname, join } = await import('node:path');
    const here = dirname(fileURLToPath(import.meta.url));
    return new Uint8Array(readFileSync(join(here, 'sample.reference.png')));
  }
  const res = await fetch(new URL('./sample.reference.png', import.meta.url).href);
  if (!res.ok) throw new Error(`reference PNG fetch failed: HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

export default async function referenceDecoder({ blob, toType = 'image/jpeg' } = {}) {
  const input = new Uint8Array(await blob.arrayBuffer());
  FN.calls += 1;
  FN.size = input.length;
  FN.type = blob.type || '';
  FN.fnv1a = fnv1a(input);
  globalThis.__IC_REFERENCE_DECODER = { ...FN };

  const reference = await loadReferenceBytes();

  // Re-encode the ground truth to the requested type so the caller gets the
  // format it asked for (the library expects a JPEG-ish blob back).
  if (isNode) {
    const { createCanvas, loadImage } = await import('@napi-rs/canvas');
    const img = await loadImage(Buffer.from(reference));
    const canvas = createCanvas(img.width, img.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const buf = canvas.toBuffer(toType === 'image/png' ? 'image/png' : 'image/jpeg', 0.95);
    return new Blob([new Uint8Array(buf)], { type: toType });
  }

  const bitmap = await createImageBitmap(new Blob([reference], { type: 'image/png' }));
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return canvas.convertToBlob({ type: toType, quality: 0.95 });
}
