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
