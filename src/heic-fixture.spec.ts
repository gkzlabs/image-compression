import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { tryDecodeHEICLazy, isHEICFile } from './heic';
import { tryDecodeHEIC } from './worker-helpers';

/**
 * HEIC fixture tests — the real-file gap.
 *
 * Every other HEIC test uses a 4-byte stand-in blob, so nothing proved the path
 * works on an actual HEIC file. These tests use `test/fixtures/sample.heic`
 * (a real HEIF/HEVC file produced by macOS ImageIO, 320x240, four solid
 * quadrants + a checker block) and compare pixels against
 * `sample.reference.png` — the same .heic decoded back by ImageIO, i.e. ground
 * truth. Regenerate with `node test/fixtures/make-fixtures.mjs`.
 *
 * The "decoder" loaded through the `__IC_HEIC2ANY_URL` hatch is
 * `test/fixtures/reference-decoder.mjs`: it records what it received (so we can
 * prove the REAL .heic bytes reached it) and returns the ground-truth pixels.
 */
const FIXTURES = resolve(process.cwd(), 'test/fixtures');
const fixturePath = (name: string) => resolve(FIXTURES, name);
const fixtureUrl = (name: string) => pathToFileURL(fixturePath(name)).href;
const heicBytes = new Uint8Array(readFileSync(fixturePath('sample.heic')));

function fnv1a(bytes: Uint8Array): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

interface Pixels {
  width: number;
  height: number;
  at: (x: number, y: number) => [number, number, number];
}

async function decodeToPixels(blob: Blob): Promise<Pixels> {
  const img = await loadImage(Buffer.from(await blob.arrayBuffer()));
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img as unknown as never, 0, 0);
  return {
    width: img.width,
    height: img.height,
    at: (x, y) => {
      const d = ctx.getImageData(x, y, 1, 1).data;
      return [d[0], d[1], d[2]];
    },
  };
}

function expectQuadrants(px: Pixels, label: string) {
  // Sample well inside each quadrant to stay clear of codec ringing at the seams.
  const topLeft = px.at(40, 40);
  const topRight = px.at(280, 40);
  const bottomLeft = px.at(40, 200);
  const bottomRight = px.at(280, 200);

  expect(topLeft[0], `${label}: top-left must be red (R)`).toBeGreaterThan(180);
  expect(topLeft[2], `${label}: top-left must be red (B)`).toBeLessThan(80);
  expect(topRight[1], `${label}: top-right must be green (G)`).toBeGreaterThan(180);
  expect(topRight[0], `${label}: top-right must be green (R)`).toBeLessThan(80);
  expect(bottomLeft[2], `${label}: bottom-left must be blue (B)`).toBeGreaterThan(180);
  expect(bottomLeft[0], `${label}: bottom-left must be blue (R)`).toBeLessThan(80);
  expect(bottomRight[0], `${label}: bottom-right must be yellow (R)`).toBeGreaterThan(180);
  expect(bottomRight[1], `${label}: bottom-right must be yellow (G)`).toBeGreaterThan(180);
  expect(bottomRight[2], `${label}: bottom-right must be yellow (B)`).toBeLessThan(80);
}

describe('HEIC fixture (real .heic file)', () => {
  const originalUrl = (globalThis as { __IC_HEIC2ANY_URL?: string }).__IC_HEIC2ANY_URL;
  const originalHeic2any = (globalThis as { heic2any?: unknown }).heic2any;
  const originalImageDecoder = (globalThis as { ImageDecoder?: unknown }).ImageDecoder;

  beforeEach(() => {
    delete (globalThis as { __IC_REFERENCE_DECODER?: unknown }).__IC_REFERENCE_DECODER;
  });

  afterEach(() => {
    if (originalUrl === undefined) delete (globalThis as { __IC_HEIC2ANY_URL?: string }).__IC_HEIC2ANY_URL;
    else (globalThis as { __IC_HEIC2ANY_URL?: string }).__IC_HEIC2ANY_URL = originalUrl;
    if (originalHeic2any === undefined) delete (globalThis as { heic2any?: unknown }).heic2any;
    else (globalThis as { heic2any?: unknown }).heic2any = originalHeic2any;
    (globalThis as { ImageDecoder?: unknown }).ImageDecoder = originalImageDecoder;
    vi.resetModules();
  });

  describe('fixture integrity', () => {
    it('is a real ISO-BMFF HEIF file (not a stand-in blob)', () => {
      const brand = String.fromCharCode(...heicBytes.slice(4, 8));
      const compatible = String.fromCharCode(...heicBytes.slice(8, 12));
      expect(brand).toBe('ftyp');
      expect(['heic', 'heix', 'hevc', 'mif1', 'msf1']).toContain(compatible);
      expect(heicBytes.length).toBeGreaterThan(200);
    });

    it('reference PNG is the decoded .heic at 320x240', async () => {
      const img = await loadImage(readFileSync(fixturePath('sample.reference.png')));
      expect(img.width).toBe(320);
      expect(img.height).toBe(240);
    });

    it('reference PNG has the expected quadrant colours', async () => {
      const px = await decodeToPixels(
        new Blob([new Uint8Array(readFileSync(fixturePath('sample.reference.png')))], {
          type: 'image/png',
        }),
      );
      expectQuadrants(px, 'reference');
    });
  });

  describe('detection', () => {
    it('detects the real file by name and by MIME type', () => {
      expect(isHEICFile(new File([heicBytes], 'IMG_4321.HEIC'))).toBe(true);
      expect(isHEICFile(new Blob([heicBytes], { type: 'image/heic' }))).toBe(true);
      expect(isHEICFile(new Blob([heicBytes], { type: 'image/heif' }))).toBe(true);
    });

    it('does not mis-detect other formats', () => {
      const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
      expect(isHEICFile(new File([jpeg], 'photo.jpg', { type: 'image/jpeg' }))).toBe(false);
      expect(isHEICFile(new File([heicBytes], 'notes.txt', { type: 'text/plain' }))).toBe(false);
    });
  });

  describe('path 2 — decoder module via __IC_HEIC2ANY_URL (runtime import, no eval)', () => {
    it('does not use eval or new Function (CSP-safe loader)', () => {
      const src = readFileSync(resolve(process.cwd(), 'src/heic.ts'), 'utf8');
      expect(src).not.toMatch(/\beval\s*\(/);
      expect(src).not.toMatch(/new Function\s*\(/);
    });

    /**
     * The module-import *mechanics* of the hatch need a real module loader, so
     * they are covered where they actually run:
     *   - test/heic-hatch-node.mjs  — built bundle in plain Node, hatch → file URL
     *   - test/browser-smoke.mjs    — real Chromium, hatch → module over HTTP
     *   - test/worker-deep-check.mjs — same, inside the Worker after v1.3.3
     * Here we verify the contract the library owes the decoder, with the decoder
     * reachable the way `<script src="heic2any.js">` users provide it.
     */
    it('hands the real .heic bytes to the decoder and returns ground-truth pixels', async () => {
      (globalThis as { __IC_HEIC2ANY_URL?: string }).__IC_HEIC2ANY_URL =
        fixtureUrl('reference-decoder.mjs');

      const seen: { size: number; fnv1a: number; type: string }[] = [];
      (globalThis as { heic2any?: unknown }).heic2any = async ({
        blob,
        toType = 'image/jpeg',
      }: {
        blob: Blob;
        toType: string;
      }) => {
        const bytes = new Uint8Array(await blob.arrayBuffer());
        seen.push({ size: bytes.length, fnv1a: fnv1a(bytes), type: blob.type });
        const img = await loadImage(readFileSync(fixturePath('sample.reference.png')));
        const canvas = new OffscreenCanvas(img.width, img.height);
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img as unknown as never, 0, 0);
        return canvas.convertToBlob({ type: toType, quality: 0.95 });
      };

      const decoded = await tryDecodeHEICLazy(
        new File([heicBytes], 'sample.heic', { type: 'image/heic' }),
      );

      expect(seen).toHaveLength(1);
      expect(seen[0].size).toBe(heicBytes.length);
      expect(seen[0].fnv1a).toBe(fnv1a(heicBytes));
      expect(seen[0].type).toBe('image/heic');

      expect(decoded).toBeInstanceOf(Blob);
      const px = await decodeToPixels(decoded as Blob);
      expect(px.width).toBe(320);
      expect(px.height).toBe(240);
      expectQuadrants(px, 'decoder-scenario');
    });
  });

  describe('path 1 — native ImageDecoder', () => {
    /** Fake ImageDecoder that receives the real bytes and returns ground-truth pixels. */
    function installFakeImageDecoder() {
      const calls: { size: number; fnv1a: number; type: string }[] = [];
      class FakeImageDecoder {
        static async isTypeSupported(type: string) {
          return type === 'image/heic' || type === 'image/heif';
        }
        constructor(init: { data: ArrayBuffer | Uint8Array; type: string }) {
          const bytes = new Uint8Array(
            init.data instanceof Uint8Array ? init.data : new Uint8Array(init.data as ArrayBuffer),
          );
          calls.push({ size: bytes.length, fnv1a: fnv1a(bytes), type: init.type });
        }
        async decode() {
          // Return an OffscreenCanvas so the library's createImageBitmap() keeps
          // real pixels (the vitest polyfill unwraps canvas sources).
          const img = await loadImage(readFileSync(fixturePath('sample.reference.png')));
          const canvas = new OffscreenCanvas(img.width, img.height);
          const ctx = canvas.getContext('2d');
          ctx?.drawImage(img as unknown as never, 0, 0);
          return { image: canvas };
        }
        close() {}
      }
      (globalThis as { ImageDecoder?: unknown }).ImageDecoder = FakeImageDecoder;
      return calls;
    }

    it('decodes through the native path and hands it the real bytes', async () => {
      const calls = installFakeImageDecoder();
      const decoded = await tryDecodeHEICLazy(
        new File([heicBytes], 'sample.heic', { type: 'image/heic' }),
      );
      expect(calls).toHaveLength(1);
      expect(calls[0].size).toBe(heicBytes.length);
      expect(calls[0].fnv1a).toBe(fnv1a(heicBytes));
      expect(calls[0].type).toBe('image/heic');

      expect(decoded).toBeInstanceOf(Blob);
      const px = await decodeToPixels(decoded as Blob);
      expect(px.width).toBe(320);
      expect(px.height).toBe(240);
      expectQuadrants(px, 'native-decoded');
    });

    it('falls through to the hatch when the native decoder reports unsupported', async () => {
      class UnsupportedDecoder {
        static async isTypeSupported() {
          return false;
        }
        constructor() {
          throw new Error('should not be constructed when unsupported');
        }
      }
      (globalThis as { ImageDecoder?: unknown }).ImageDecoder = UnsupportedDecoder;
      (globalThis as { __IC_HEIC2ANY_URL?: string }).__IC_HEIC2ANY_URL = fixtureUrl(
        'reference-decoder.mjs',
      );
      // The hatch's module import is intercepted by the vitest module runner, so
      // stand in for the decoder the way the browser suites' module provides it.
      (globalThis as { heic2any?: unknown }).heic2any = async ({
        toType = 'image/jpeg',
      }: {
        toType: string;
      }) => {
        const img = await loadImage(readFileSync(fixturePath('sample.reference.png')));
        const canvas = new OffscreenCanvas(img.width, img.height);
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img as unknown as never, 0, 0);
        return canvas.convertToBlob({ type: toType, quality: 0.95 });
      };

      const decoded = await tryDecodeHEICLazy(
        new File([heicBytes], 'sample.heic', { type: 'image/heic' }),
      );
      expect(decoded).toBeInstanceOf(Blob);
      const px = await decodeToPixels(decoded as Blob);
      expectQuadrants(px, 'fallback-decoded');
    });
  });

  describe('path 3 — total failure', () => {
    it('returns null when no decoder is reachable (no throw)', async () => {
      (globalThis as { __IC_HEIC2ANY_URL?: string }).__IC_HEIC2ANY_URL =
        fixtureUrl('does-not-exist.mjs');
      const decoded = await tryDecodeHEICLazy(
        new File([heicBytes], 'sample.heic', { type: 'image/heic' }),
      );
      expect(decoded).toBeNull();
    });
  });

  describe('end-to-end — real .heic through the full cascade', () => {
    it('decodes, compresses and keeps the image content (pixel-verified)', async () => {
      const { ImageCompression } = await import('./service');
      (globalThis as { __IC_HEIC2ANY_URL?: string }).__IC_HEIC2ANY_URL =
        fixtureUrl('reference-decoder.mjs');
      (globalThis as { heic2any?: unknown }).heic2any = async ({
        blob,
        toType = 'image/jpeg',
      }: {
        blob: Blob;
        toType: string;
      }) => {
        // Prove the pipeline handed the decoder the untouched fixture.
        expect(new Uint8Array(await blob.arrayBuffer()).length).toBe(heicBytes.length);
        const img = await loadImage(readFileSync(fixturePath('sample.reference.png')));
        const canvas = new OffscreenCanvas(img.width, img.height);
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img as unknown as never, 0, 0);
        return canvas.convertToBlob({ type: toType, quality: 0.95 });
      };

      const ic = new ImageCompression();
      const result = await ic.compress(
        new File([heicBytes], 'IMG_0001.HEIC', { type: 'image/heic' }),
        { maxWidthOrHeight: 320, quality: 0.9 },
      );

      expect(result.blob.size).toBeGreaterThan(0);
      expect(result.width).toBe(320);
      expect(result.height).toBe(240);
      expect(result.originalSize).toBe(heicBytes.length);

      const px = await decodeToPixels(result.blob);
      expect(px.width).toBe(320);
      expect(px.height).toBe(240);
      expectQuadrants(px, 'end-to-end');
    });
  });

  describe('worker helper — tryDecodeHEIC (native path inside the Worker)', () => {
    it('returns a real-pixel bitmap for the fixture when ImageDecoder supports HEIC', async () => {
      class FakeImageDecoder {
        static async isTypeSupported() {
          return true;
        }
        async decode() {
          const img = await loadImage(readFileSync(fixturePath('sample.reference.png')));
          const canvas = new OffscreenCanvas(img.width, img.height);
          const ctx = canvas.getContext('2d');
          ctx?.drawImage(img as unknown as never, 0, 0);
          return { image: canvas };
        }
        close() {}
      }
      (globalThis as { ImageDecoder?: unknown }).ImageDecoder = FakeImageDecoder;

      const bitmap = await tryDecodeHEIC(new File([heicBytes], 'sample.heic', { type: 'image/heic' }));
      expect(bitmap).not.toBeNull();
      expect(bitmap?.width).toBe(320);
      expect(bitmap?.height).toBe(240);
    });

    it('returns null (no throw) when the worker has no ImageDecoder', async () => {
      (globalThis as { ImageDecoder?: unknown }).ImageDecoder = undefined;
      const bitmap = await tryDecodeHEIC(new File([heicBytes], 'sample.heic', { type: 'image/heic' }));
      expect(bitmap).toBeNull();
    });
  });
});
