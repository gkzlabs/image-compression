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
 * @param source        Decoded bitmap to re-encode from (caller owns lifecycle,
 *                      this helper does NOT close it).
 * @param sourceW       Source width (pre-ladder dimensions).
 * @param sourceH       Source height.
 * @param format        Target MIME type ('image/jpeg' | 'image/webp' | ...).
 * @param baseQuality   Caller's starting quality (e.g. 0.85); we NEVER raise it.
 * @param targetBytes   Size budget — the ladder tries to fit under this.
 * @param encodeAt      (w, h, quality) => Promise<Blob | null> adapter. The
 *                      caller implements this with its own canvas + encode API
 *                      (OffscreenCanvas.convertToBlob in a Worker,
 *                      HTMLCanvasElement.toBlob on the main thread).
 * @returns The best { blob, width, height } that fits, or the smallest
 *          achievable when the target is unreachable; null only if NO encode
 *          ever produced a blob.
 */
export async function shrinkToTargetSize(
  source: ImageBitmap,
  sourceW: number,
  sourceH: number,
  format: string,
  baseQuality: number,
  targetBytes: number,
  encodeAt: (w: number, h: number, q: number) => Promise<Blob | null>,
): Promise<{ blob: Blob; width: number; height: number } | null> {
  // PNG is lossless — quality is ignored by every encoder. Dimension ladder only.
  const usesBinarySearch = format !== 'image/png';
  const dimLadder = [1, 0.9, 0.8, 0.7, 0.6, 0.5];

  let best: { blob: Blob; width: number; height: number } | null = null;

  for (const dimScale of dimLadder) {
    const w = Math.max(1, Math.round(sourceW * dimScale));
    const h = Math.max(1, Math.round(sourceH * dimScale));

    // PNG: single encode at this dim (quality ignored).
    if (!usesBinarySearch) {
      const blob = await encodeAt(w, h, 0.92);
      if (blob) {
        if (!best || blob.size < best.blob.size) best = { blob, width: w, height: h };
        if (blob.size <= targetBytes) return best;
      }
      continue;
    }

    // Binary search quality in [lo, baseQuality]: find the max q ≤ target.
    // Probe the CALLER's quality first — if it already fits that IS the max
    // usable quality (single-encode best case, like the fixed ladder).
    let lo = Math.min(0.2, baseQuality);
    let hi = baseQuality;
    const highBlob = await encodeAt(w, h, hi);
    if (highBlob && highBlob.size <= targetBytes) {
      return { blob: highBlob, width: w, height: h };
    }

    // Guard: if even q=lo doesn't fit, dims must shrink — record the smallest
    // of this dim then move to the next dim scale.
    const lowBlob = await encodeAt(w, h, lo);
    if (!lowBlob || lowBlob.size > targetBytes) {
      if (lowBlob && (!best || lowBlob.size < best.blob.size)) {
        best = { blob: lowBlob, width: w, height: h };
      }
      continue;
    }

    let dimBest: { blob: Blob; q: number } = { blob: lowBlob, q: lo };
    for (let i = 0; i < 6; i++) {
      const q = Math.round(((lo + hi) / 2) * 100) / 100;
      const blob = await encodeAt(w, h, q);
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
    return { blob: dimBest.blob, width: w, height: h };
  }

  return best;
}