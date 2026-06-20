/**
 * Type guards — isCompressionResult, isBatchResult.
 */
import { ImageCompression } from './index';
import { isCompressionResult, isBatchResult } from './types';
import type { CompressionResult, CompressionProgress } from './types';

describe('Type guards', () => {
  it('isCompressionResult returns true for CompressionResult', () => {
    const result: CompressionResult = {
      blob: new Blob(),
      file: new File([new Uint8Array()], 'test.jpg'),
      name: 'test.jpg',
      originalSize: 100,
      compressedSize: 80,
      width: 100,
      height: 100,
      path: 'server-fallback',
      durationMs: 50,
      tier: 'low',
      mimeType: 'image/jpeg',
    };
    expect(isCompressionResult(result)).toBe(true);
  });

  it('isCompressionResult returns false for CompressionProgress', () => {
    const progress: CompressionProgress = {
      stage: 'decoding',
      percent: 50,
    };
    expect(isCompressionResult(progress)).toBe(false);
  });

  it('isBatchResult returns true for CompressionResult[]', () => {
    expect(isBatchResult([])).toBe(true);
    expect(isBatchResult([{} as CompressionResult])).toBe(true);
  });

  it('isBatchResult returns false for BatchProgress', () => {
    expect(isBatchResult({ fileIndex: 0, progress: { stage: 'decoding', percent: 50 } })).toBe(false);
  });
});
