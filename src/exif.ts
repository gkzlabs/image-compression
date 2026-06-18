/**
 * Minimal EXIF reader — extracts only the Orientation tag (0x0112).
 *
 * Why only orientation?
 * - Full EXIF parsing requires reading 100+ tags + IFD chains (~50KB code)
 * - We only need orientation to fix the "portrait photo appears sideways" bug
 * - Browsers that re-encode via Canvas strip ALL EXIF (including orientation);
 *   we read the original orientation and apply the rotation on Canvas before
 *   encoding, so the output is correctly rotated.
 *
 * EXIF structure (JPEG):
 * - File starts with FFD8 (SOI marker)
 * - App1 marker: FFE1 + 2 bytes length + 'Exif\0\0' + TIFF header + IFD0
 * - TIFF header: 'II' or 'MM' + 0x002A + offset to IFD0
 * - IFD0: 2 bytes count + entries
 * - Each entry: 2 bytes tag + 2 bytes type + 4 bytes count + 4 bytes value/offset
 * - Orientation tag: 0x0112
 *
 * Returns 1 (default, no rotation) if:
 * - Not a JPEG
 * - No EXIF marker
 * - Orientation tag not found
 * - File too small to parse safely
 */
export type ExifOrientation = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

/**
 * Read the EXIF orientation from a JPEG file (1-8). Returns 1 if not found.
 *
 * Orientation values (per EXIF spec):
 *   1 = Horizontal (normal)
 *   2 = Mirror horizontal
 *   3 = Rotate 180°
 *   4 = Mirror vertical
 *   5 = Mirror horizontal + rotate 270° CW
 *   6 = Rotate 90° CW
 *   7 = Mirror horizontal + rotate 90° CW
 *   8 = Rotate 270° CW (90° CCW)
 */
export async function readExifOrientation(
  file: File | Blob,
): Promise<ExifOrientation> {
  // Quick checks
  if (file.size < 14) return 1;
  if (file.type && file.type !== 'image/jpeg' && file.type !== 'image/jpg') {
    return 1;
  }

  // Read first 64KB — EXIF is always near the start of a JPEG
  const sliceSize = Math.min(file.size, 65_536);
  const slice = file.slice(0, sliceSize);
  const buffer = await slice.arrayBuffer();
  const view = new DataView(buffer);

  // Check JPEG SOI (FFD8)
  if (view.getUint16(0) !== 0xffd8) return 1;

  // Walk through markers until we find APP1 (FFE1) or run out
  let offset = 2;
  while (offset < view.byteLength - 4) {
    // Find next marker
    if (view.getUint8(offset) !== 0xff) return 1;
    const marker = view.getUint8(offset + 1);

    // Skip padding (0xFF can be repeated)
    if (marker === 0xff) {
      offset++;
      continue;
    }

    // Stand-alone markers (no length): SOI, EOI, RSTn
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }

    // Markers with length
    const segmentLength = view.getUint16(offset + 2);
    if (marker === 0xe1) {
      // APP1 — check for "Exif\0\0"
      if (
        view.getUint8(offset + 4) === 0x45 && // 'E'
        view.getUint8(offset + 5) === 0x78 && // 'x'
        view.getUint8(offset + 6) === 0x69 && // 'i'
        view.getUint8(offset + 7) === 0x66 && // 'f'
        view.getUint8(offset + 8) === 0x00 &&
        view.getUint8(offset + 9) === 0x00
      ) {
        // TIFF header starts at offset + 10
        return readOrientationFromTiff(view, offset + 10);
      }
    }

    offset += 2 + segmentLength;
  }

  return 1; // No EXIF found
}

/**
 * Parse the TIFF header and IFD0 to find the Orientation tag value.
 * Handles both big-endian (MM) and little-endian (II) byte orders.
 */
function readOrientationFromTiff(
  view: DataView,
  tiffStart: number,
): ExifOrientation {
  // Byte order indicator
  const byteOrder = view.getUint16(tiffStart);
  let littleEndian: boolean;
  if (byteOrder === 0x4949) {
    littleEndian = true; // 'II'
  } else if (byteOrder === 0x4d4d) {
    littleEndian = false; // 'MM'
  } else {
    return 1;
  }

  // Verify TIFF magic number (0x002A)
  if (view.getUint16(tiffStart + 2, littleEndian) !== 0x002a) return 1;

  // Offset to IFD0 (relative to tiffStart)
  const ifd0Offset = view.getUint32(tiffStart + 4, littleEndian);
  const ifd0Start = tiffStart + ifd0Offset;
  if (ifd0Start + 2 > view.byteLength) return 1;

  // Number of IFD0 entries
  const numEntries = view.getUint16(ifd0Start, littleEndian);
  if (ifd0Start + 2 + numEntries * 12 > view.byteLength) return 1;

  // Walk IFD0 entries looking for Orientation (tag 0x0112)
  for (let i = 0; i < numEntries; i++) {
    const entryOffset = ifd0Start + 2 + i * 12;
    const tag = view.getUint16(entryOffset, littleEndian);
    if (tag === 0x0112) {
      // Type at entryOffset+2 (should be SHORT = 3), count at +4, value at +8
      const value = view.getUint16(entryOffset + 8, littleEndian);
      // Clamp to valid range 1-8
      if (value >= 1 && value <= 8) return value as ExifOrientation;
      return 1;
    }
  }

  return 1; // Orientation tag not found
}
