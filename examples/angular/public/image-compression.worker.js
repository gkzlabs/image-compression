import * as Comlink from 'comlink';
import { applyExifOrientation, encodeViaOffscreenCanvas, readExifOrientation, resizeOffscreen, tryDecodeHEIC, } from './worker-helpers.js';
/**
 * Image compression Web Worker.
 *
 * Runs in Worker context (no DOM). Exposed via Comlink so the main thread
 * can call methods like normal async functions.
 *
 * Pure helper logic lives in `worker-helpers.ts` so it can be unit-tested
 * without spinning up a Worker context.
 *
 * v0.10.7: REVERTED to v0.5.7 structure exactly. The extract-to-core
 * refactor (v0.6.0+) added an `applyTransforms` step (v0.3.0 optimization)
 * that was being called even when no transforms were requested. Even with
 * v0.10.6's guard, the detach error persisted in some environments.
 *
 * The safest fix is to remove the `applyTransforms` step entirely and
 * match v0.5.7's call chain:
 *   - HEIC: tryDecodeHEIC → encodeViaOffscreenCanvas → bitmap.close()
 *   - Non-HEIC: resizeOffscreen → (maybe) applyExifOrientation → encodeViaOffscreenCanvas → bitmap.close()
 *
 * The v0.3.0 optimization (combined rotate+mirror+resize in single draw)
 * is dropped. Manual rotate/mirror/exact-resize options are still
 * supported by falling through to `canvas-main` path (which handles
 * them via separate steps).
 */
const api = {
    async compress(file, options) {
        const { maxWidthOrHeight = 2048, quality = 0.85, format = 'image/jpeg', onProgress, } = options;
        const emit = (stage, percent) => {
            onProgress?.({
                stage,
                percent,
                path: 'webcodecs-worker',
            });
        };
        let bitmap;
        let width;
        let height;
        // For HEIC, try native decode first
        const isHEIC = (file instanceof File && /\.(heic|heif)$/i.test(file.name)) ||
            file.type === 'image/heic' ||
            file.type === 'image/heif';
        if (isHEIC) {
            emit('decoding', 20);
            const heicBitmap = await tryDecodeHEIC(file);
            if (heicBitmap) {
                bitmap = heicBitmap;
                width = heicBitmap.width;
                height = heicBitmap.height;
                emit('resizing', 50);
            }
            else {
                throw new Error('HEIC not supported in this browser. Please convert to JPEG first.');
            }
        }
        else {
            emit('decoding', 20);
            const decoded = await resizeOffscreen(file, maxWidthOrHeight);
            bitmap = decoded.bitmap;
            width = decoded.width;
            height = decoded.height;
            // EXIF auto-rotation: read orientation tag (no-op for non-JPEG or
            // orientation 1) and apply the rotation so the output is correctly
            // oriented even though Canvas re-encoding strips EXIF metadata.
            // This is critical for photos taken on phones in portrait mode
            // (orientation 6 = 90° CW is the most common case).
            const orientation = await readExifOrientation(file);
            if (orientation !== 1) {
                const rotated = applyExifOrientation(bitmap, orientation);
                bitmap.close();
                bitmap = rotated.bitmap;
                width = rotated.width;
                height = rotated.height;
                emit('resizing', 60); // bumped to show rotation step
            }
        }
        // Encode
        const blob = await encodeViaOffscreenCanvas(bitmap, format, quality);
        bitmap.close();
        emit('encoding', 95);
        return { blob, width, height, mimeType: format };
    },
    async supportsHEIC() {
        if (typeof ImageDecoder === 'undefined')
            return false;
        try {
            return await ImageDecoder.isTypeSupported('image/heic');
        }
        catch {
            return false;
        }
    },
    async getWorkerCapabilities() {
        let hasOffscreenCanvas = false;
        try {
            const c = new OffscreenCanvas(1, 1);
            hasOffscreenCanvas = c.getContext('2d') !== null;
        }
        catch {
            hasOffscreenCanvas = false;
        }
        const hasWebCodecs = typeof VideoEncoder !== 'undefined' &&
            typeof ImageDecoder !== 'undefined';
        let hasCreateImageBitmap = false;
        try {
            hasCreateImageBitmap = typeof createImageBitmap === 'function';
        }
        catch {
            hasCreateImageBitmap = false;
        }
        return { hasOffscreenCanvas, hasWebCodecs, hasCreateImageBitmap };
    },
    /**
     * End-to-end roundtrip probe: decode a 1x1 PNG, draw it, encode it.
     * Catches environment-specific bugs (e.g. Chrome module-worker detach)
     * that simple feature detection misses.
     */
    async probeWorkerPath() {
        // 1x1 transparent PNG
        const tinyPng = new Blob([
            new Uint8Array([
                0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00,
                0x0d, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00,
                0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89,
                0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63,
                0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4,
                0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60,
                0x82,
            ]),
        ], { type: 'image/png' });
        let bitmap = null;
        try {
            bitmap = await createImageBitmap(tinyPng);
            const canvas = new OffscreenCanvas(1, 1);
            const ctx = canvas.getContext('2d');
            if (!ctx)
                return false;
            ctx.drawImage(bitmap, 0, 0);
            const blob = await canvas.convertToBlob({ type: 'image/png' });
            return blob.size > 0;
        }
        catch {
            return false;
        }
        finally {
            bitmap?.close();
        }
    },
};
Comlink.expose(api);
//# sourceMappingURL=worker.js.map