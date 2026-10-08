/**
 * v1.4.0 — strict target-size mode (`targetSizeStrict`, `minQuality`,
 * `minDimension`) and the `targetMet` / `outputQuality` / `outputScale`
 * metadata on CompressionResult.
 *
 * Two layers are covered:
 *  1. The canvas-agnostic ladder (`shrinkToTargetSize`) with a FAKE encoder, so
 *     the probe sequence and every floor are asserted exactly — no encoder
 *     behaviour in the way.
 *  2. The service wiring (`compress()` → `reachTargetSize`) with a REAL noisy
 *     JPEG + the real @napi-rs/canvas encoder, so "non-strict gives up,
 *     strict hits the budget" is proven end-to-end.
 *
 * The non-strict assertions double as a regression guard: v1.4.0 must not change
 * what the default ladder does (quality floor 0.2, dimension floor 50%).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createCanvas } from '@napi-rs/canvas';
import {
  DEFAULT_TARGET_MIN_DIMENSION,
  DEFAULT_TARGET_MIN_QUALITY,
  shrinkToTargetSize,
  STRICT_MAX_LADDER_PROBES,
  STRICT_TARGET_MIN_QUALITY,
  type TargetSizeLadderOptions,
} from './target-size';
import { ImageCompression } from './service';
import { encodeWithTargetSize } from './worker-helpers';

/** Source dimensions used by the fake-encoder tests. */
const W = 400;
const H = 300;
/** Bytes per (pixel × quality) unit for the fake encoder. */
const K = 1 / 64;

/** Deterministic fake encode size: bigger canvas + higher quality = bigger blob. */
const SIZE = (w: number, h: number, q: number): number => Math.max(1, Math.round(w * h * q * K));

/** Fake `encodeAt` adapter that records every probe. */
function fakeEncoder(sizeFn: (w: number, h: number, q: number) => number = SIZE) {
  const calls: { w: number; h: number; q: number }[] = [];
  const encodeAt = async (w: number, h: number, q: number): Promise<Blob | null> => {
    calls.push({ w, h, q });
    return new Blob([new Uint8Array(Math.max(1, Math.round(sizeFn(w, h, q))))], {
      type: 'image/jpeg',
    });
  };
  return { calls, encodeAt };
}

/** The ladder never reads the bitmap — the adapter closes over it. */
const DUMMY_BITMAP = {} as ImageBitmap;

function ladder(
  targetBytes: number,
  opts: TargetSizeLadderOptions = {},
  format = 'image/jpeg',
  width = W,
  height = H,
) {
  const enc = fakeEncoder();
  return {
    calls: enc.calls,
    run: () =>
      shrinkToTargetSize(DUMMY_BITMAP, width, height, format, 0.85, targetBytes, enc.encodeAt, opts),
  };
}

/** Real noisy JPEG — the native encoder can't compress random pixels well. */
function makeNoisyJpegBlob(width: number, height: number): File {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(width, height);
  for (let i = 0; i < img.data.length; i += 4) {
    img.data[i] = Math.random() * 255;
    img.data[i + 1] = Math.random() * 255;
    img.data[i + 2] = Math.random() * 255;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const buffer = canvas.toBuffer('image/jpeg', 0.95);
  return new File([new Uint8Array(buffer)], 'noisy.jpg', { type: 'image/jpeg' });
}

afterEach(() => {
  // Nothing global is patched in this spec (real encoder end-to-end).
});

describe('v1.4.0 shrinkToTargetSize — default ladder unchanged', () => {
  it('returns the caller quality with a single probe when it already fits', async () => {
    const target = SIZE(W, H, 0.85) + 10;
    const { calls, run } = ladder(target);
    const out = await run();

    expect(out).not.toBeNull();
    expect(out!.met).toBe(true);
    expect(out!.quality).toBe(0.85);
    expect(out!.scale).toBe(1);
    expect(calls).toHaveLength(1); // best case: one encode, no ladder walk
  });

  it('stops at the documented floors (quality 0.2 / dimensions 50%)', async () => {
    const { calls, run } = ladder(1); // unreachable
    const out = await run();

    expect(out).not.toBeNull();
    expect(out!.met).toBe(false);
    expect(out!.quality).toBe(DEFAULT_TARGET_MIN_QUALITY);
    expect(out!.scale).toBe(0.5);
    // No probe ever went below the floors.
    expect(calls.every((c) => c.q >= DEFAULT_TARGET_MIN_QUALITY - 1e-9)).toBe(true);
    expect(calls.every((c) => c.w >= Math.round(W * 0.5))).toBe(true);
  });

  it('ignores minDimension unless strict is set', async () => {
    const { calls, run } = ladder(1, { minDimension: 8 });
    const out = await run();

    expect(out!.scale).toBe(0.5); // still the default dimension floor
    expect(calls.every((c) => c.w >= Math.round(W * 0.5))).toBe(true);
  });
});

describe('v1.4.0 shrinkToTargetSize — strict mode', () => {
  it('goes below the default quality floor at the original dimensions', async () => {
    // Reachable only with quality < 0.2 at full size.
    const target = SIZE(W, H, 0.12);
    const { run } = ladder(target, { strict: true });
    const out = await run();

    expect(out!.met).toBe(true);
    expect(out!.scale).toBe(1); // resolution preserved — quality pays the bill
    expect(out!.quality).toBeLessThan(DEFAULT_TARGET_MIN_QUALITY);
    expect(out!.quality).toBeGreaterThanOrEqual(STRICT_TARGET_MIN_QUALITY);
    expect(out!.blob.size).toBeLessThanOrEqual(target);
  });

  it('goes below the default dimension floor when quality alone cannot fit', async () => {
    const { run } = ladder(10, { strict: true });
    const out = await run();

    expect(out!.met).toBe(true);
    expect(out!.scale).toBeLessThan(0.5);
    expect(out!.width).toBeLessThan(Math.round(W * 0.5));
    expect(out!.blob.size).toBeLessThanOrEqual(10);
    // Quality-first ordering: it only shrank dimensions after the quality floor.
    expect(out!.quality).toBeLessThanOrEqual(STRICT_TARGET_MIN_QUALITY + 0.05);
  });

  it('honours an explicit minQuality (never probes lower)', async () => {
    const calls: number[] = [];
    const enc = fakeEncoder();
    const encodeAt = async (w: number, h: number, q: number): Promise<Blob | null> => {
      calls.push(q);
      return enc.encodeAt(w, h, q);
    };
    const out = await shrinkToTargetSize(DUMMY_BITMAP, W, H, 'image/jpeg', 0.85, SIZE(W, H, 0.35), encodeAt, {
      strict: true,
      minQuality: 0.4,
    });

    expect(out).not.toBeNull();
    expect(out!.met).toBe(true);
    expect(out!.quality).toBeGreaterThanOrEqual(0.4);
    expect(calls.every((q) => q >= 0.4 - 1e-9)).toBe(true);
  });

  it('honours minDimension (longest edge floor in px)', async () => {
    const { run } = ladder(1, { strict: true, minDimension: 100 });
    const out = await run();

    expect(out!.met).toBe(false); // 1 byte is unreachable at any allowed size
    expect(out!.width).toBeGreaterThanOrEqual(100); // never below the floor
    expect(Math.max(out!.width, out!.height)).toBeGreaterThanOrEqual(100);
  });

  it('still reports met: false when even the strict floors cannot fit', async () => {
    const { run } = ladder(1, { strict: true });
    const out = await run();

    expect(out!.met).toBe(false);
    expect(out!.blob.size).toBeGreaterThan(1);
    expect(out!.scale).toBeCloseTo(DEFAULT_TARGET_MIN_DIMENSION / W, 2);
  });

  it('bounds the number of encodes (no unbounded re-encode loop)', async () => {
    // Huge source + impossible target: the ladder must walk far past the default
    // floor and then stop, not spin.
    const { calls, run } = ladder(1, { strict: true }, 'image/jpeg', 4000, 3000);
    const out = await run();

    expect(out!.met).toBe(false);
    expect(calls.length).toBeLessThanOrEqual(STRICT_MAX_LADDER_PROBES);
    expect(calls.length).toBeGreaterThan(6); // it did walk past the default ladder
  });

  it('PNG ignores quality (dimension-only ladder) and reports no outputQuality', async () => {
    const { calls, run } = ladder(1, { strict: true }, 'image/png');
    const out = await run();

    expect(calls.every((c) => c.q === 0.92)).toBe(true);
    expect(out!.quality).toBeUndefined();
    expect(out!.scale).toBeLessThan(0.5); // strict still shrinks dimensions
  });
});

describe('v1.4.0 worker helper — encodeWithTargetSize passes the ladder options', () => {
  /** 400×300 two-tone bitmap (real OffscreenCanvas in this env). */
  function toneBitmap(width = 400, height = 300): ImageBitmap {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    ctx.fillStyle = '#123456';
    ctx.fillRect(0, 0, width, height);
    return canvas.transferToImageBitmap();
  }

  it('returns ladder metadata (met / quality / scale) alongside the blob', async () => {
    const bitmap = toneBitmap();
    const out = await encodeWithTargetSize(
      bitmap,
      'image/jpeg',
      0.85,
      1e-9, // unreachable → smallest achievable
      400,
      300,
      undefined,
      { strict: true },
    );

    expect(out).not.toBeNull();
    expect(out!.met).toBe(false);
    expect(out!.blob.size).toBeGreaterThan(0);
    expect(out!.scale).toBeLessThan(0.5); // strict went past the default dim floor
    expect(typeof out!.quality).toBe('number');
  });

  it('ignores the strict floors when strict is off (worker parity with v1.3.x)', async () => {
    const bitmap = toneBitmap();
    const out = await encodeWithTargetSize(
      bitmap,
      'image/jpeg',
      0.85,
      1e-9,
      400,
      300,
      undefined,
      { strict: false, minDimension: 8 },
    );

    expect(out!.scale).toBe(0.5); // default dimension floor
    expect(out!.width).toBe(200);
  });
});

describe('v1.4.0 service integration — targetMet metadata', () => {
  it('non-strict gives up at the default floors, strict SAME target fits', async () => {
    const file = makeNoisyJpegBlob(800, 600);
    const svc = new ImageCompression();
    try {
      // Calibrate on the real encoder: an unreachable target makes the default
      // ladder return its floor (smallest it is willing to produce).
      const baseline = await svc.compress(file, {
        maxSizeMB: 1e-9,
        forcePath: 'canvas-main',
      });
      // 75% of the default floor: below what the default ladder will produce,
      // above the strict floor (which can reach ~64px + quality 0.05).
      const targetBytes = Math.floor(baseline.compressedSize * 0.75);
      const targetMB = targetBytes / 1024 / 1024;

      const relaxed = await svc.compress(file, {
        maxSizeMB: targetMB,
        forcePath: 'canvas-main',
      });
      expect(relaxed.targetMet).toBe(false); // below the default floor
      expect(relaxed.compressedSize).toBeGreaterThan(targetBytes);

      const strict = await svc.compress(file, {
        maxSizeMB: targetMB,
        forcePath: 'canvas-main',
        targetSizeStrict: true,
      });
      expect(strict.targetMet).toBe(true);
      expect(strict.compressedSize).toBeLessThanOrEqual(targetBytes);
      expect(strict.outputScale).toBeLessThan(0.5); // past the default dim floor
      expect(strict.outputQuality).toBeDefined();
      expect(strict.compressedSize).toBeLessThan(relaxed.compressedSize);
    } finally {
      svc.dispose();
    }
  });

  it('reports targetMet true and no ladder metadata when the first encode already fits', async () => {
    const file = makeNoisyJpegBlob(320, 240);
    const svc = new ImageCompression();
    try {
      const result = await svc.compress(file, {
        maxSizeMB: 5, // generous — nothing to shrink
        forcePath: 'canvas-main',
      });
      expect(result.targetMet).toBe(true);
      expect(result.outputQuality).toBeUndefined();
      expect(result.outputScale).toBeUndefined();
    } finally {
      svc.dispose();
    }
  });

  it('adds NO target-size keys when maxSizeMB is not requested', async () => {
    const file = makeNoisyJpegBlob(200, 200);
    const svc = new ImageCompression();
    try {
      const result = await svc.compress(file, { forcePath: 'canvas-main' });
      expect('targetMet' in result).toBe(false);
      expect('outputQuality' in result).toBe(false);
      expect('outputScale' in result).toBe(false);
    } finally {
      svc.dispose();
    }
  });
});
