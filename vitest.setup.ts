/**
 * Vitest setup — polyfills for browser APIs that don't exist in Node/happy-dom.
 *
 * We use `@napi-rs/canvas` to provide a real Canvas2D implementation
 * (prebuilt native binaries, no compilation needed). This lets the
 * unit tests verify actual pixel-level behavior (EXIF rotation, resize)
 * without requiring a full browser environment.
 *
 * Note: these polyfills are for TESTS ONLY. The production library
 * (used by browsers) has access to real Canvas2D natively.
 */

import { createCanvas, type Canvas, type SKRSContext2D, loadImage as napiLoadImage, Image as NapiImage } from '@napi-rs/canvas';

/**
 * ImageBitmap polyfill — wraps a real @napi-rs/canvas Canvas so that
 * `ctx.drawImage(bitmap, ...)` works (it accepts CanvasElement types).
 */
class ImageBitmapPolyfill {
  readonly width: number;
  readonly height: number;
  readonly _canvas: Canvas;

  constructor(width: number, height: number, canvas?: Canvas) {
    this.width = width;
    this.height = height;
    this._canvas = canvas ?? createCanvas(width, height);
  }

  close(): void {
    // Canvas resources auto-release
  }
}

// OffscreenCanvas polyfill — uses real @napi-rs/canvas under the hood.
class OffscreenCanvasPolyfill {
  private _canvas: Canvas;
  width: number;
  height: number;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this._canvas = createCanvas(width, height);
  }

  getContext(type: '2d'): SKRSContext2D | null {
    if (type !== '2d') return null;
    return this._canvas.getContext('2d');
  }

  convertToBlob(opts?: { type?: string; quality?: number }): Promise<Blob> {
    return new Promise((resolve, reject) => {
      try {
        const mime = opts?.type ?? 'image/png';
        // @napi-rs/canvas supports 'image/jpeg' | 'image/webp' | 'image/png' | 'image/avif' | 'image/gif'
        // Use the requested mime directly — Canvas will fail for unsupported types.
        const buffer = this._canvas.toBuffer(mime as 'image/jpeg', { quality: opts?.quality });
        resolve(new Blob([new Uint8Array(buffer)], { type: mime }));
      } catch (e) {
        reject(e);
      }
    });
  }

  transferToImageBitmap(): ImageBitmap {
    // Return a real ImageBitmap-like wrapper that holds a Canvas reference.
    // The `drawImage` call in applyExifOrientation uses bitmap.width/height
    // and passes `bitmap` to ctx.drawImage, which accepts CanvasElement.
    return new ImageBitmapPolyfill(this.width, this.height, this._canvas) as unknown as ImageBitmap;
  }
}

if (typeof globalThis.OffscreenCanvas === 'undefined') {
  globalThis.OffscreenCanvas = OffscreenCanvasPolyfill as unknown as typeof OffscreenCanvas;
}

// createImageBitmap polyfill — return a Canvas-wrapped ImageBitmap
if (typeof globalThis.createImageBitmap === 'undefined') {
  globalThis.createImageBitmap = async (source: ImageBitmapSource | OffscreenCanvas | ImageBitmap): Promise<ImageBitmap> => {
    // If source is our polyfill, use its underlying canvas directly
    if (source instanceof OffscreenCanvasPolyfill) {
      return new ImageBitmapPolyfill(source.width, source.height) as unknown as ImageBitmap;
    }
    if (source instanceof ImageBitmapPolyfill) {
      return new ImageBitmapPolyfill(source.width, source.height) as unknown as ImageBitmap;
    }
    if (source instanceof Blob) {
      // Decode blob using @napi-rs/canvas loadImage
      const buffer = Buffer.from(await source.arrayBuffer());
      const img = await napiLoadImage(buffer);
      return new ImageBitmapPolyfill(img.width, img.height) as unknown as ImageBitmap;
    }
    // Generic fallback
    const w = (source as { width?: number }).width ?? 1;
    const h = (source as { height?: number }).height ?? 1;
    return new ImageBitmapPolyfill(w, h) as unknown as ImageBitmap;
  };
}

// v0.10.9: HTMLCanvasElement.getContext polyfill.
//
// happy-dom's HTMLCanvasElement.getContext('2d') returns null — it doesn't
// actually implement Canvas2D. This means any code path that does
// `document.createElement('canvas').getContext('2d')` (including service.ts's
// canvas-main and applyTransformsIfRequested re-encode steps) fails silently
// in the test environment.
//
// We patch getContext on the happy-dom HTMLCanvasElement prototype to return
// a real @napi-rs/canvas 2D context. This:
//   1. Unblocks tests of code paths that use document.createElement('canvas')
//   2. Closes a pre-existing test gap (canvas-main path was untested)
//   3. Is test-only — production code runs in real browsers with native canvas
if (typeof HTMLCanvasElement !== 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const proto = (HTMLCanvasElement.prototype as any) as {
    getContext: (type: string) => unknown;
  };
  const originalGetContext = proto.getContext;
  proto.getContext = function (this: HTMLCanvasElement, type: string): unknown {
    if (type !== '2d') {
      return originalGetContext?.call(this, type) ?? null;
    }
    // Reuse the same napi-rs/canvas instance when width/height are set.
    // We store the backing canvas on a hidden property; recreate on resize.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const self = this as any;
    const w = this.width || 1;
    const h = this.height || 1;
    if (!self.__napiCanvas || self.__napiCanvasW !== w || self.__napiCanvasH !== h) {
      self.__napiCanvas = createCanvas(w, h);
      self.__napiCanvasW = w;
      self.__napiCanvasH = h;
    }
    return self.__napiCanvas.getContext('2d');
  };
  // toBlob polyfill — happy-dom also doesn't implement this. We add a
  // minimal version that serializes the backing canvas to a buffer.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (HTMLCanvasElement.prototype as any).toBlob = function (
    this: HTMLCanvasElement,
    callback: (blob: Blob | null) => void,
    type?: string,
    quality?: number,
  ): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const self = this as any;
    const canvas = self.__napiCanvas;
    if (!canvas) {
      callback(null);
      return;
    }
    try {
      // @napi-rs/canvas supports 'image/jpeg' | 'image/webp' | 'image/png' | 'image/avif' | 'image/gif'
      const mime = (type ?? 'image/png') as 'image/jpeg' | 'image/webp' | 'image/png' | 'image/avif' | 'image/gif';
      const buffer = canvas.toBuffer(mime, quality);
      callback(new Blob([new Uint8Array(buffer)], { type: mime }));
    } catch (e) {
      callback(null);
    }
  };
}
