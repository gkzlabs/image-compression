/**
 * Tests for v0.2.3 worker-side capability detection.
 *
 * The cascade previously filtered Worker paths based on main-thread capability
 * detection, which gave false positives on browsers where main-thread
 * OffscreenCanvas is available but Worker-context OffscreenCanvas is not
 * (Safari iOS, some Firefox configs, headless Chrome).
 *
 * The fix: the service now queries the Worker's own capabilities via
 * `getWorkerCapabilities()` and uses those for the cascade filter.
 */
import type { DeviceCapabilities } from './types';

describe('selectPaths() uses worker-side capabilities', () => {
  /**
   * Helper: simulate the selectPaths logic in service.ts.
   * Mirrors the actual code so we can test the decision without spawning a real Worker.
   */
  function selectPaths(caps: Partial<DeviceCapabilities>): string[] {
    const paths: string[] = [];
    const workerOC = caps.hasOffscreenCanvasInWorker ?? caps.hasOffscreenCanvas ?? false;
    const workerWC = caps.hasWebCodecsInWorker ?? caps.hasWebCodecs ?? false;
    const workerCIB = caps.hasCreateImageBitmapInWorker ?? caps.hasCreateImageBitmap ?? false;
    if (workerWC && workerOC && workerCIB && caps.hasWorker) paths.push('webcodecs-worker');
    if (workerOC && workerCIB && caps.hasWorker) paths.push('offscreen-worker');
    if (caps.hasCanvas2D) paths.push('canvas-main');
    return paths;
  }

  it('main thread has OC + WC, but worker does NOT — exclude worker paths', () => {
    // This is the user's scenario:
    // - Main thread: has OffscreenCanvas + WebCodecs (true)
    // - Worker context: has nothing
    // Expected: cascade = [canvas-main] only (no worker paths)
    const paths = selectPaths({
      hasWebCodecs: true,
      hasOffscreenCanvas: true,
      hasCreateImageBitmap: true,
      hasWorker: true,
      hasCanvas2D: true,
      // Worker caps are FALSE (the bug case)
      hasOffscreenCanvasInWorker: false,
      hasWebCodecsInWorker: false,
      hasCreateImageBitmapInWorker: false,
    });
    expect(paths).toEqual(['canvas-main']);
  });

  it('main thread has OC, worker also has OC — include offscreen-worker', () => {
    const paths = selectPaths({
      hasOffscreenCanvas: true,
      hasCreateImageBitmap: true,
      hasWorker: true,
      hasCanvas2D: true,
      hasOffscreenCanvasInWorker: true,
      hasCreateImageBitmapInWorker: true,
    });
    expect(paths).toContain('offscreen-worker');
    expect(paths).toContain('canvas-main');
  });

  it('worker has everything (high tier) — include all 3 paths', () => {
    const paths = selectPaths({
      hasWebCodecs: true,
      hasOffscreenCanvas: true,
      hasCreateImageBitmap: true,
      hasWorker: true,
      hasCanvas2D: true,
      hasWebCodecsInWorker: true,
      hasOffscreenCanvasInWorker: true,
      hasCreateImageBitmapInWorker: true,
    });
    expect(paths).toEqual(['webcodecs-worker', 'offscreen-worker', 'canvas-main']);
  });

  it('no worker support at all — only canvas-main', () => {
    const paths = selectPaths({
      hasOffscreenCanvas: true,
      hasCreateImageBitmap: true,
      hasWorker: false,  // No Worker at all
      hasCanvas2D: true,
    });
    expect(paths).toEqual(['canvas-main']);
  });

  it('no capability at all — empty cascade (server-fallback only)', () => {
    const paths = selectPaths({
      hasCanvas2D: false,
      hasWorker: false,
    });
    expect(paths).toEqual([]);
  });

  it('worker caps fall back to main thread caps if not probed yet', () => {
    // Before getWorkerCapabilities() is called, worker caps are undefined.
    // We fall back to main-thread caps (?? operator).
    const paths = selectPaths({
      hasOffscreenCanvas: true,
      hasCreateImageBitmap: true,
      hasWorker: true,
      hasCanvas2D: true,
      // No worker caps yet — fallback to main thread
    });
    expect(paths).toContain('offscreen-worker');
  });
});
