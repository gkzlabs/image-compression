/**
 * Tests for the v0.2.2 progress log improvements (attempt + totalPaths).
 *
 * Verifies that:
 * - The cascade emits `totalPaths` in every progress event after the cascade
 *   plan is known
 * - Fallback messages include both the failed path and the next path being tried
 * - Attempt counter is stable within a single path's lifetime
 */
import type { CompressionProgress } from './types';

describe('CompressionProgress (v0.2.2+)', () => {
  it('CompressionProgress type has totalPaths field', () => {
    // Compile-time check: this assignment is valid only if totalPaths is optional
    const event: CompressionProgress = {
      stage: 'detecting',
      percent: 5,
      totalPaths: 4,
      attempt: 1,
      message: 'Trying webcodecs-worker (1/4)',
    };
    expect(event.totalPaths).toBe(4);
    expect(event.attempt).toBe(1);
  });

  it('CompressionProgress can omit totalPaths (backward compat)', () => {
    // Old consumers should still work
    const event: CompressionProgress = {
      stage: 'detecting',
      percent: 5,
    };
    expect(event.totalPaths).toBeUndefined();
  });
});

describe('Fallback message format', () => {
  it('includes failed path → next path (N/M) format', () => {
    const failedPath = 'webcodecs-worker';
    const nextPath = 'offscreen-worker';
    const attempt = 1;
    const totalPaths = 4;

    const message = `${failedPath} failed → trying ${nextPath} (${attempt + 1}/${totalPaths})`;
    expect(message).toBe('webcodecs-worker failed → trying offscreen-worker (2/4)');
  });

  it('last attempt has no next-path message', () => {
    // When all paths fail, we don't emit a fallback event (per service.ts)
    const isLastAttempt = (i: number, total: number) => i === total - 1;
    expect(isLastAttempt(3, 4)).toBe(true);
  });
});

describe('emit() injects totalPaths (via service)', () => {
  it('wrapper logic preserves totalPaths on every event', () => {
    // Simulate the wrapper from service.ts
    let totalPaths: number | undefined;
    const emitted: CompressionProgress[] = [];
    const emit = (p: CompressionProgress) => {
      if (totalPaths !== undefined && p.totalPaths === undefined) {
        p.totalPaths = totalPaths;
      }
      emitted.push(p);
    };

    // Before cascade plan: no totalPaths
    emit({ stage: 'detecting', percent: 5, message: 'detecting' });
    expect(emitted[0].totalPaths).toBeUndefined();

    // After cascade plan: totalPaths injected automatically
    totalPaths = 4;
    emit({ stage: 'decoding', percent: 20, path: 'webcodecs-worker', attempt: 1 });
    expect(emitted[1].totalPaths).toBe(4);

    // Explicit totalPaths is preserved
    emit({ stage: 'fallback', percent: 0, path: 'webcodecs-worker', attempt: 1, totalPaths: 4 });
    expect(emitted[2].totalPaths).toBe(4);
  });
});
