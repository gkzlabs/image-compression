/**
 * v1.5.0 — the `heic2any` decoder must never hang `compress()`.
 *
 * Before this, the runtime decoder (URL hatch or bare specifier) was awaited
 * unbounded: a `__IC_HEIC2ANY_URL` whose host never answers, or a decoder that
 * never settles, left `compress()` waiting on the browser's own import timeout
 * (minutes) or forever. `withDecoderTimeout` bounds both the import and the
 * decode call, and the cascade falls back instead.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { tryDecodeHEICLazy, withDecoderTimeout } from './heic';

type TestGlobals = {
  __IC_HEIC2ANY_URL?: string;
  __IC_HEIC_DECODER_TIMEOUT_MS?: number;
  heic2any?: unknown;
};

const g = globalThis as TestGlobals;

afterEach(() => {
  delete g.__IC_HEIC2ANY_URL;
  delete g.__IC_HEIC_DECODER_TIMEOUT_MS;
  delete g.heic2any;
});

function heicFile(): File {
  // Bytes that look like a HEIC container; the fake decoder ignores content.
  return new File([new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70])], 'photo.heic', {
    type: 'image/heic',
  });
}

describe('v1.5.0 withDecoderTimeout', () => {
  it('resolves when the work settles in time', async () => {
    await expect(withDecoderTimeout(Promise.resolve('ok'), 'test', 1000)).resolves.toBe('ok');
  });

  it('rejects with a labelled timeout when the work never settles', async () => {
    const start = Date.now();
    await expect(withDecoderTimeout(new Promise(() => {}), 'decoder', 30)).rejects.toThrow(
      /decoder timed out after 30ms/,
    );
    expect(Date.now() - start).toBeLessThan(1000);
  });

  it('propagates the underlying failure (no timeout needed)', async () => {
    await expect(withDecoderTimeout(Promise.reject(new Error('boom')), 'decoder', 1000)).rejects.toThrow(
      'boom',
    );
  });
});

describe('v1.5.0 tryDecodeHEICLazy settles when the decoder hangs', () => {
  it('returns null instead of waiting forever on a never-settling decoder module', async () => {
    g.__IC_HEIC_DECODER_TIMEOUT_MS = 50;
    // The URL hatch resolves to a module that exports nothing useful; the decode
    // itself comes from the global the UMD build would install.
    g.__IC_HEIC2ANY_URL = 'data:text/javascript,export default function(){}';
    g.heic2any = () => new Promise(() => {}); // decoder accepted the blob, never answers

    const start = Date.now();
    const out = await tryDecodeHEICLazy(heicFile());

    expect(out).toBeNull();
    expect(Date.now() - start).toBeLessThan(3000); // bounded, not the browser's timeout
  });

  it('still decodes when the decoder answers normally', async () => {
    g.__IC_HEIC_DECODER_TIMEOUT_MS = 500;
    g.__IC_HEIC2ANY_URL = 'data:text/javascript,export default function(){}';
    const jpeg = new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: 'image/jpeg' });
    g.heic2any = async () => jpeg;

    const out = await tryDecodeHEICLazy(heicFile());
    expect(out).not.toBeNull();
    expect(out!.type).toBe('image/jpeg');
    expect(out!.size).toBe(jpeg.size);
  });
});
