import type { DeviceCapabilities, DeviceTier } from './types';

/**
 * Detect device capabilities with 3 layers of safety:
 * 1. Static checks (typeof, in window) — fast, can have false positives
 * 2. Runtime validation (try actual operation) — authoritative
 * 3. Heuristics (hardware info) — for tier calculation
 *
 * Safe to call in browser context only.
 * Throws nothing — returns a fully-populated capabilities object.
 */
export async function detectCapabilities(): Promise<DeviceCapabilities> {
  const nav = navigator;

  // Layer 1: Static feature detection
  const hasWorker = typeof Worker !== 'undefined';
  const hasOffscreenCanvas = typeof OffscreenCanvas !== 'undefined';
  const hasCreateImageBitmap = typeof createImageBitmap !== 'undefined';
  const hasImageDecoder = typeof ImageDecoder !== 'undefined';
  // Note: VideoEncoder is detected (for future use) but NOT required for
  // any current path — this library uses Canvas `convertToBlob` (HW-accelerated
  // in modern browsers) for JPEG/WebP encoding, not VideoEncoder.
  // Requiring VideoEncoder would falsely downgrade browsers to 'mid' tier.
  const hasVideoEncoder = typeof VideoEncoder !== 'undefined';
  const hasWebCodecs = hasImageDecoder; // What we actually use from WebCodecs
  const hasCanvas2D = hasOffscreenCanvas || typeof HTMLCanvasElement !== 'undefined';

  // Layer 2: Runtime validation
  // Just having the API doesn't mean it works (iOS Private mode, Firefox about:config, etc.)
  let offscreenWorks = false;
  if (hasOffscreenCanvas) {
    try {
      const canvas = new OffscreenCanvas(1, 1);
      const ctx = canvas.getContext('2d');
      offscreenWorks = ctx !== null;
    } catch {
      offscreenWorks = false;
    }
  }

  let bitmapWorks = false;
  if (hasCreateImageBitmap) {
    try {
      // Try decoding a valid 1x1 transparent PNG (well-formed, base64-verified)
      const tinyPng = new Blob(
        [
          new Uint8Array([
            0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00,
            0x0d, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00,
            0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89,
            0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0xda, 0x63,
            0x64, 0x60, 0xf8, 0x5f, 0x0f, 0x00, 0x02, 0x87, 0x01, 0x80, 0xeb,
            0x47, 0xba, 0x92, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44,
            0xae, 0x42, 0x60, 0x82,
          ]),
        ],
        { type: 'image/png' },
      );
      const bm = await createImageBitmap(tinyPng);
      bm.close();
      bitmapWorks = true;
    } catch {
      bitmapWorks = false;
    }
  }

  let supportsHEIC = false;
  if (hasImageDecoder) {
    try {
      supportsHEIC = await ImageDecoder.isTypeSupported('image/heic');
    } catch {
      supportsHEIC = false;
    }
  }

  // Browser quirks detection
  const ua = navigator.userAgent;
  const isSafari = /^((?!chrome|android).)*safari/i.test(ua);
  const isIOS =
    /iPad|iPhone|iPod/.test(ua) ||
    (ua.includes('Mac') && 'ontouchend' in document);

  // Hardware / network info
  const hardwareConcurrency = nav.hardwareConcurrency || 2;
  const deviceMemory = nav.deviceMemory || 0;
  const saveData = Boolean(nav.connection?.saveData);
  const effectiveType = nav.connection?.effectiveType || '4g';

  // Layer 3: Tier calculation
  // High: ImageDecoder (for HEIC) + OffscreenCanvas + Worker + createImageBitmap all working
  // Mid:  OffscreenCanvas + Worker + createImageBitmap (no ImageDecoder)
  // Low:  Canvas2D on main thread only
  //
  // VideoEncoder is NOT required — we use Canvas convertToBlob for encoding.
  // (VideoEncoder is for video codecs VP8/VP9/AV1, not still images.)
  let tier: DeviceTier = 'low';
  if (hasImageDecoder && offscreenWorks && hasWorker && bitmapWorks) {
    tier = 'high';
  } else if (offscreenWorks && hasWorker && bitmapWorks) {
    tier = 'mid';
  }

  // Heuristics override: low-spec devices skip high tier
  if (tier === 'high') {
    if (deviceMemory > 0 && deviceMemory <= 2) tier = 'mid';
    if (hardwareConcurrency <= 2) tier = 'mid';
  }

  return {
    // hasWebCodecs is kept for backward compat — now means "has ImageDecoder".
    // VideoEncoder is no longer required (we use Canvas convertToBlob for encoding).
    hasWebCodecs: hasImageDecoder && offscreenWorks && bitmapWorks,
    hasImageDecoder,
    hasVideoEncoder,
    hasOffscreenCanvas: offscreenWorks,
    hasWorker,
    hasCreateImageBitmap: bitmapWorks,
    hasCanvas2D,
    supportsHEIC,
    hardwareConcurrency,
    deviceMemory,
    saveData,
    effectiveType,
    isSafari,
    isIOS,
    tier,
  };
}
