/**
 * Worker-ENTRY tests for `src/worker.ts` (the file that used to sit at 0% in the
 * coverage report because only a real Worker could reach it).
 *
 * Approach: hybrid of the two standard techniques.
 *
 *  1. Logic extraction (already in place) — the drawing math lives in
 *     `drawTransformed()`, the size ladder in `shrinkToTargetSize()`, the
 *     resize/EXIF helpers in `worker-helpers.ts`. Those are pure and testable.
 *  2. In-process transport simulation (this file) — `worker.ts` ends with
 *     `expose(api)`, which just assigns `self.onmessage` and replies through the
 *     global `postMessage`. Here we import the module for real, capture those
 *     messages, and drive it exactly like the main thread does over RPC. The
 *     canvas/bitmap APIs the worker needs are the same @napi-rs/canvas-backed
 *     polyfills the rest of the unit suite uses, so the assertions run against
 *     REAL pixels — no jsdom-worker / fake-canvas layer required.
 *
 * What this covers that no other unit spec can: the worker's option plumbing
 * (`__path` labelling, transforms, `maxSizeMB`), its HEIC rejection path, and
 * its capability/probe methods — i.e. the whole file, not just the helpers.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createCanvas, loadImage } from '@napi-rs/canvas';

// Importing the module runs `expose(api)` against the globals (happy-dom `self`),
// wiring `self.onmessage` exactly like the real worker bundle does.
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

beforeEach(() => {
  captured = [];
  originalPostMessage = (globalThis as { postMessage?: unknown }).postMessage;
  // The worker replies through the global postMessage; capture instead of
  // dispatching a real MessageEvent (the same trick rpc.spec.ts uses).
  (globalThis as { postMessage?: unknown }).postMessage = (msg: RpcReply) => {
    captured.push(msg);
  };
});

afterEach(() => {
  (globalThis as { postMessage?: unknown }).postMessage = originalPostMessage;
});

/** Invoke a worker method the way the RPC layer does and await its reply. */
async function callWorker<T = unknown>(method: string, args: unknown[]): Promise<{
  ok: boolean;
  result?: T;
  error?: string;
}> {
  const id = nextId++;
  const handler = (self as unknown as { onmessage: (ev: unknown) => void }).onmessage;
  expect(typeof handler).toBe('function'); // expose() ran at import time
  handler({ data: { id, method, args } });

  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const reply = captured.find((m) => m.id === id && m.__event !== true);
    if (reply) return { ok: reply.ok === true, result: reply.result as T, error: reply.error };
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`worker never replied to ${method}()`);
}

/** Progress events the worker emitted for a given callback id. */
function eventsFor(callbackId: number) {
  return captured
    .filter((m) => m.__event === true && m.id === callbackId)
    .map((m) => m.event as { stage: string; percent: number; path?: string });
}

/** 2-tone JPEG (red-ish left half, blue-ish right half) as a File. */
async function toneFile(width = 120, height = 80): Promise<File> {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d context');
  ctx.fillStyle = '#ff0000';
  ctx.fillRect(0, 0, width / 2, height);
  ctx.fillStyle = '#0000ff';
  ctx.fillRect(width / 2, 0, width / 2, height);
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.95 });
  return new File([blob], 'tone.jpg', { type: 'image/jpeg' });
}

type Region = 'top' | 'bottom' | 'left' | 'right';

/** Decode an encoded blob and average a region (real pixels, no metadata). */
async function regionColor(blob: Blob, region: Region) {
  const img = await loadImage(Buffer.from(await blob.arrayBuffer()));
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img as unknown as never, 0, 0);
  const w = img.width;
  const h = img.height;
  const box: [number, number, number, number] =
    region === 'top'
      ? [0, 0, w, Math.max(1, Math.floor(h / 2))]
      : region === 'bottom'
        ? [0, Math.floor(h / 2), w, h - Math.floor(h / 2)]
        : region === 'left'
          ? [0, 0, Math.max(1, Math.floor(w / 2)), h]
          : [Math.floor(w / 2), 0, w - Math.floor(w / 2), h];
  const data = ctx.getImageData(...box).data;
  let r = 0;
  let g = 0;
  let b = 0;
  for (let i = 0; i < data.length; i += 4) {
    r += data[i];
    g += data[i + 1];
    b += data[i + 2];
  }
  const n = data.length / 4;
  return { r: r / n, g: g / n, b: b / n };
}

const dominant = (c: { r: number; g: number; b: number }) =>
  c.r >= c.g && c.r >= c.b ? 'red' : c.b >= c.g ? 'blue' : 'green';

describe('worker entry: compress()', () => {
  it('compresses, resizes to maxWidthOrHeight and reports dimensions', async () => {
    const file = await toneFile(400, 200);
    const { ok, result, error } = await callWorker<CompressResult>('compress', [
      file,
      { maxWidthOrHeight: 100, quality: 0.8, format: 'image/jpeg', __path: 'webcodecs-worker' },
      undefined,
    ]);

    expect(ok, `worker error: ${error}`).toBe(true);
    const r = result!;
    expect(r.mimeType).toBe('image/jpeg');
    expect(r.blob).toBeInstanceOf(Blob);
    expect(Math.max(r.width, r.height)).toBe(100);
    expect(r.width / r.height).toBeCloseTo(2, 1); // aspect preserved
  });

  it('emits progress events labelled with the real path (__path plumbing)', async () => {
    const file = await toneFile();
    const cbId = 4242;
    await callWorker('compress', [
      file,
      { maxWidthOrHeight: 100, __path: 'offscreen-worker' },
      { __callbackId: cbId },
    ]);

    const events = eventsFor(cbId);
    expect(events.length).toBeGreaterThan(0);
    expect(events.map((e) => e.stage)).toContain('decoding');
    expect(events.map((e) => e.stage)).toContain('encoding');
    // Regression guard: in-worker events used to be hardcoded to webcodecs-worker.
    expect(events.every((e) => e.path === 'offscreen-worker')).toBe(true);
  });

  it('defaults the progress path to webcodecs-worker when __path is absent', async () => {
    const file = await toneFile();
    const cbId = 77;
    await callWorker('compress', [file, { maxWidthOrHeight: 100 }, { __callbackId: cbId }]);
    expect(eventsFor(cbId).every((e) => e.path === 'webcodecs-worker')).toBe(true);
  });

  it('applies manual rotate in the worker (dimensions + real pixels)', async () => {
    const file = await toneFile(120, 80);
    const { ok, result } = await callWorker<CompressResult>('compress', [
      file,
      { rotate: 90, maxWidthOrHeight: 2048, quality: 0.9, format: 'image/jpeg' },
      undefined,
    ]);

    expect(ok).toBe(true);
    const r = result!;
    expect(r.height).toBeGreaterThan(r.width); // swapped => portrait
    expect(dominant(await regionColor(r.blob, 'top'))).toBe('red');
    expect(dominant(await regionColor(r.blob, 'bottom'))).toBe('blue');
  });

  it('applies mirror in the worker', async () => {
    const file = await toneFile(120, 80);
    const { ok, result } = await callWorker<CompressResult>('compress', [
      file,
      { mirror: 'horizontal', maxWidthOrHeight: 2048, quality: 0.9, format: 'image/jpeg' },
      undefined,
    ]);
    expect(ok).toBe(true);
    const r = result!;
    expect(dominant(await regionColor(r.blob, 'left'))).toBe('blue');
    expect(dominant(await regionColor(r.blob, 'right'))).toBe('red');
  });

  it('honours exact width/height with keepAspectRatio', async () => {
    const file = await toneFile(400, 200);
    const { ok, result } = await callWorker<CompressResult>('compress', [
      file,
      { width: 100, height: 100, keepAspectRatio: true, format: 'image/jpeg' },
      undefined,
    ]);
    expect(ok).toBe(true);
    const r = result!;
    expect(r.width).toBeLessThanOrEqual(100);
    expect(r.height).toBeLessThanOrEqual(100);
    expect(Math.max(r.width, r.height)).toBe(100); // fits the box edge
  });

  it('runs the maxSizeMB ladder in-worker and keeps the rotation (v1.3.0 regression)', async () => {
    const file = await toneFile(240, 160);
    const { ok, result } = await callWorker<CompressResult>('compress', [
      file,
      { rotate: 90, maxSizeMB: 0.002, quality: 0.9, format: 'image/jpeg' },
      undefined,
    ]);

    expect(ok).toBe(true);
    const r = result!;
    expect(r.blob.size).toBeLessThanOrEqual(0.002 * 1024 * 1024);
    // Dimensions alone cannot catch this bug — the pixels can.
    expect(r.height).toBeGreaterThan(r.width);
    expect(dominant(await regionColor(r.blob, 'top'))).toBe('red');
    expect(dominant(await regionColor(r.blob, 'bottom'))).toBe('blue');
  });

  it('rejects HEIC it cannot decode instead of returning a broken blob', async () => {
    // happy-dom has no ImageDecoder, so the native path is unavailable and the
    // optional heic2any fallback is stubbed out by vitest.config.ts.
    const heic = new File([new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112])], 'photo.heic', {
      type: 'image/heic',
    });
    const { ok, error } = await callWorker('compress', [heic, {}, undefined]);
    expect(ok).toBe(false);
    expect(String(error)).toMatch(/HEIC/);
  });
});

describe('worker entry: capability + probe methods', () => {
  it('reports worker-context capabilities', async () => {
    const { ok, result } = await callWorker<{
      hasOffscreenCanvas: boolean;
      hasWebCodecs: boolean;
      hasCreateImageBitmap: boolean;
    }>('getWorkerCapabilities', []);

    expect(ok).toBe(true);
    expect(result).toEqual({
      hasOffscreenCanvas: expect.any(Boolean),
      hasWebCodecs: expect.any(Boolean),
      hasCreateImageBitmap: expect.any(Boolean),
    });
    // The @napi-rs/canvas polyfill provides a real 2d context in this env.
    expect(result!.hasOffscreenCanvas).toBe(true);
  });

  it('reports HEIC support as false when ImageDecoder is missing', async () => {
    const { ok, result } = await callWorker<boolean>('supportsHEIC', []);
    expect(ok).toBe(true);
    expect(result).toBe(false);
  });

  it('probeWorkerPath() completes a real decode→draw→encode roundtrip', async () => {
    const { ok, result } = await callWorker<boolean>('probeWorkerPath', []);
    expect(ok).toBe(true);
    expect(result).toBe(true);
  });

  it('rejects unknown methods with a clear RPC error', async () => {
    const { ok, error } = await callWorker('notARealMethod', []);
    expect(ok).toBe(false);
    expect(String(error)).toMatch(/Unknown method/);
  });
});
