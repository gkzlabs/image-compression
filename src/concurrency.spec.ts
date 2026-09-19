import { describe, expect, it, vi } from 'vitest';
import { ImageCompression } from './service';
import { compressAll$ } from './stream';

/**
 * v1.3.3 (C3) — `maxConcurrency` moved into the options object.
 *
 * `compressAll(files, options, maxConcurrent)` forced callers to pass an empty
 * options object just to reach the third argument. The option is now the
 * supported form and the positional argument must keep working, so both paths
 * are asserted by MEASURING peak parallelism (not by inspecting arguments).
 */
function fakeResult(file: File, index: number) {
  return {
    file,
    name: file.name,
    blob: new Blob([`out-${index}`], { type: 'image/jpeg' }),
    originalSize: 100,
    compressedSize: 10,
    width: 10,
    height: 10,
    mimeType: 'image/jpeg',
    path: 'canvas-main',
    tier: 'high',
    durationMs: 1,
  } as unknown as Awaited<ReturnType<ImageCompression['compress']>>;
}

function trackPeak(svc: ImageCompression, delayMs = 15) {
  const state = { inFlight: 0, peak: 0 };
  vi.spyOn(svc, 'compress').mockImplementation(async (file: File | Blob) => {
    state.inFlight += 1;
    state.peak = Math.max(state.peak, state.inFlight);
    await new Promise((r) => setTimeout(r, delayMs));
    state.inFlight -= 1;
    return fakeResult(file as File, state.peak);
  });
  return state;
}

const files = () =>
  [1, 2, 3, 4].map((i) => new File([`f${i}`], `f${i}.jpg`, { type: 'image/jpeg' }));

describe('compressAll concurrency (v1.3.3)', () => {
  it('uses options.maxConcurrency as the bound', async () => {
    const svc = new ImageCompression();
    const state = trackPeak(svc);
    await svc.compressAll(files(), { maxConcurrency: 1 });
    expect(state.peak).toBe(1);
    svc.dispose();
  });

  it('options.maxConcurrency: 2 bounds at 2 (not the default 2 by accident)', async () => {
    const svc = new ImageCompression();
    const state = trackPeak(svc);
    await svc.compressAll(files(), { maxConcurrency: 2 });
    expect(state.peak).toBe(2);
    svc.dispose();
  });

  it('still honours the deprecated positional argument', async () => {
    const svc = new ImageCompression();
    const state = trackPeak(svc);
    await svc.compressAll(files(), {}, 3);
    expect(state.peak).toBe(3);
    svc.dispose();
  });

  it('options.maxConcurrency wins over the positional argument', async () => {
    const svc = new ImageCompression();
    const state = trackPeak(svc);
    await svc.compressAll(files(), { maxConcurrency: 1 }, 4);
    expect(state.peak).toBe(1);
    svc.dispose();
  });

  it('defaults to 2 when neither is given', async () => {
    const svc = new ImageCompression();
    const state = trackPeak(svc);
    await svc.compressAll(files());
    expect(state.peak).toBe(2);
    svc.dispose();
  });

  it('0 / negative mean unlimited (all four in flight)', async () => {
    const svc = new ImageCompression();
    const state = trackPeak(svc);
    await svc.compressAll(files(), { maxConcurrency: 0 });
    expect(state.peak).toBe(4);
    svc.dispose();
  });

  it('compressAll$ honours options.maxConcurrency too', async () => {
    const svc = new ImageCompression();
    const state = trackPeak(svc);
    const events = [];
    for await (const evt of compressAll$(files(), { maxConcurrency: 1 }, 4, svc)) {
      events.push(evt);
    }
    expect(state.peak).toBe(1);
    const last = events[events.length - 1];
    expect(Array.isArray(last)).toBe(true);
    svc.dispose();
  });
});
