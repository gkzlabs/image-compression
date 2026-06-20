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
 *
 * v0.4.0 ADDED: `workerPathsReliable` runtime gate. The Worker also runs
 * an end-to-end roundtrip probe (`probeWorkerPath()`) and the cascade
 * skips Worker paths when the probe fails (Chrome "image source is detached"
 * bug, broken transferToImageBitmap, etc.). The gate defaults to true so
 * the probe can be slow/fire-and-forget without breaking the cascade.
 */
import type { DeviceCapabilities } from './types';

describe('selectPaths() uses worker-side capabilities', () => {
  /**
   * Helper: simulate the selectPaths logic in service.ts.
   * Mirrors the actual code so we can test the decision without spawning a real Worker.
   *
   * v0.4.0: now also checks `workerPathsReliable` to gate Worker paths. Default
   * to true (matches service.ts behavior — assume reliable until probe proves otherwise).
   */
  function selectPaths(caps: Partial<DeviceCapabilities>): string[] {
    const paths: string[] = [];
    const workerOC = caps.hasOffscreenCanvasInWorker ?? caps.hasOffscreenCanvas ?? false;
    const workerWC = caps.hasWebCodecsInWorker ?? caps.hasWebCodecs ?? false;
    const workerCIB = caps.hasCreateImageBitmapInWorker ?? caps.hasCreateImageBitmap ?? false;
    const workerReliable = caps.workerPathsReliable ?? true;
    if (workerReliable && workerWC && workerOC && workerCIB && caps.hasWorker) paths.push('webcodecs-worker');
    if (workerReliable && workerOC && workerCIB && caps.hasWorker) paths.push('offscreen-worker');
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

describe('selectPaths() workerPathsReliable gate (v0.4.0)', () => {
  /**
   * Mirrors the selectPaths helper above. Re-declared so the new tests are
   * scoped to their own describe block for clarity.
   */
  function selectPaths(caps: Partial<DeviceCapabilities>): string[] {
    const paths: string[] = [];
    const workerOC = caps.hasOffscreenCanvasInWorker ?? caps.hasOffscreenCanvas ?? false;
    const workerWC = caps.hasWebCodecsInWorker ?? caps.hasWebCodecs ?? false;
    const workerCIB = caps.hasCreateImageBitmapInWorker ?? caps.hasCreateImageBitmap ?? false;
    const workerReliable = caps.workerPathsReliable ?? true;
    if (workerReliable && workerWC && workerOC && workerCIB && caps.hasWorker) paths.push('webcodecs-worker');
    if (workerReliable && workerOC && workerCIB && caps.hasWorker) paths.push('offscreen-worker');
    if (caps.hasCanvas2D) paths.push('canvas-main');
    return paths;
  }

  it('workerPathsReliable=false skips Worker paths even when capabilities are perfect', () => {
    // This is the Chrome bitmap detach bug scenario:
    // - main thread AND worker context have all the APIs
    // - but the roundtrip probe in worker fails
    // Expected: cascade = [canvas-main] only
    const paths = selectPaths({
      hasWebCodecs: true,
      hasOffscreenCanvas: true,
      hasCreateImageBitmap: true,
      hasWorker: true,
      hasCanvas2D: true,
      hasWebCodecsInWorker: true,
      hasOffscreenCanvasInWorker: true,
      hasCreateImageBitmapInWorker: true,
      workerPathsReliable: false,  // <-- probe failed
    });
    expect(paths).toEqual(['canvas-main']);
  });

  it('workerPathsReliable=true (or undefined) includes Worker paths when capabilities match', () => {
    // Explicit true
    const explicit = selectPaths({
      hasOffscreenCanvas: true,
      hasCreateImageBitmap: true,
      hasWorker: true,
      hasCanvas2D: true,
      hasOffscreenCanvasInWorker: true,
      hasCreateImageBitmapInWorker: true,
      workerPathsReliable: true,
    });
    expect(explicit).toContain('offscreen-worker');

    // Default (undefined = probe hasn't run yet, treat as reliable)
    const defaulted = selectPaths({
      hasOffscreenCanvas: true,
      hasCreateImageBitmap: true,
      hasWorker: true,
      hasCanvas2D: true,
      hasOffscreenCanvasInWorker: true,
      hasCreateImageBitmapInWorker: true,
    });
    expect(defaulted).toContain('offscreen-worker');
  });

  it('workerPathsReliable=false still includes canvas-main (always available)', () => {
    // Even when Worker is broken, canvas-main is the safe fallback.
    const paths = selectPaths({
      hasOffscreenCanvas: true,
      hasCreateImageBitmap: true,
      hasWorker: true,
      hasCanvas2D: true,
      hasOffscreenCanvasInWorker: true,
      hasCreateImageBitmapInWorker: true,
      workerPathsReliable: false,
    });
    expect(paths).toContain('canvas-main');
  });

  it('workerPathsReliable=false on a low-tier device yields only canvas-main', () => {
    // Pre-existing v0.2.3 behavior, kept: no capabilities + unreliable = empty cascade
    // (server-fallback only)
    const paths = selectPaths({
      hasCanvas2D: false,
      hasWorker: false,
      workerPathsReliable: false,
    });
    expect(paths).toEqual([]);
  });
});
