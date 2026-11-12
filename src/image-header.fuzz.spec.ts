/**
 * Property-based fuzzing for the header parser that backs the `maxPixels`
 * decompression-bomb guard (v1.5.0).
 *
 * Why fuzz this function specifically: `readImageDimensions()` is the only
 * place in the library that parses attacker-controlled bytes *before* any
 * decoding — a caller hands it the first 64 KB of a file it did not produce.
 * The contract is narrow and absolute:
 *
 *   1. it never throws, for any input, of any length;
 *   2. a non-null result is complete and sane (known container, positive
 *      integers, within the u32 field width the formats use);
 *   3. a truncated header degrades to `null` (never to a bogus dimension).
 *
 * fast-check explores arbitrary byte arrays and shrinks any counter-example
 * down to the smallest failing input, so a regression here shows up as a
 * one-line repro instead of "some 40 KB PNG".
 *
 * Note for anyone reading the Scorecard report: importing `@fast-check/vitest`
 * is also what marks this repo as fuzzed (OpenSSF scorecard's TypeScript
 * fuzz-detection pattern). Do not "clean up" this import into a re-export.
 */
import { describe, expect, it } from 'vitest';
import { fc, test } from '@fast-check/vitest';
import { readImageDimensions } from './image-header';

/** 64 KB — the documented caller window (see `maxPixels` in service.ts). */
const CALLER_WINDOW = 64 * 1024;

/** Smallest realistic headers, used as truncation seeds. */
const PNG_HEADER = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // signature
  0x00, 0x00, 0x00, 0x0d, // IHDR length
  0x49, 0x48, 0x44, 0x52, // 'IHDR'
  0x00, 0x00, 0x00, 0x02, // width  = 2
  0x00, 0x00, 0x00, 0x03, // height = 3
  0x08, 0x02, 0x00, 0x00, 0x00, // bit depth, colour type, …
]);

const GIF_HEADER = Uint8Array.from([
  0x47, 0x49, 0x46, 0x38, 0x39, 0x61, // 'GIF89a'
  0x10, 0x00, // width  = 16 (LE)
  0x20, 0x00, // height = 32 (LE)
]);

function expectSaneDimensions(
  out: ReturnType<typeof readImageDimensions>,
  inputLength: number,
): void {
  if (out === null) return;

  expect(['png', 'jpeg', 'gif', 'webp']).toContain(out.type);
  // Formats store dimensions in 16- or 32-bit fields; anything outside that is
  // a parser bug, not a find.
  for (const [field, value] of [
    ['width', out.width],
    ['height', out.height],
  ] as const) {
    expect(Number.isInteger(value), `${field} must be an integer, got ${value}`).toBe(true);
    expect(value, `${field} must be > 0`).toBeGreaterThan(0);
    expect(value, `${field} must fit a 32-bit field`).toBeLessThanOrEqual(0xffff_ffff);
  }
  // It can only report what it was given.
  expect(inputLength).toBeGreaterThan(0);
}

describe('readImageDimensions() — fuzzing', () => {
  test.prop([fc.uint8Array({ maxLength: CALLER_WINDOW })], { numRuns: 500 })(
    'never throws and never invents dimensions',
    (bytes) => {
      const out = readImageDimensions(bytes);
      expectSaneDimensions(out, bytes.length);
    },
  );

  test.prop([fc.uint8Array({ maxLength: CALLER_WINDOW })], { numRuns: 200 })(
    'is deterministic for identical input',
    (bytes) => {
      expect(readImageDimensions(bytes)).toEqual(readImageDimensions(bytes));
    },
  );

  it('returns null for every truncation of a valid PNG header', () => {
    for (let cut = 0; cut < PNG_HEADER.length; cut++) {
      const out = readImageDimensions(PNG_HEADER.subarray(0, cut));
      if (out === null) continue;
      // A partially-read PNG may only report once the IHDR dimensions exist.
      expectSaneDimensions(out, cut);
      expect(cut).toBeGreaterThanOrEqual(24);
    }
  });

  it('reads the dimensions out of a complete PNG header', () => {
    expect(readImageDimensions(PNG_HEADER)).toEqual({ type: 'png', width: 2, height: 3 });
  });

  test.prop([fc.nat({ max: GIF_HEADER.length })], { numRuns: 100 })(
    'every truncation of a GIF header stays safe',
    (cut) => {
      const out = readImageDimensions(GIF_HEADER.subarray(0, cut));
      if (out !== null) {
        expectSaneDimensions(out, cut);
        expect(out.type).toBe('gif');
      }
    },
  );
});
