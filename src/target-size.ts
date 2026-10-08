/**
 * Canvas-agnostic target-size ladder (binary-search quality + dimension
 * ladder).
 *
 * DEFINITION OBJECTIVE: this helper contains ZERO canvas/API usage — it only
 * orchestrates the re-encode iterations and delegates the actual draw+encode
 * to an `encodeAt` callback the CALLER supplies. That lets the same ladder
 * logic run in two very different contexts:
 *
 *   - Web Worker:   caller uses OffscreenCanvas + convertToBlob (no DOM).
 *   - Main thread / no-Worker devices: caller uses HTMLCanvasElement + toBlob.
 *
 * This is the "works on every device" guarantee: the ladder math is shared and
 * tested once; only the canvas adapter differs. If a device has no Worker it
 * falls back to the main-thread adapter exactly as before — never a hard
 * failure for old/limited devices.
 *
 * v1.4.0 adds a STRICT mode (`TargetSizeLadderOptions.strict`). The default
 * ladder gives up at quality 0.2 / 50% dimensions, which can leave the output
 * above the budget on very noisy input. Strict mode keeps going — quality down
 * to `minQuality`, dimensions down to `minDimension` px on the longest edge —
 * until the budget is actually met, under a hard bound on encode probes.
 * Non-strict runs probe the exact same (width, height, quality) sequence as
 * v1.3.x, so default behaviour is unchanged.
 *
 * @param source        Decoded bitmap to re-encode from (caller owns lifecycle,
 *                      this helper does NOT close it, and does not read it —
 *                      the `encodeAt` adapter closes over it).
 * @param sourceW       Source width (pre-ladder dimensions).
 * @param sourceH       Source height.
 * @param format        Target MIME type ('image/jpeg' | 'image/webp' | ...).
 * @param baseQuality   Caller's starting quality (e.g. 0.85); we NEVER raise it.
 * @param targetBytes   Size budget — the ladder tries to fit under this.
 * @param encodeAt      (w, h, quality) => Promise<Blob | null> adapter. The
 *                      caller implements this with its own canvas + encode API
 *                      (OffscreenCanvas.convertToBlob in a Worker,
 *                      HTMLCanvasElement.toBlob on the main thread).
 * @param opts          v1.4.0 ladder options (strict-mode floors). Omit for the
 *                      historical behaviour.
 * @returns The best `{ blob, width, height, quality, scale, met }` that fits,
 *          or the smallest achievable when the target is unreachable; null only
 *          if NO encode ever produced a blob.
 */

/** Quality floor of the default (non-strict) ladder. */
export const DEFAULT_TARGET_MIN_QUALITY = 0.2;
/** Quality floor of the strict ladder (used when `minQuality` is not given). */
export const STRICT_TARGET_MIN_QUALITY = 0.05;
/** Dimension floor (px, longest edge) of the strict ladder. */
export const DEFAULT_TARGET_MIN_DIMENSION = 64;
/**
 * Hard cap on `encodeAt` calls in strict mode. The default ladder is uncapped —
 * its probe sequence must stay identical to v1.3.x — while strict mode can walk
 * many more dimension steps, so it carries a bound instead of trusting the
 * floors alone.
 */
export const STRICT_MAX_LADDER_PROBES = 64;

/** Dimension scales of the default ladder (50% floor). */
const DEFAULT_DIM_LADDER = [1, 0.9, 0.8, 0.7, 0.6, 0.5];
/** Multiplier per extra dimension step in strict mode. */
const STRICT_DIM_STEP = 0.85;
/** Upper bound on strict dimension steps (keeps the ladder array sane). */
const MAX_STRICT_DIM_STEPS = 16;

export interface TargetSizeLadderOptions {
  /**
   * v1.4.0: keep shrinking past the default floors until the byte budget is
   * met — quality down to `minQuality`, dimensions down to `minDimension` px.
   * Default: false (identical to the pre-1.4.0 ladder).
   */
  strict?: boolean;
  /**
   * Lowest quality the binary search may probe. Default: 0.2, or 0.05 when
   * `strict` is set. Clamped to `baseQuality` (the ladder never raises quality)
   * and to a minimum of 0.01.
   */
  minQuality?: number;
  /**
   * Strict mode's dimension floor in px (longest edge). Default: 64.
   * Ignored unless `strict` is set. Clamped to a minimum of 8.
   */
  minDimension?: number;
}

export interface TargetSizeLadderResult {
  blob: Blob;
  width: number;
  height: number;
  /**
   * Quality of the returned encode. `undefined` for PNG (lossless — every
   * encoder ignores quality) and for ladder steps that produce no blob.
   */
  quality?: number;
  /** Dimension scale actually used (1 = original dimensions). */
  scale: number;
  /** True when `blob.size <= targetBytes`. */
  met: boolean;
}

function clampQuality(value: number, baseQuality: number): number {
  if (!Number.isFinite(value)) return Math.min(DEFAULT_TARGET_MIN_QUALITY, baseQuality);
  return Math.max(0.01, Math.min(value, baseQuality));
}

/**
 * Dimension ladder for this run. Non-strict returns the historical fixed
 * ladder; strict appends geometric steps until the longest edge reaches
 * `minDimension`, then pins a final step exactly on that floor.
 */
function dimLadderFor(
  sourceW: number,
  sourceH: number,
  strict: boolean,
  minDimension: number,
): number[] {
  const scales = [...DEFAULT_DIM_LADDER];
  if (!strict) return scales;

  const longest = Math.max(sourceW, sourceH);
  if (!Number.isFinite(longest) || longest <= 0) return scales;
  const floor = Math.max(8, minDimension);

  let scale = scales[scales.length - 1];
  for (let i = 0; i < MAX_STRICT_DIM_STEPS; i++) {
    scale *= STRICT_DIM_STEP;
    if (Math.max(1, Math.round(longest * scale)) < floor) break;
    scales.push(Math.round(scale * 1000) / 1000);
  }
  // Pin the last step on the documented floor: the geometric walk rarely lands
  // exactly on it, and strict mode should always get the chance to reach its
  // own floor before giving up.
  if (Math.max(1, Math.round(longest * scales[scales.length - 1])) > floor) {
    scales.push(Math.round((floor / longest) * 1000) / 1000);
  }
  return scales;
}

export async function shrinkToTargetSize(
  source: ImageBitmap,
  sourceW: number,
  sourceH: number,
  format: string,
  baseQuality: number,
  targetBytes: number,
  encodeAt: (w: number, h: number, q: number) => Promise<Blob | null>,
  opts: TargetSizeLadderOptions = {},
): Promise<TargetSizeLadderResult | null> {
  // PNG is lossless — quality is ignored by every encoder. Dimension ladder only.
  const usesBinarySearch = format !== 'image/png';
  const strict = opts.strict === true;
  const dimLadder = dimLadderFor(
    sourceW,
    sourceH,
    strict,
    opts.minDimension ?? DEFAULT_TARGET_MIN_DIMENSION,
  );
  const floor = clampQuality(
    opts.minQuality ?? (strict ? STRICT_TARGET_MIN_QUALITY : DEFAULT_TARGET_MIN_QUALITY),
    baseQuality,
  );

  let probes = 0;
  const budget = strict ? STRICT_MAX_LADDER_PROBES : Number.POSITIVE_INFINITY;
  /** Probe wrapper — enforces the strict-mode encode budget. */
  const run = async (w: number, h: number, q: number): Promise<Blob | null> => {
    if (probes >= budget) return null;
    probes++;
    return encodeAt(w, h, q);
  };

  const scaleOf = (w: number) => Math.round((w / sourceW) * 1000) / 1000;
  let best: TargetSizeLadderResult | null = null;
  /** Record a candidate as "smallest so far" (never a bigger blob than best). */
  const consider = (blob: Blob | null, w: number, h: number, quality?: number): void => {
    if (!blob || (best && blob.size >= best.blob.size)) return;
    best = {
      blob,
      width: w,
      height: h,
      quality,
      scale: scaleOf(w),
      met: blob.size <= targetBytes,
    };
  };

  for (const dimScale of dimLadder) {
    const w = Math.max(1, Math.round(sourceW * dimScale));
    const h = Math.max(1, Math.round(sourceH * dimScale));

    // PNG: single encode at this dim (quality ignored).
    if (!usesBinarySearch) {
      const blob = await run(w, h, 0.92);
      if (blob) {
        consider(blob, w, h);
        if (blob.size <= targetBytes) return best;
      }
      continue;
    }

    // Binary search quality in [lo, baseQuality]: find the max q ≤ target.
    // Probe the CALLER's quality first — if it already fits that IS the max
    // usable quality (single-encode best case, like the fixed ladder).
    let lo = floor;
    let hi = baseQuality;
    const highBlob = await run(w, h, hi);
    if (highBlob && highBlob.size <= targetBytes) {
      return { blob: highBlob, width: w, height: h, quality: hi, scale: scaleOf(w), met: true };
    }

    // Guard: if even q=lo doesn't fit, dims must shrink — record the smallest
    // of this dim then move to the next dim scale.
    const lowBlob = await run(w, h, lo);
    if (!lowBlob || lowBlob.size > targetBytes) {
      consider(lowBlob, w, h, lo);
      continue;
    }

    let dimBest: { blob: Blob; q: number } = { blob: lowBlob, q: lo };
    for (let i = 0; i < 6; i++) {
      const q = Math.round(((lo + hi) / 2) * 100) / 100;
      const blob = await run(w, h, q);
      if (!blob) break;
      if (blob.size <= targetBytes) {
        dimBest = { blob, q }; // fits — try higher quality
        lo = q + 0.01;
      } else {
        hi = q - 0.01; // too big — try lower
      }
      if (lo > hi) break;
    }
    // This dim produced something that fits → return the highest quality fit
    // (the size ladder only steps down if NO quality fits at this dim).
    return {
      blob: dimBest.blob,
      width: w,
      height: h,
      quality: dimBest.q,
      scale: scaleOf(w),
      met: true,
    };
  }

  return best;
}
