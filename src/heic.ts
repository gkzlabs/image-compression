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
 * Hard ceiling for the runtime `heic2any` decoder (import AND decode).
 *
 * Without it, a `__IC_HEIC2ANY_URL` whose host never answers — or a decoder that
 * never settles — leaves `compress()` waiting on the browser's own import
 * timeout (minutes) or forever. Measured need: a black-holed decoder must not be
 * able to hang a UI. Override for tests: `globalThis.__IC_HEIC_DECODER_TIMEOUT_MS`.
 */
const DEFAULT_DECODER_TIMEOUT_MS = 10_000;

function decoderTimeoutMs(): number {
  const raw = (globalThis as { __IC_HEIC_DECODER_TIMEOUT_MS?: number })
    .__IC_HEIC_DECODER_TIMEOUT_MS;
  return typeof raw === 'number' && raw > 0 ? raw : DEFAULT_DECODER_TIMEOUT_MS;
}

/**
 * Reject with `label timed out after <ms>ms` if `work` has not settled in time.
 * The underlying promise keeps running (we cannot cancel a dynamic import), but
 * the caller stops waiting and the cascade falls back — which is the point.
 */
export function withDecoderTimeout<T>(work: Promise<T>, label: string, ms = decoderTimeoutMs()): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

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
  // - URL hatch: a runtime dynamic import of a user-supplied URL. Nothing to
  //   resolve at build time, so it works in every bundler including Angular
  //   CLI's esbuild (which cannot resolve a bare `import('heic2any')` from
  //   node_modules).
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
  //
  // SECURITY: until v1.3.2 this used a JavaScript eval-based loader, which
  // required `script-src 'unsafe-eval'` in the page CSP and tripped
  // supply-chain scanners as "dynamic code execution". A plain dynamic import
  // with a runtime variable behaves identically (verified: esbuild and Vite both
  // leave it as a runtime import instead of bundling it), so there is no
  // dynamic code execution and no CSP escape hatch any more.
  // See SECURITY.md § HEIC decoding.
  const heic2anyUrl = (globalThis as { __IC_HEIC2ANY_URL?: string }).__IC_HEIC2ANY_URL;
  if (heic2anyUrl) {
    try {
      // v1.5.0: the import AND the decode are bounded — a host that never
      // answers (or a decoder that never settles) must not hang compress().
      return await withDecoderTimeout(
        (async () => {
          // Load the decoder module at RUNTIME. heic2any is UMD/IIFE or ESM
          // depending on how it was built:
          // - As IIFE: sets `window.heic2any` (UMD browser global path)
          // - As ESM: exports `default`
          // We support both.
          const mod = (await import(/* @vite-ignore */ heic2anyUrl)) as {
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
        })(),
        'HEIC decoder (__IC_HEIC2ANY_URL)',
      );
    } catch {
      // URL hatch failed or timed out; try bare specifier
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
    return await withDecoderTimeout(
      (async () => {
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
      })(),
      'HEIC decoder (heic2any)',
    );
  } catch {
    // Both strategies failed (or timed out)
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