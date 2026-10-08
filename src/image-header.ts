/**
 * Dependency-free image header reader (v1.5.0).
 *
 * Why this exists: a 4 KB PNG can *declare* 100 000 × 100 000 pixels. Decoding
 * that ("decompression bomb") allocates tens of GB and takes the tab down before
 * any compression option can help. The only way to know the dimensions without
 * paying for the decode is the file header — this module reads just that.
 *
 * Callers feed it the first ~64 KB of the file (`maxPixels` in `service.ts`),
 * so it must never walk far into the buffer and must never throw.
 *
 * Supported containers: PNG, JPEG, GIF, WebP (VP8 / VP8L / VP8X). Anything else
 * (AVIF/HEIC/ISOBMFF, BMP, TIFF, raw, …) returns `null` and the caller decides —
 * unknown containers cannot be asserted pre-decode.
 */

export interface ImageDimensions {
  /** Container the dimensions were read from. */
  type: 'png' | 'jpeg' | 'gif' | 'webp';
  width: number;
  height: number;
}

function u16be(b: Uint8Array, i: number): number {
  return (b[i] << 8) | b[i + 1];
}

function u16le(b: Uint8Array, i: number): number {
  return b[i] | (b[i + 1] << 8);
}

function u24le(b: Uint8Array, i: number): number {
  return b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
}

function u32be(b: Uint8Array, i: number): number {
  return ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
}

function dims(type: ImageDimensions['type'], width: number, height: number): ImageDimensions | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  return { type, width, height };
}

/**
 * Read the pixel dimensions declared by an image header.
 *
 * @param bytes First bytes of the file (≥ 30 bytes covers every supported container).
 * @returns `{ type, width, height }`, or `null` when the container is not
 *   recognised or the header is truncated.
 */
export function readImageDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (bytes.length < 10) return null;

  // PNG — signature + IHDR (width/height big-endian at 16/20)
  if (
    bytes.length >= 24 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return dims('png', u32be(bytes, 16), u32be(bytes, 20));
  }

  // GIF — "GIF87a"/"GIF89a" + logical screen descriptor (little-endian)
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    return dims('gif', u16le(bytes, 6), u16le(bytes, 8));
  }

  // WebP — RIFF container, chunk fourcc at 12
  if (
    bytes.length >= 30 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    const fourcc = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);
    const d = 20; // chunk payload starts after fourcc(4) + chunk size(4)
    if (fourcc === 'VP8X') {
      // extended: 24-bit canvas width-1 / height-1
      return dims('webp', 1 + u24le(bytes, d + 4), 1 + u24le(bytes, d + 7));
    }
    if (fourcc === 'VP8L') {
      // lossless: signature byte 0x2f then two 14-bit values (width, height-1)
      const bits = (bytes[d + 1] | (bytes[d + 2] << 8) | (bytes[d + 3] << 16) | (bytes[d + 4] << 24)) >>> 0;
      return dims('webp', (bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
    }
    if (fourcc === 'VP8 ') {
      // lossy: frame tag(3) + start code 0x9d 0x01 0x2a, then 14-bit dims
      if (bytes[d + 3] === 0x9d && bytes[d + 4] === 0x01 && bytes[d + 5] === 0x2a) {
        return dims('webp', u16le(bytes, d + 6) & 0x3fff, u16le(bytes, d + 8) & 0x3fff);
      }
    }
    return null;
  }

  // JPEG — SOI then a segment walk to the first SOFn (frame header) marker
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = bytes[i + 1];
      // Standalone markers carry no length: TEM (0x01) and RSTn (0xd0-0xd7)
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        i += 2;
        continue;
      }
      if (marker === 0xd8 || marker === 0x00) {
        i += 2;
        continue;
      }
      const len = u16be(bytes, i + 2);
      if (len < 2) return null;
      // SOF0-SOF15 except DHT (0xc4), JPG (0xc8), DAC (0xcc)
      const isFrameHeader =
        marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isFrameHeader) {
        // precision(1) at +4, height at +5, width at +7
        return dims('jpeg', u16be(bytes, i + 7), u16be(bytes, i + 5));
      }
      if (marker === 0xda) break; // start of scan without a frame header
      i += 2 + len;
    }
    return null;
  }

  return null;
}
