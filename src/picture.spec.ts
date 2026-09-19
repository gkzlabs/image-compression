import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toPictureSet } from './picture';
import { canEncodeFormat } from './worker-helpers';
import { ImageCompression } from './service';

/**
 * v1.3.3 — `<picture>` helper tests.
 *
 * The environment cannot encode everything (vitest's canvas polyfill backs
 * @napi-rs/canvas, which has no AVIF encoder), so these tests assert the
 * CONTRACT rather than hard-coded format lists:
 *   - the fallback is always present and matches the requested format,
 *   - every `<source>` the helper emits is a format the encoder really reports,
 *   - the markup is valid, ordered best-first, and free of duplicate formats,
 *   - object URLs are owned: revoke() releases exactly what was created.
 * The positive AVIF/WebP path is covered in real Chromium by
 * `test/browser-smoke.mjs` (pictureSetProbe).
 */
async function sampleFile(width = 200, height = 120): Promise<File> {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d context');
  ctx.fillStyle = '#3366cc';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(width / 2, 0, width / 4, height);
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
  return new File([blob], 'sample.jpg', { type: 'image/jpeg' });
}

describe('toPictureSet()', () => {
  let created: string[] = [];
  let revoked: string[] = [];
  let svc: ImageCompression;

  beforeEach(() => {
    created = [];
    revoked = [];
    svc = new ImageCompression();
    vi.spyOn(URL, 'createObjectURL').mockImplementation((obj: Blob | MediaSource) => {
      const url = `blob:mock/${created.length}-${(obj as Blob).size ?? 0}`;
      created.push(url);
      return url;
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation((url: string) => {
      revoked.push(url);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    svc.dispose();
  });

  it('always returns a JPEG fallback with correct dimensions and markup', async () => {
    const set = await toPictureSet(await sampleFile(200, 120), { maxWidthOrHeight: 200 }, svc);

    expect(set.fallback.type).toBe('image/jpeg');
    expect(set.fallback.width).toBe(200);
    expect(set.fallback.height).toBe(120);
    expect(set.fallback.bytes).toBeGreaterThan(0);
    expect(set.fallback.url).toMatch(/^blob:/);

    expect(set.html).toContain('<picture>');
    expect(set.html).toContain('</picture>');
    expect(set.html).toContain(`<img src="${set.fallback.url}"`);
    expect(set.html).toContain('width="200"');
    expect(set.html).toContain('height="120"');
  });

  it('emits only formats the encoder actually reports as supported', async () => {
    const set = await toPictureSet(await sampleFile(), { maxWidthOrHeight: 200 }, svc);

    for (const source of set.sources) {
      expect(await canEncodeFormat(source.type), `${source.type} must be encodable`).toBe(true);
      expect(source.url).toMatch(/^blob:/);
      expect(set.html).toContain(`<source srcset="${source.url}" type="${source.type}">`);
    }
  });

  it('lists sources best-first (AVIF before WebP) with no duplicates', async () => {
    const set = await toPictureSet(await sampleFile(), { maxWidthOrHeight: 200 }, svc);

    const order = set.sources.map((s) => s.type);
    expect(order).toEqual([...order].sort((a, b) => {
      const rank = (t: string) => (t === 'image/avif' ? 0 : t === 'image/webp' ? 1 : 2);
      return rank(a) - rank(b);
    }));
    expect(new Set(order).size).toBe(order.length);
    expect(order).not.toContain(set.fallback.type);
  });

  it('does not advertise a format it did not encode (no phantom <source>)', async () => {
    const set = await toPictureSet(await sampleFile(), { maxWidthOrHeight: 200 }, svc);
    const sourceTags = set.html.match(/<source /g)?.length ?? 0;
    expect(sourceTags).toBe(set.sources.length);
  });

  it('owns its object URLs: revoke() releases each one exactly once', async () => {
    const set = await toPictureSet(await sampleFile(), { maxWidthOrHeight: 200 }, svc);
    const expected = [set.fallback.url, ...set.sources.map((s) => s.url)];

    set.revoke();
    expect(revoked).toEqual(expected);
    // Idempotent — a second call must not double-revoke.
    set.revoke();
    expect(revoked).toEqual(expected);
  });

  it('honours a non-JPEG fallback format (webp-only output)', async () => {
    const set = await toPictureSet(
      await sampleFile(),
      { maxWidthOrHeight: 200, format: 'image/png' },
      svc,
    );
    expect(set.fallback.type).toBe('image/png');
    expect(set.sources.map((s) => s.type)).not.toContain('image/png');
    expect(set.html).toContain(`src="${set.fallback.url}"`);
  });

  it('propagates a compress() failure to the caller', async () => {
    const failing = {
      compress: async () => {
        throw new Error('encode exploded');
      },
      dispose: () => {},
    } as unknown as ImageCompression;
    await expect(toPictureSet(await sampleFile(), {}, failing)).rejects.toThrow('encode exploded');
  });
});
