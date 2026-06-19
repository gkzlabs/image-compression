import { calculateTier } from './capabilities';

/**
 * Tests for the pure `calculateTier()` function.
 *
 * This file exists to test the tier calculation logic in isolation from
 * the browser environment. The previous tests in `capabilities.spec.ts`
 * ("downgrades high to mid on low-core device" etc.) were skipped because
 * they tested the heuristic through `detectCapabilities()`, which depends
 * on happy-dom and the real browser API surface. Now that `calculateTier()`
 * is exported, we can test it directly.
 *
 * Tier rules:
 * - `high`: ImageDecoder + OffscreenCanvas + Worker + createImageBitmap all work
 * - `mid`:  OffscreenCanvas + Worker + createImageBitmap (no ImageDecoder)
 * - `low`:  Canvas2D on main thread only (default)
 *
 * Heuristics (only apply to `high` tier):
 * - deviceMemory > 0 AND <= 2 → downgrade to `mid`
 * - hardwareConcurrency <= 2 → downgrade to `mid`
 */
describe('calculateTier()', () => {
  describe('base tier assignment', () => {
    it('returns "high" when all capabilities are present', () => {
      // All 4 capabilities true
      const tier = calculateTier(
        /* hasImageDecoder */ true,
        /* offscreenWorks */ true,
        /* hasWorker */ true,
        /* bitmapWorks */ true,
        /* hardwareConcurrency */ 8,
        /* deviceMemory */ 8,
      );
      expect(tier).toBe('high');
    });

    it('returns "mid" when ImageDecoder is missing (other 3 present)', () => {
      // The webcodecs-worker path is the only one that needs ImageDecoder.
      // Without it, the cascade falls back to offscreen-worker (mid tier).
      const tier = calculateTier(
        /* hasImageDecoder */ false,
        /* offscreenWorks */ true,
        /* hasWorker */ true,
        /* bitmapWorks */ true,
        /* hardwareConcurrency */ 8,
        /* deviceMemory */ 8,
      );
      expect(tier).toBe('mid');
    });

    it('returns "low" when OffscreenCanvas is missing', () => {
      // No OffscreenCanvas → can't use any Worker paths → canvas-main only
      const tier = calculateTier(
        /* hasImageDecoder */ true,
        /* offscreenWorks */ false,
        /* hasWorker */ true,
        /* bitmapWorks */ true,
        /* hardwareConcurrency */ 8,
        /* deviceMemory */ 8,
      );
      expect(tier).toBe('low');
    });

    it('returns "low" when Worker is missing', () => {
      const tier = calculateTier(
        /* hasImageDecoder */ true,
        /* offscreenWorks */ true,
        /* hasWorker */ false,
        /* bitmapWorks */ true,
        /* hardwareConcurrency */ 8,
        /* deviceMemory */ 8,
      );
      expect(tier).toBe('low');
    });

    it('returns "low" when createImageBitmap is missing', () => {
      const tier = calculateTier(
        /* hasImageDecoder */ true,
        /* offscreenWorks */ true,
        /* hasWorker */ true,
        /* bitmapWorks */ false,
        /* hardwareConcurrency */ 8,
        /* deviceMemory */ 8,
      );
      expect(tier).toBe('low');
    });

    it('returns "low" when ALL capabilities are missing', () => {
      const tier = calculateTier(false, false, false, false, 8, 8);
      expect(tier).toBe('low');
    });
  });

  describe('heuristic: low-memory override (high → mid)', () => {
    it('downgrades high to mid when deviceMemory is 1 GB', () => {
      const tier = calculateTier(
        /* hasImageDecoder */ true,
        /* offscreenWorks */ true,
        /* hasWorker */ true,
        /* bitmapWorks */ true,
        /* hardwareConcurrency */ 8,
        /* deviceMemory */ 1,
      );
      expect(tier).toBe('mid');
    });

    it('downgrades high to mid when deviceMemory is exactly 2 GB', () => {
      const tier = calculateTier(true, true, true, true, 8, 2);
      expect(tier).toBe('mid');
    });

    it('does NOT downgrade when deviceMemory is 3 GB (above threshold)', () => {
      const tier = calculateTier(true, true, true, true, 8, 3);
      expect(tier).toBe('high');
    });

    it('does NOT apply the override when deviceMemory is 0 (unknown)', () => {
      // deviceMemory = 0 means "not reported" (e.g. Safari, Firefox).
      // The guard `deviceMemory > 0` prevents the override from firing
      // in that case — important for browsers that don't expose deviceMemory.
      const tier = calculateTier(true, true, true, true, 8, 0);
      expect(tier).toBe('high');
    });

    it('does NOT apply the override when tier is already "mid"', () => {
      // The heuristic only fires for tier='high' (see code).
      // If tier='mid' (e.g. no ImageDecoder), the override is a no-op.
      const tier = calculateTier(false, true, true, true, 8, 1);
      expect(tier).toBe('mid');
    });

    it('does NOT apply the override when tier is already "low"', () => {
      const tier = calculateTier(false, false, true, true, 8, 1);
      expect(tier).toBe('low');
    });
  });

  describe('heuristic: low-core override (high → mid)', () => {
    it('downgrades high to mid when hardwareConcurrency is 1', () => {
      const tier = calculateTier(true, true, true, true, 1, 8);
      expect(tier).toBe('mid');
    });

    it('downgrades high to mid when hardwareConcurrency is 2', () => {
      const tier = calculateTier(true, true, true, true, 2, 8);
      expect(tier).toBe('mid');
    });

    it('does NOT downgrade when hardwareConcurrency is 3', () => {
      const tier = calculateTier(true, true, true, true, 3, 8);
      expect(tier).toBe('high');
    });

    it('does NOT downgrade when hardwareConcurrency is 8', () => {
      const tier = calculateTier(true, true, true, true, 8, 8);
      expect(tier).toBe('high');
    });
  });

  describe('heuristic: combined overrides', () => {
    it('low memory AND low core: both overrides apply (mid)', () => {
      const tier = calculateTier(true, true, true, true, 1, 1);
      expect(tier).toBe('mid');
    });

    it('low memory but high core: still mid (memory override fires)', () => {
      const tier = calculateTier(true, true, true, true, 8, 1);
      expect(tier).toBe('mid');
    });

    it('low core but high memory: still mid (core override fires)', () => {
      const tier = calculateTier(true, true, true, true, 1, 8);
      expect(tier).toBe('mid');
    });
  });
});
