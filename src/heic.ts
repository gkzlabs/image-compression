/**
 * HEIC/HEIF decoding helpers.
 *
 * HEIC (Apple's iPhone photo format) isn't natively decodable by all browsers.
 * We support 3 fallback strategies, tried in order:
 *
 * 1. **`ImageDecoder`** — native browser API (Chrome 94+ on macOS 11+,
 *    Win 11, Android 12+). No dependency, hardware-accelerated.
 * 2. **`heic2any` via URL hatch** — loads the WASM decoder from a runtime
 *    URL (set via `window.__IC_HEIC2ANY_URL`). Works in **all** bundlers,
 *    including Angular esbuild (which fails on bare specifier imports).
 * 3. **`heic2any` bare specifier** — original `import('heic2any')`. Works
 *    in Node + Vite + Webpack 5, fails in Angular esbuild.
 *
 * If all 3 fail, returns `null` and the caller decides whether to:
 * - Pass HEIC through as-is (consumer uploads to server)
 * - Throw a `CompressionError('HEIC_UNSUPPORTED', ...)`
 */

/**
 * Try to decode a HEIC/HEIF blob to JPEG. Returns `null` on failure.
 *
 * Exported for unit testing (see `heic-decode.spec.ts`). Used internally by
 * the `ImageCompression` class's HEIC pre-decode step.
 */
export async function tryDecodeHEICLazy(file: File | Blob): Promise<Blob | null> {
  // Path 1: Native ImageDecoder (iOS Safari, Chrome 94+ for some formats)
  if (typeof ImageDecoder !== 'undefined') {
    try {
      const supported = await ImageDecoder.isTypeSupported('image/heic');
      if (supported) {
        const buffer = await file.arrayBuffer();
        const decoder = new ImageDecoder({ data: buffer, type: 'image/heic' });
        const { image } = await decoder.decode();
        decoder.close();
        // VideoFrame -> ImageBitmap -> JPEG Blob
        const bitmap = await createImageBitmap(image);
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(bitmap, 0, 0);
          const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.95 });
          bitmap.close();
          return blob;
        }
      }
    } catch {
      // Native decode failed, fall through to heic2any
    }
  }

  // Path 2: heic2any (WASM) — try URL hatch first, then bare specifier.
  //
  // Why this order:
  // - URL hatch uses a runtime variable so no bundler can analyze it.
  //   This is the ONLY strategy that works in production Angular esbuild
  //   builds (Vite's @vite-ignore doesn't work for esbuild).
  // - Bare specifier is the original behavior, works in Node + Vite +
  //   Webpack 5 (and any bundler that resolves dynamic imports).
  //
  // In the Angular wrapper, `main.ts` sets `window.__IC_HEIC2ANY_URL` to
  // '/heic2any.js' before bootstrap, and `scripts/copy-heic2any.js` copies
  // heic2any to dist/ during build. So the URL hatch will resolve and
  // decode successfully.
  //
  // For other consumers (Node, Vite, vanilla JS), set
  // `__IC_HEIC2ANY_URL` to a URL of heic2any.js (e.g. CDN) before calling.

  // Strategy 1: URL hatch (works in ALL environments including Angular esbuild)
  const heic2anyUrl = (globalThis as { __IC_HEIC2ANY_URL?: string }).__IC_HEIC2ANY_URL;
  if (heic2anyUrl) {
    try {
      // Load the heic2any script via dynamic import. heic2any is a UMD/IIFE
      // module. Depending on how it's bundled:
      // - As IIFE: sets `window.heic2any` (UMD browser global path)
      // - As ESM: exports `default` (esbuild's ESM wrapping)
      // We support both.
      // eslint-disable-next-line no-eval
      const mod = (await eval(`import('${heic2anyUrl}')`)) as {
        default?: unknown;
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const heic2any =
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (globalThis as any).heic2any ??
        mod.default ??
        (mod as any) as
          | ((opts: { blob: Blob; toType: string }) => Promise<Blob | Blob[]>)
          | undefined;
      if (typeof heic2any !== 'function') {
        throw new Error('heic2any not found after script load (no global, no default)');
      }
      const result = await heic2any({ blob: file, toType: 'image/jpeg' });
      return Array.isArray(result) ? result[0] : result;
    } catch {
      // URL hatch failed; try bare specifier
    }
  }

  // Strategy 2: Bare specifier (Node, Vite, Webpack 5, etc.)
  // In Angular esbuild, this import will fail at build time unless
  // `heic2any` is added to `angular.json` `externalDependencies`.
  // We use `/* @vite-ignore */` to help Vite skip analysis; other
  // bundlers will either resolve or throw.
  try {
    // heic2any is an optional dependency. The `as string` cast tells
    // TypeScript to treat this as a string literal, not as a type
    // assertion (which would require heic2any in the type space).
    const mod = (await import(/* @vite-ignore */ 'heic2any' as string)) as {
      default?: unknown;
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const heic2any =
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis as any).heic2any ??
      mod.default ??
      (mod as any) as
        | ((opts: { blob: Blob; toType: string }) => Promise<Blob | Blob[]>)
        | undefined;
    if (typeof heic2any !== 'function') {
      throw new Error('heic2any not found after bare import');
    }
    const result = await heic2any({ blob: file, toType: 'image/jpeg' });
    return Array.isArray(result) ? result[0] : result;
  } catch {
    // Both strategies failed
    return null;
  }
}

/**
 * Detect HEIC/HEIF files by extension or MIME type.
 * Used to trigger the HEIC pre-decode path before the cascade.
 */
export function isHEICFile(file: File | Blob): boolean {
  if (file instanceof File && /\.(heic|heif)$/i.test(file.name)) return true;
  return file.type === 'image/heic' || file.type === 'image/heif';
}