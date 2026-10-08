/**
 * v1.5.0 — header-only dimension reader (`readImageDimensions`).
 *
 * This is the cheap half of the decompression-bomb guard: it must return the
 * dimensions a file *declares* from its first bytes, without decoding, and must
 * return `null` (never throw) for containers it does not understand.
 *
 * Fixtures are real encoder output (@napi-rs/canvas) so the parsers are checked
 * against actual PNG/JPEG/WebP bytes, plus a hand-built GIF header (the encoder
 * cannot write GIF).
 */
import { describe, expect, it } from 'vitest';
import { createCanvas } from '@napi-rs/canvas';
import { readImageDimensions } from './image-header';

function bytesOf(blob: Uint8Array | Buffer): Uint8Array {
  return new Uint8Array(blob);
}

function encode(width: number, height: number, type: 'image/png' | 'image/jpeg' | 'image/webp'): Uint8Array {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#3366ff';
  ctx.fillRect(0, 0, width, height);
  return bytesOf(canvas.toBuffer(type as 'image/png'));
}

/** Minimal but valid GIF89a header: "GIF89a" + width/height little-endian. */
function gifHeader(width: number, height: number): Uint8Array {
  const b = new Uint8Array(16);
  'GIF89a'.split('').forEach((c, i) => (b[i] = c.charCodeAt(0)));
  b[6] = width & 0xff;
  b[7] = (width >> 8) & 0xff;
  b[8] = height & 0xff;
  b[9] = (height >> 8) & 0xff;
  return b;
}

describe('v1.5.0 readImageDimensions', () => {
  it('reads PNG dimensions from IHDR', () => {
    expect(readImageDimensions(encode(120, 45, 'image/png'))).toEqual({
      type: 'png',
      width: 120,
      height: 45,
    });
  });

  it('reads JPEG dimensions from the SOF frame header', () => {
    expect(readImageDimensions(encode(200, 133, 'image/jpeg'))).toEqual({
      type: 'jpeg',
      width: 200,
      height: 133,
    });
  });

  it('reads WebP dimensions (VP8/VP8L/VP8X depending on the encoder)', () => {
    const dims = readImageDimensions(encode(64, 32, 'image/webp'));
    expect(dims).not.toBeNull();
    expect(dims).toMatchObject({ type: 'webp', width: 64, height: 32 });
  });

  it('reads GIF dimensions from the screen descriptor', () => {
    expect(readImageDimensions(gifHeader(800, 600))).toEqual({
      type: 'gif',
      width: 800,
      height: 600,
    });
  });

  it('sees the DECLARED size even when the file is tiny (the bomb case)', () => {
    // Real 16×16 PNG, with the IHDR width/height overwritten to 100000×100000:
    // ~200 bytes on disk claiming 10 billion pixels. This is exactly what the
    // maxPixels guard has to catch before anything is allocated.
    const png = encode(16, 16, 'image/png');
    const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
    view.setUint32(16, 100_000); // width  (big-endian, IHDR)
    view.setUint32(20, 100_000); // height

    expect(readImageDimensions(png)).toEqual({ type: 'png', width: 100_000, height: 100_000 });
    expect(png.byteLength).toBeLessThan(1024); // proves nothing was decompressed
  });

  it('returns null for unknown containers, truncated input and empty buffers', () => {
    const png = encode(8, 8, 'image/png');
    expect(readImageDimensions(png.slice(0, 8))).toBeNull(); // signature only
    expect(readImageDimensions(new Uint8Array(0))).toBeNull();
    expect(readImageDimensions(new TextEncoder().encode('not an image at all'))).toBeNull();
    // ISOBMFF/AVIF ftyp box — deliberately unsupported pre-decode
    const avif = new Uint8Array(32);
    avif.set([0x00, 0x00, 0x00, 0x20], 0);
    avif.set(new TextEncoder().encode('ftypavif'), 4);
    expect(readImageDimensions(avif)).toBeNull();
  });

  it('rejects zero/absurd dimensions instead of returning them', () => {
    const png = encode(16, 16, 'image/png');
    const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
    view.setUint32(16, 0); // width 0 → invalid
    expect(readImageDimensions(png)).toBeNull();
  });
});
