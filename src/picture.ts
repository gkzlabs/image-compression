/**
 * v1.3.3 — responsive `<picture>` output helper.
 *
 * `compress()` returns one blob in one format, which leaves the "serve AVIF/WebP
 * with a JPEG fallback" workflow to the caller. This helper runs the compressor
 * once per format the browser can actually encode, wraps the results as object
 * URLs and hands back ready-to-paste `<picture>` markup:
 *
 * ```ts
 * const set = await toPictureSet(file, { maxWidthOrHeight: 1600 });
 * document.body.insertAdjacentHTML('beforeend', set.html);
 * // ...later, when the markup is torn down:
 * set.revoke();
 * ```
 *
 * Design notes:
 * - Sources are ordered best-first (AVIF → WebP) exactly as `<picture>` requires:
 *   the browser uses the first `<source>` whose `type` it supports.
 * - Formats the browser cannot encode are SKIPPED, never faked (probe via
 *   `canEncodeFormat`), so the markup can't advertise a format that fails to
 *   decode later.
 * - Object URLs are owned by the returned set; callers must `revoke()` them or
 *   the blobs are pinned in memory for the page's lifetime.
 */
import type { CompressionOptions, OutputFormat } from './types';
import { ImageCompression } from './service';
import { canEncodeFormat } from './worker-helpers';

export interface PictureSource {
  /** MIME type used in the `<source type="...">` attribute. */
  type: OutputFormat;
  /** Object URL of the encoded image (owned by the returned set). */
  url: string;
  /** Encoded size in bytes. */
  bytes: number;
  width: number;
  height: number;
}

export interface PictureSet {
  /** The format every browser can show (the caller's `options.format`). */
  fallback: PictureSource;
  /** Modern formats the browser can encode, best-first (AVIF, then WebP). */
  sources: PictureSource[];
  /** Complete `<picture>` markup referencing the object URLs above. */
  html: string;
  /** Revoke every object URL created for this set. */
  revoke(): void;
}

/** Preference order for `<source>` elements (first match wins in the browser). */
const MODERN_FORMATS: OutputFormat[] = ['image/avif', 'image/webp'];

export async function toPictureSet(
  input: File | Blob,
  options: CompressionOptions = {},
  service?: ImageCompression,
): Promise<PictureSet> {
  const svc = service ?? new ImageCompression();
  const ownedUrls: string[] = [];
  const urlFor = (blob: Blob): string => {
    const url = URL.createObjectURL(blob);
    ownedUrls.push(url);
    return url;
  };

  const encode = async (format: OutputFormat) => {
    // onProgress intentionally dropped: N sequential runs would interleave
    // progress events from different formats and confuse a single UI progress bar.
    const { onProgress: _drop, ...rest } = options;
    void _drop;
    const result = await svc.compress(input, { ...rest, format });
    return {
      type: format,
      url: urlFor(result.blob),
      bytes: result.compressedSize,
      width: result.width,
      height: result.height,
    } satisfies PictureSource;
  };

  try {
    const fallbackFormat = options.format ?? 'image/jpeg';
    const fallback = await encode(fallbackFormat);

    const sources: PictureSource[] = [];
    for (const format of MODERN_FORMATS) {
      if (format === fallbackFormat) continue;
      if (!(await canEncodeFormat(format))) continue;
      try {
        sources.push(await encode(format));
      } catch {
        // Encoder claimed support then failed on the real image — skip the
        // format rather than shipping a broken <source>.
      }
    }

    const html = [
      '<picture>',
      ...sources.map((s) => `  <source srcset="${s.url}" type="${s.type}">`),
      `  <img src="${fallback.url}" width="${fallback.width}" height="${fallback.height}" alt="">`,
      '</picture>',
    ].join('\n');

    return {
      fallback,
      sources,
      html,
      revoke: () => {
        for (const url of ownedUrls.splice(0)) URL.revokeObjectURL(url);
      },
    };
  } finally {
    // Only dispose a service this helper created; a caller-supplied one is theirs.
    if (!service) svc.dispose();
  }
}
