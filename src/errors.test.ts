/**
 * CompressionError — code, path, tried, cause fields.
 */
import { CompressionError } from './types';

describe('CompressionError', () => {
  it('is an instance of Error', () => {
    const err = new CompressionError('UNKNOWN', 'test');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(CompressionError);
  });

  it('preserves error name and message', () => {
    const err = new CompressionError('HEIC_UNSUPPORTED', 'Cannot decode HEIC');
    expect(err.name).toBe('CompressionError');
    expect(err.message).toBe('Cannot decode HEIC');
  });

  it('stores code, path, tried, cause', () => {
    const cause = new Error('underlying');
    const err = new CompressionError('ALL_PATHS_FAILED', 'All paths failed', {
      path: 'webcodecs-worker',
      tried: ['webcodecs-worker', 'offscreen-worker', 'canvas-main'],
      cause,
    });
    expect(err.code).toBe('ALL_PATHS_FAILED');
    expect(err.path).toBe('webcodecs-worker');
    expect(err.tried).toEqual(['webcodecs-worker', 'offscreen-worker', 'canvas-main']);
    expect(err.cause).toBe(cause);
  });

  it('can be caught and inspected by code', () => {
    try {
      throw new CompressionError('ABORTED', 'aborted');
    } catch (e) {
      if (e instanceof CompressionError && e.code === 'ABORTED') {
        expect(true).toBe(true);
      } else {
        expect.fail('expected CompressionError with ABORTED code');
      }
    }
  });
});
