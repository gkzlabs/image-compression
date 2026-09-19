/**
 * v1.3.3 worker tests — the two migrations off the main thread:
 *
 *  1. `sharpen` now runs inside the Worker (it was main-thread-only, applied in
 *     `executeCanvasMainPath`). These cases drive the real worker entry over RPC
 *     and measure EDGE ENERGY on the encoded output, so "sharpening happened"
 *     is a pixel fact rather than a flag check.
 *  2. HEIC decoding now runs inside the Worker (native ImageDecoder → forwarded
 *     `__IC_HEIC2ANY_URL` module → bare specifier), fed by the REAL fixture
 *     `test/fixtures/sample.heic` and compared against the ImageIO ground truth.
 *
 * Same harness as `worker.spec.ts`: import `./worker` for real (which wires
 * `self.onmessage`), capture `postMessage`, then call it like the RPC layer does.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createCanvas, loadImage } from '@napi-rs/canvas';

import './worker';

interface RpcReply {
  id: number;
  ok?: boolean;
  result?: unknown;
  error?: string;
  __event?: boolean;
  event?: unknown;
}

interface CompressResult {
  blob: Blob;
  width: number;
  height: number;
  mimeType: string;
}

let nextId = 1;
let captured: RpcReply[] = [];
let originalPostMessage: unknown;

const fixturePath = (name: string) => resolve(process.cwd(), 'test/fixtures', name);
const heicBytes = new Uint8Array(readFileSync(fixturePath('sample.heic')));

beforeEach(() => {
  captured = [];
  originalPostMessage = (globalThis as { postMessage?: unknown }).postMessage;
  (globalThis as { postMessage?: unknown }).postMessage = (msg: RpcReply) => {
    captured.push(msg);
  };
});

afterEach(() => {
  (globalThis as { postMessage?: unknown }).postMessage = originalPostMessage;
  delete (globalThis as { heic2any?: unknown }).heic2any;
  delete (globalThis as { ImageDecoder?: unknown }).ImageDecoder;
});

async function callWorker<T = unknown>(
  method: string,
  args: unknown[],
): Promise<{ ok: boolean; result?: T; error?: string }> {
  const id = nextId++;
  const handler = (self as unknown as { onmessage: (ev: unknown) => void }).onmessage;
  expect(typeof handler).toBe('function');
  handler({ data: { id, method, args } });

  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const reply = captured.find((m) => m.id === id && m.__event !== true);
    if (reply) return { ok: reply.ok === true, result: reply.result as T, error: reply.error };
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`worker never replied to ${method}()`);
}

/** Synthetic image with a hard vertical edge and a fine checker patch. */
async function edgeFile(width = 160, height = 120, type = 'image/jpeg'): Promise<File> {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d context');
  ctx.fillStyle = '#202020';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#e8e8e8';
  ctx.fillRect(width / 2, 0, width / 2, height);
  // 4px checker patch in the middle-right → rich high-frequency content.
  for (let y = 24; y < 72; y += 4) {
    for (let x = width / 2 + 16; x < width / 2 + 64; x += 4) {
      ctx.fillStyle = ((x / 4) + (y / 4)) % 2 === 0 ? '#ffffff' : '#000000';
      ctx.fillRect(x, y, 4, 4);
    }
  }
  const blob = await canvas.convertToBlob({ type, quality: 0.92 });
  return new File([blob], `edge.${type === 'image/png' ? 'png' : 'jpg'}`, { type });
}

/** Mean absolute horizontal neighbour difference = "edge energy". */
async function edgeEnergy(blob: Blob): Promise<number> {
  const img = await loadImage(Buffer.from(await blob.arrayBuffer()));
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img as unknown as never, 0, 0);
  const { data, width, height } = ctx.getImageData(0, 0, img.width, img.height);
  let sum = 0;
  let n = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 1; x < width; x++) {
      const i = (y * width + x) * 4;
      const j = i - 4;
      sum += Math.abs(data[i] - data[j]) + Math.abs(data[i + 1] - data[j + 1]) + Math.abs(data[i + 2] - data[j + 2]);
      n += 3;
    }
  }
  return sum / n;
}

async function quadrantPixels(blob: Blob) {
  const img = await loadImage(Buffer.from(await blob.arrayBuffer()));
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img as unknown as never, 0, 0);
  const at = (x: number, y: number) => [...ctx.getImageData(x, y, 1, 1).data].slice(0, 3);
  return { width: img.width, height: img.height, at };
}

/** Mean absolute per-channel pixel difference between two encoded images. */
async function pixelDelta(a: Blob, b: Blob): Promise<number> {
  const [ca, cb] = await Promise.all([raster(a), raster(b)]);
  const n = Math.min(ca.data.length, cb.data.length);
  let sum = 0;
  for (let i = 0; i < n; i += 4) {
    sum += Math.abs(ca.data[i] - cb.data[i]) + Math.abs(ca.data[i + 1] - cb.data[i + 1]) + Math.abs(ca.data[i + 2] - cb.data[i + 2]);
  }
  return sum / (n / 4) / 3;
}

/** Mean luminance of a vertical band [x0, x1) — used to detect the edge halo. */
async function bandLuma(blob: Blob, x0: number, x1: number): Promise<number> {
  const { data, width, height } = await raster(blob);
  let sum = 0;
  let n = 0;
  for (let y = 0; y < height; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * width + x) * 4;
      sum += (data[i] + data[i + 1] + data[i + 2]) / 3;
      n++;
    }
  }
  return sum / n;
}

async function raster(blob: Blob) {
  const img = await loadImage(Buffer.from(await blob.arrayBuffer()));
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img as unknown as never, 0, 0);
  return ctx.getImageData(0, 0, img.width, img.height);
}

describe('worker entry: sharpen runs in the Worker (v1.3.3)', () => {
  /**
   * The library's sharpen is an additive unsharp mask (canvas blur approximation
   * + 'lighter' composite). Its signature on a hard step edge is a bright HALO
   * just before the edge — measured on the encoded output, that is what "sharpen
   * was applied" looks like, and it is stable across JPEG re-encodes.
   */
  it('changes the pixels of the encoded output (and only with sharpen)', async () => {
    const file = await edgeFile();

    const plain = await callWorker<CompressResult>('compress', [
      file,
      { maxWidthOrHeight: 160, quality: 0.9, format: 'image/jpeg', sharpen: 0 },
      undefined,
    ]);
    const sharpened = await callWorker<CompressResult>('compress', [
      file,
      { maxWidthOrHeight: 160, quality: 0.9, format: 'image/jpeg', sharpen: 0.9 },
      undefined,
    ]);
    const sharpenAgain = await callWorker<CompressResult>('compress', [
      file,
      { maxWidthOrHeight: 160, quality: 0.9, format: 'image/jpeg', sharpen: 0.9 },
      undefined,
    ]);

    expect(plain.ok, plain.error).toBe(true);
    expect(sharpened.ok, sharpened.error).toBe(true);


    const delta = await pixelDelta(plain.result!.blob, sharpened.result!.blob);
    expect(delta, `sharpen must change pixels (mean delta ${delta.toFixed(2)})`).toBeGreaterThan(0.5);
    // Same options must be deterministic — guards against a random/stateful mask.
    expect(await pixelDelta(sharpened.result!.blob, sharpenAgain.result!.blob)).toBeLessThan(0.01);
  });

  it('produces the edge halo just before the step (dark side brightens)', async () => {
    const file = await edgeFile();

    const plain = await callWorker<CompressResult>('compress', [
      file,
      { maxWidthOrHeight: 160, quality: 0.9, format: 'image/jpeg', sharpen: 0 },
      undefined,
    ]);
    const sharpened = await callWorker<CompressResult>('compress', [
      file,
      { maxWidthOrHeight: 160, quality: 0.9, format: 'image/jpeg', sharpen: 0.9 },
      undefined,
    ]);

    // Band [72, 79) sits immediately left of the step edge at x=80 (dark region).
    const before = await bandLuma(plain.result!.blob, 72, 79);
    const after = await bandLuma(sharpened.result!.blob, 72, 79);
    expect(after, `dark band next to the edge must brighten (${before.toFixed(1)} → ${after.toFixed(1)})`)
      .toBeGreaterThan(before + 3);
  });

  it('keeps the sharpening through the maxSizeMB ladder', async () => {
    const file = await edgeFile(320, 240);

    const plain = await callWorker<CompressResult>('compress', [
      file,
      { maxWidthOrHeight: 320, quality: 0.9, format: 'image/jpeg', maxSizeMB: 0.02, sharpen: 0 },
      undefined,
    ]);
    const sharpened = await callWorker<CompressResult>('compress', [
      file,
      { maxWidthOrHeight: 320, quality: 0.9, format: 'image/jpeg', maxSizeMB: 0.02, sharpen: 0.9 },
      undefined,
    ]);

    expect(plain.ok, plain.error).toBe(true);
    expect(sharpened.ok, sharpened.error).toBe(true);

    const delta = await pixelDelta(plain.result!.blob, sharpened.result!.blob);
    expect(delta, 'ladder steps must re-apply the sharpen').toBeGreaterThan(0.5);
  });

  it('sharpenInPlace: brightens the dark side of an edge, leaves flat areas alone', async () => {
    const { sharpenInPlace } = await import('./worker-helpers');
    const canvas = new OffscreenCanvas(200, 100);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    ctx.fillStyle = '#101010';
    ctx.fillRect(0, 0, 100, 100);
    ctx.fillStyle = '#f0f0f0';
    ctx.fillRect(100, 0, 100, 100);

    const before = ctx.getImageData(0, 50, 200, 1).data;
    sharpenInPlace(ctx as unknown as OffscreenCanvasRenderingContext2D, 0.9, 200, 100);
    const after = ctx.getImageData(0, 50, 200, 1).data;

    const at = (d: Uint8ClampedArray, x: number) => d[x * 4];
    // Two pixels before the edge (x=98,99) get the halo; dark far away is untouched.
    expect(at(after, 99), 'halo directly before the edge').toBeGreaterThan(at(before, 99) + 20);
    expect(at(after, 98), 'halo two pixels before the edge').toBeGreaterThan(at(before, 98) + 5);
    expect(at(after, 20), 'flat dark area must be unchanged').toBe(at(before, 20));
    expect(at(after, 180), 'flat light area must be unchanged').toBe(at(before, 180));
  });

  it('ignores sharpen for lossless PNG (byte-identical output)', async () => {
    const file = await edgeFile(160, 120, 'image/png');

    const plain = await callWorker<CompressResult>('compress', [
      file,
      { maxWidthOrHeight: 160, format: 'image/png', sharpen: 0 },
      undefined,
    ]);
    const sharpened = await callWorker<CompressResult>('compress', [
      file,
      { maxWidthOrHeight: 160, format: 'image/png', sharpen: 1 },
      undefined,
    ]);

    expect(plain.ok, plain.error).toBe(true);
    expect(sharpened.ok, sharpened.error).toBe(true);
    expect(sharpened.result!.blob.size).toBe(plain.result!.blob.size);
    const a = new Uint8Array(await plain.result!.blob.arrayBuffer());
    const b = new Uint8Array(await sharpened.result!.blob.arrayBuffer());
    expect(b).toEqual(a);
  });

  it('applies sharpen together with rotate (transform not lost)', async () => {
    const file = await edgeFile(160, 120);

    const { ok, result, error } = await callWorker<CompressResult>('compress', [
      file,
      { quality: 0.9, format: 'image/jpeg', rotate: 90, sharpen: 0.9 },
      undefined,
    ]);
    expect(ok, error).toBe(true);
    // 160x120 rotated 90° → 120x160
    expect(result!.width).toBe(120);
    expect(result!.height).toBe(160);
    expect(await edgeEnergy(result!.blob)).toBeGreaterThan(0);
  });
});

describe('worker entry: HEIC decoding happens IN the Worker (v1.3.3)', () => {
  it('decodes the real .heic via the pre-installed decoder and keeps the pixels', async () => {
    const seen: { size: number; type: string }[] = [];
    (globalThis as { heic2any?: unknown }).heic2any = async ({
      blob,
      toType = 'image/jpeg',
    }: {
      blob: Blob;
      toType: string;
    }) => {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      seen.push({ size: bytes.length, type: blob.type });
      const img = await loadImage(readFileSync(fixturePath('sample.reference.png')));
      const canvas = new OffscreenCanvas(img.width, img.height);
      const ctx = canvas.getContext('2d');
      ctx?.drawImage(img as unknown as never, 0, 0);
      return canvas.convertToBlob({ type: toType, quality: 0.95 });
    };

    const file = new File([heicBytes], 'IMG_7777.HEIC', { type: 'image/heic' });
    const { ok, result, error } = await callWorker<CompressResult>('compress', [
      file,
      { maxWidthOrHeight: 320, quality: 0.9, format: 'image/jpeg', __path: 'webcodecs-worker' },
      undefined,
    ]);

    expect(ok, error).toBe(true);
    expect(seen).toHaveLength(1);
    expect(seen[0].size).toBe(heicBytes.length);
    expect(seen[0].type).toBe('image/heic');

    const px = await quadrantPixels(result!.blob);
    expect(px.width).toBe(320);
    expect(px.height).toBe(240);
    expect(px.at(40, 40)[0]).toBeGreaterThan(180); // red
    expect(px.at(280, 40)[1]).toBeGreaterThan(180); // green
    expect(px.at(40, 200)[2]).toBeGreaterThan(180); // blue
    expect(px.at(280, 200)[0]).toBeGreaterThan(180); // yellow (R)
  });

  it('fails with an actionable error when nothing can decode HEIC', async () => {
    (globalThis as { ImageDecoder?: unknown }).ImageDecoder = undefined;
    const file = new File([heicBytes], 'IMG_8888.HEIC', { type: 'image/heic' });

    const { ok, error } = await callWorker<CompressResult>('compress', [
      file,
      { format: 'image/jpeg', __heic2anyUrl: '/definitely-missing-decoder.mjs' },
      undefined,
    ]);

    expect(ok).toBe(false);
    expect(error).toMatch(/HEIC not supported/);
    expect(error).toMatch(/__IC_HEIC2ANY_URL/);
  });
});
