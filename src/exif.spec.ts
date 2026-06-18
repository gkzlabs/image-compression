import { readExifOrientation, type ExifOrientation } from './exif';

/**
 * Tests for EXIF orientation reader.
 * Uses synthetic JPEG data to verify each orientation value.
 */
describe('readExifOrientation()', () => {
  /**
   * Build a minimal JPEG with EXIF orientation tag set to the given value.
   * Layout:
   *   FFD8 (SOI)
   *   FFE1 (APP1 marker) + length + 'Exif\0\0'
   *   TIFF header (II = little-endian, magic 0x002A, IFD0 offset = 8)
   *   IFD0: 1 entry (Orientation tag)
   *     Tag 0x0112, Type 0x0003 (SHORT), Count 1, Value 1-8
   *   Next IFD offset 0x00000000
   *   FFD9 (EOI)
   */
  function buildJpegWithOrientation(orientation: number): Blob {
    const bytes: number[] = [];

    // SOI
    bytes.push(0xff, 0xd8);

    // APP1 marker + length (we'll fill length in later)
    const app1Start = bytes.length;
    bytes.push(0xff, 0xe1);
    bytes.push(0x00, 0x00); // placeholder length

    // 'Exif\0\0'
    bytes.push(0x45, 0x78, 0x69, 0x66, 0x00, 0x00);

    // TIFF header (little-endian = 'II')
    const tiffStart = bytes.length - app1Start;
    bytes.push(0x49, 0x49); // 'II'
    bytes.push(0x2a, 0x00); // magic 0x002A (LE)
    bytes.push(0x08, 0x00, 0x00, 0x00); // IFD0 offset = 8 (from TIFF start)

    // IFD0
    bytes.push(0x01, 0x00); // 1 entry
    // Entry: Orientation tag (0x0112), SHORT (0x0003), count 1, value
    bytes.push(0x12, 0x01); // tag
    bytes.push(0x03, 0x00); // type
    bytes.push(0x01, 0x00, 0x00, 0x00); // count
    bytes.push(orientation & 0xff, (orientation >> 8) & 0xff, 0x00, 0x00); // value
    // Next IFD offset
    bytes.push(0x00, 0x00, 0x00, 0x00);

    // EOI
    bytes.push(0xff, 0xd9);

    // Fill in APP1 length (includes everything from FFE1 to end of TIFF)
    const app1Length = bytes.length - app1Start;
    bytes[app1Start + 2] = (app1Length >> 8) & 0xff;
    bytes[app1Start + 3] = app1Length & 0xff;

    return new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' });
  }

  it('returns 1 (no rotation) for non-JPEG input', async () => {
    const png = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], {
      type: 'image/png',
    });
    const orientation = await readExifOrientation(png);
    expect(orientation).toBe(1);
  });

  it('returns 1 for JPEG without EXIF marker', async () => {
    // Minimal JPEG without APP1
    const jpegNoExif = new Blob(
      [new Uint8Array([0xff, 0xd8, 0xff, 0xd9])],
      { type: 'image/jpeg' },
    );
    const orientation = await readExifOrientation(jpegNoExif);
    expect(orientation).toBe(1);
  });

  [1, 2, 3, 4, 5, 6, 7, 8].forEach((orientation) => {
    it(`reads orientation ${orientation} correctly from JPEG EXIF`, async () => {
      const jpeg = buildJpegWithOrientation(orientation);
      const result = await readExifOrientation(jpeg);
      expect(result).toBe(orientation as ExifOrientation);
    });
  });

  it('returns 1 for very small (corrupt) JPEG', async () => {
    const tiny = new Blob([new Uint8Array([0xff])], { type: 'image/jpeg' });
    const orientation = await readExifOrientation(tiny);
    expect(orientation).toBe(1);
  });
});
