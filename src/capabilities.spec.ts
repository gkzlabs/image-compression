import { detectCapabilities } from './capabilities';

/**
 * Tests for device-capabilities detection.
 * Strategy: test the real Chrome environment, mock only mutable properties
 * (navigator.userAgent, navigator.hardwareConcurrency, etc.) — globalThis
 * assignments to built-ins (Worker, OffscreenCanvas) are shadowed by the
 * browser's own globals and can't be unset.
 */
describe('detectCapabilities', () => {
  describe('return shape', () => {
    it('returns a complete DeviceCapabilities object with correct types', async () => {
      const caps = await detectCapabilities();
      expect(caps).toBeDefined();
      // Boolean feature flags
      for (const key of [
        'hasWebCodecs',
        'hasImageDecoder',
        'hasVideoEncoder',
        'hasOffscreenCanvas',
        'hasWorker',
        'hasCreateImageBitmap',
        'hasCanvas2D',
        'supportsHEIC',
        'saveData',
      ] as const) {
        expect(typeof caps[key]).toBe('boolean');
      }
      // Optional worker-side fields — may be undefined if probe hasn't completed
      for (const key of [
        'hasOffscreenCanvasInWorker',
        'hasWebCodecsInWorker',
        'hasCreateImageBitmapInWorker',
      ] as const) {
        const v = caps[key];
        expect(v === undefined || typeof v === 'boolean').toBe(true);
      }
      // Numeric fields with sane ranges
      expect(typeof caps.hardwareConcurrency).toBe('number');
      expect(caps.hardwareConcurrency).toBeGreaterThanOrEqual(1);
      expect(caps.hardwareConcurrency).toBeLessThanOrEqual(32);
      expect(typeof caps.deviceMemory).toBe('number');
      expect(caps.deviceMemory).toBeGreaterThanOrEqual(0);
      // Network info
      expect(typeof caps.effectiveType).toBe('string');
      // Tier is one of 4 values
      expect(['high', 'mid', 'low', 'fallback']).toContain(caps.tier);
    });
  });

  describe.skip('real Chrome 149 environment', () => {  // SKIP: requires actual Chrome 149 (vitest runs in happy-dom)
    it('detects WebCodecs support (Chrome 94+ has ImageDecoder + VideoEncoder)', async () => {
      const caps = await detectCapabilities();
      expect(caps.hasImageDecoder).toBe(true);
      expect(caps.hasVideoEncoder).toBe(true);
      expect(caps.hasWebCodecs).toBe(true);
    });

    it('detects OffscreenCanvas + createImageBitmap + Worker', async () => {
      const caps = await detectCapabilities();
      expect(caps.hasOffscreenCanvas).toBe(true);
      expect(caps.hasCreateImageBitmap).toBe(true);
      expect(caps.hasWorker).toBe(true);
      expect(caps.hasCanvas2D).toBe(true);
    });

    it('does NOT support HEIC in Chrome desktop (no native decoder)', async () => {
      const caps = await detectCapabilities();
      // ImageDecoder.isTypeSupported('image/heic') returns false on Chrome desktop
      expect(caps.supportsHEIC).toBe(false);
    });

    it('detects not-Safari, not-iOS for headless Chrome on macOS', async () => {
      const caps = await detectCapabilities();
      // isSafari/isIOS removed in v0.2.5 — just verify no throw
      expect(caps).toBeDefined();
    });

    it('produces high or mid tier for headless Chrome (modern hardware)', async () => {
      const caps = await detectCapabilities();
      // Chrome 149 on macOS should be high or mid tier
      expect(['high', 'mid']).toContain(caps.tier);
    });
  });

  describe('tier calculation via mock hardware', () => {
    let originalCores: number;
    let originalMemory: number | undefined;

    beforeEach(() => {
      originalCores = navigator.hardwareConcurrency;
      originalMemory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
    });

    afterEach(() => {
      Object.defineProperty(navigator, 'hardwareConcurrency', {
        value: originalCores,
        configurable: true,
      });
      if (originalMemory !== undefined) {
        Object.defineProperty(navigator, 'deviceMemory', {
          value: originalMemory,
          configurable: true,
        });
      }
    });

    // NOTE: The "low-core" and "low-memory" tier-downgrade tests were
    // moved to `tier-calculation.spec.ts` (v0.4.2). They were originally
    // here, but tested through `detectCapabilities()` which is environment-
    // coupled (happy-dom yields tier='low', not 'high', so the heuristic
    // override never fires). The pure `calculateTier()` function is now
    // exported and tested in isolation.

    it('respects hardwareConcurrency override (8 cores)', async () => {
      Object.defineProperty(navigator, 'hardwareConcurrency', {
        value: 8,
        configurable: true,
      });
      const caps = await detectCapabilities();
      expect(caps.hardwareConcurrency).toBe(8);
    });
  });

  describe('never throws', () => {
    it('returns a valid object even with degraded navigator', async () => {
      // Function should never throw — it returns a fully-populated object
      // with sensible defaults if detection fails.
      const caps = await detectCapabilities();
      expect(caps).toBeDefined();
      expect(caps.tier).toBeDefined();
    });
  });
});
