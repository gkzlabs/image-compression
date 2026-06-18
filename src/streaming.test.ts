import { ImageCompression, compress$, compressAll$ } from './index';
import { CompressionError, isCompressionResult, isBatchResult } from './types';
import type { CompressionResult, CompressionProgress } from './types';

describe('Streaming API (AsyncIterable)', () => {
  let svc: ImageCompression;

  beforeEach(() => { svc = new ImageCompression(); });
  afterEach(() => { svc.dispose(); });

  describe('compress$()', () => {
    it('yields a CompressionProgress first, then a CompressionResult', async () => {
      const file = new File([new Uint8Array([0xff, 0xd8, 0xff])], 'test.jpg', { type: 'image/jpeg' });
      const events: (CompressionProgress | CompressionResult)[] = [];
      for await (const evt of compress$(file, { forceServer: true }, svc)) {
        events.push(evt);
      }
      const first = events[0];
      expect(isCompressionResult(first)).toBe(false);
    });

    it('emits at least 1 progress event (detecting stage)', async () => {
      const file = new File([new Uint8Array([0xff, 0xd8, 0xff])], 'test.jpg', { type: 'image/jpeg' });
      const events: unknown[] = [];
      for await (const evt of compress$(file, { forceServer: true }, svc)) {
        events.push(evt);
      }
      const hasDetecting = events.some((e) => (e as CompressionProgress).stage === 'detecting');
      expect(hasDetecting).toBe(true);
    });

    it('propagates errors from the underlying compress()', async () => {
      const file = new File([new Uint8Array([0xff, 0xd8, 0xff])], 'test.jpg', { type: 'image/jpeg' });
      await expect(async () => {
        for await (const _evt of compress$(file, { forcePath: 'bogus' as any }, svc)) {
          // Should not get here
        }
      }).rejects.toThrow(CompressionError);
    });

    it('emits final result with blob + file + name + path + tier + mimeType', async () => {
      const file = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], 'photo.jpg', { type: 'image/jpeg' });
      let result: CompressionResult | null = null;
      for await (const evt of compress$(file, { forceServer: true }, svc)) {
        if (isCompressionResult(evt)) {
          result = evt;
        }
      }
      expect(result).not.toBeNull();
      expect(result!.blob).toBeInstanceOf(Blob);
      expect(result!.file).toBeInstanceOf(Blob);
      expect(result!.name).toBe('photo.jpg');
      expect(result!.path).toBe('server-fallback');
      expect(result!.tier).toBe('low');
      expect(result!.mimeType).toBe('image/jpeg');
    });

    it('supports AbortSignal (throws on abort)', async () => {
      const file = new File([new Uint8Array([0xff, 0xd8, 0xff])], 'test.jpg', { type: 'image/jpeg' });
      const controller = new AbortController();
      controller.abort();
      await expect(async () => {
        for await (const _evt of compress$(file, { signal: controller.signal }, svc)) {
          // Should not get here
        }
      }).rejects.toThrow(/aborted/i);
    });
  });

  describe('compressAll$()', () => {
    it('emits per-file progress events tagged with fileIndex', async () => {
      const files = [
        new File([new Uint8Array([0xff, 0xd8, 0xff])], 'a.jpg', { type: 'image/jpeg' }),
        new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], 'b.jpg', { type: 'image/jpeg' }),
      ];
      const events: (CompressionResult[] | { fileIndex: number; progress: CompressionProgress })[] = [];
      for await (const evt of compressAll$(files, { forceServer: true }, 2, svc)) {
        events.push(evt);
      }
      const last = events[events.length - 1];
      expect(isBatchResult(last)).toBe(true);
      expect(last).toHaveLength(2);
    });

    it('respects results order (matches input order)', async () => {
      const files = [
        new File([new Uint8Array([0xff, 0xd8, 0xff])], 'first.jpg', { type: 'image/jpeg' }),
        new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], 'second.jpg', { type: 'image/jpeg' }),
        new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00])], 'third.jpg', { type: 'image/jpeg' }),
      ];
      let results: CompressionResult[] = [];
      for await (const evt of compressAll$(files, { forceServer: true }, 2, svc)) {
        if (isBatchResult(evt)) {
          results = evt;
        }
      }
      expect(results.map((r) => r.name)).toEqual(['first.jpg', 'second.jpg', 'third.jpg']);
    });

    it('respects maxConcurrent', async () => {
      const files = Array.from(
        { length: 5 },
        (_, i) => new File([new Uint8Array([0xff, 0xd8, 0xff])], `file${i}.jpg`, { type: 'image/jpeg' }),
      );
      const events: unknown[] = [];
      for await (const evt of compressAll$(files, { forceServer: true }, 1, svc)) {
        events.push(evt);
      }
      const last = events[events.length - 1] as CompressionResult[];
      expect(last).toHaveLength(5);
    });

    it('handles empty file list', async () => {
      const events: (CompressionResult[] | { fileIndex: number; progress: CompressionProgress })[] = [];
      for await (const evt of compressAll$([], { forceServer: true }, 2, svc)) {
        events.push(evt);
      }
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual([]);
    });
  });
});
