/**
 * In-page smoke harness — runs INSIDE real Chromium (loaded by test/smoke.html).
 *
 * Everything here uses the built bundle from /dist/ exactly like a consumer:
 * `new ImageCompression()` + `compress()`, no test doubles. The unit suite
 * (happy-dom + @napi-rs/canvas) cannot cover this ground: real Worker,
 * OffscreenCanvas, WebCodecs and `new URL(..., import.meta.url)` resolution.
 *
 * The Node-side driver (test/browser-smoke.mjs) calls `window.__icSmoke.*`.
 */
import { ImageCompression } from '/dist/index.js';

/** base64 → File without Buffer (browser context). */
function base64ToFile(base64, name, type = 'image/jpeg') {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], name, { type });
}

export function installSmokeApi() {
  // Record every Worker the page constructs (URL + when). This is deterministic
  // evidence that the library spawned a dedicated worker at the expected URL —
  // unlike CDP target listing, which is attached asynchronously and (observed on
  // Linux CI runners) may not report the worker at all.
  const workerConstructions = [];
  const NativeWorker = window.Worker;
  if (typeof NativeWorker === 'function') {
    window.Worker = class RecordingWorker extends NativeWorker {
      constructor(url, options) {
        super(url, options);
        workerConstructions.push({ url: String(url), at: Math.round(performance.now()) });
      }
    };
  }

  window.__icSmoke = {
    /** URLs of every Worker the library constructed so far. */
    workerConstructions: () => workerConstructions.slice(),

    /**
     * Compress the same file N times through ONE ImageCompression instance.
     * Returns the per-run results plus the Workers constructed during the loop,
     * which is the real "reuse, no leak" evidence: N runs must spawn exactly 1.
     */
    async repeatCompressions({ count, fixtureBase64, name, options = {} }) {
      const before = workerConstructions.length;
      const svc = new ImageCompression();
      const file = base64ToFile(fixtureBase64, name);
      const runs = [];
      try {
        for (let i = 0; i < count; i++) {
          const started = performance.now();
          const result = await svc.compress(file, options);
          runs.push({
            path: result.path,
            compressedSize: result.compressedSize,
            durationMs: Math.round(performance.now() - started),
          });
        }
      } finally {
        svc.dispose();
      }
      return { runs, created: workerConstructions.slice(before) };
    },
    /**
     * Compress one fixture and report what actually happened.
     *
     * @param {{fixtureBase64: string, name: string, options?: object,
     *          workerUrl?: string|null, disabledFeatures?: string[]}} args
     */
    async compress({ fixtureBase64, name, options = {}, workerUrl = null }) {
      // null → leave the library's own resolution in place; a string → force
      // the `__IC_WORKER_URL` escape hatch (absolute URL, per the Chrome 149
      // rule); 'missing' → point it at a file that 404s on purpose.
      if (workerUrl === null) {
        delete window.__IC_WORKER_URL;
      } else if (workerUrl === 'missing') {
        window.__IC_WORKER_URL = new URL('/this-worker-does-not-exist.js', document.baseURI).href;
      } else {
        window.__IC_WORKER_URL = new URL(workerUrl, document.baseURI).href;
      }

      const svc = new ImageCompression();
      const stages = [];
      const started = performance.now();
      try {
        const result = await svc.compress(base64ToFile(fixtureBase64, name), {
          ...options,
          onProgress: (p) => stages.push(`${p.stage}${p.path ? `:${p.path}` : ''}`),
        });
        return {
          ok: true,
          path: result.path,
          originalSize: result.originalSize,
          compressedSize: result.compressedSize,
          width: result.width,
          height: result.height,
          mimeType: result.mimeType,
          fileName: result.file.name,
          durationMs: Math.round(performance.now() - started),
          stages,
        };
      } catch (err) {
        return {
          ok: false,
          code: err && err.code ? err.code : 'UNKNOWN',
          message: err instanceof Error ? err.message : String(err),
          durationMs: Math.round(performance.now() - started),
          stages,
        };
      } finally {
        // Release the idle worker so one case cannot mask another.
        svc.dispose();
        delete window.__IC_WORKER_URL;
      }
    },

    /** Capabilities as the library sees them in this browser. */
    async capabilities() {
      const svc = new ImageCompression();
      try {
        const caps = await svc.getCapabilities();
        return {
          tier: caps.tier,
          hasWebCodecs: caps.hasWebCodecs,
          hasOffscreenCanvas: caps.hasOffscreenCanvas,
          hasWorker: caps.hasWorker,
          hasCreateImageBitmap: caps.hasCreateImageBitmap,
          hasWebCodecsInWorker: caps.hasWebCodecsInWorker,
          hasOffscreenCanvasInWorker: caps.hasOffscreenCanvasInWorker,
          workerPathsReliable: caps.workerPathsReliable,
        };
      } finally {
        svc.dispose();
      }
    },

    /** Worker URL the library resolves by default in this page. */
    resolvedWorkerUrl() {
      return new URL('./worker.js', new URL('/dist/index.js', document.baseURI)).href;
    },

    // ── deep verification helpers (test/worker-deep-check.mjs) ──────────────

    /**
     * 2-tone test image (red-ish left half, blue-ish right half) with
     * deterministic per-pixel noise so the encoded file is big enough to clear
     * the library's 100KB worker threshold while the region averages stay
     * clearly separated (pixel-level assertions stay meaningful).
     */
    async toneFile(width = 1200, height = 800, quality = 0.95) {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      const img = ctx.createImageData(width, height);
      let seed = 12345;
      const rnd = () => {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        return seed / 2147483648;
      };
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const i = (y * width + x) * 4;
          const left = x < width / 2;
          const noise = Math.floor(rnd() * 60);
          img.data[i] = (left ? 190 : 40) + noise;
          img.data[i + 1] = 40 + Math.floor(rnd() * 30);
          img.data[i + 2] = (left ? 40 : 190) + noise;
          img.data[i + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
      return new File([blob], 'tone-noisy.jpg', { type: 'image/jpeg' });
    },

    /** Average RGB of a region of a decoded blob ('top'|'bottom'|'left'|'right'). */
    async regionColor(blob, region) {
      const bitmap = await createImageBitmap(blob);
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(bitmap, 0, 0);
      const w = bitmap.width;
      const h = bitmap.height;
      const box =
        region === 'top'
          ? [0, 0, w, Math.max(1, Math.floor(h / 2))]
          : region === 'bottom'
            ? [0, Math.floor(h / 2), w, h - Math.floor(h / 2)]
            : region === 'left'
              ? [0, 0, Math.max(1, Math.floor(w / 2)), h]
              : [Math.floor(w / 2), 0, w - Math.floor(w / 2), h];
      const data = ctx.getImageData(box[0], box[1], box[2], box[3]).data;
      let r = 0;
      let g = 0;
      let b = 0;
      for (let i = 0; i < data.length; i += 4) {
        r += data[i];
        g += data[i + 1];
        b += data[i + 2];
      }
      const n = data.length / 4;
      bitmap.close();
      return { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n), width: w, height: h };
    },

    /**
     * Compress with optional extras:
     *  - `disposeAfterMs`: call svc.dispose() mid-flight (public API path)
     *  - `probeMainThread`: sample rAF gaps while compressing → longest block
     */
    async compressAdvanced({ fixtureBase64, tone, name, options = {}, disposeAfterMs, probeMainThread }) {
      delete window.__IC_WORKER_URL;
      const svc = new ImageCompression();
      const file = tone ? await this.toneFile() : base64ToFile(fixtureBase64, name);

      let probe = null;
      if (probeMainThread) {
        probe = { frames: 0, maxGapMs: 0, last: performance.now() };
        const tick = () => {
          const now = performance.now();
          probe.maxGapMs = Math.max(probe.maxGapMs, now - probe.last);
          probe.last = now;
          probe.frames++;
          if (probe.running) requestAnimationFrame(tick);
        };
        probe.running = true;
        requestAnimationFrame(tick);
      }

      const stages = [];
      const started = performance.now();
      let disposeTimer = null;
      if (disposeAfterMs !== undefined) {
        disposeTimer = setTimeout(() => svc.dispose(), disposeAfterMs);
      }
      try {
        const result = await svc.compress(file, {
          ...options,
          onProgress: (p) => stages.push(`${p.stage}${p.path ? `:${p.path}` : ''}`),
        });
        if (probe) probe.running = false;
        const colors = options.mirror || options.rotate
          ? {
              top: await this.regionColor(result.file, 'top'),
              bottom: await this.regionColor(result.file, 'bottom'),
              left: await this.regionColor(result.file, 'left'),
              right: await this.regionColor(result.file, 'right'),
            }
          : null;
        return {
          ok: true,
          path: result.path,
          originalSize: result.originalSize,
          compressedSize: result.compressedSize,
          width: result.width,
          height: result.height,
          durationMs: Math.round(performance.now() - started),
          stages,
          colors,
          probe,
          disposed: disposeAfterMs === undefined ? false : true,
        };
      } catch (err) {
        if (probe) probe.running = false;
        return {
          ok: false,
          code: err && err.code ? err.code : 'UNKNOWN',
          message: err instanceof Error ? err.message : String(err),
          durationMs: Math.round(performance.now() - started),
          stages,
          probe,
          disposed: disposeAfterMs === undefined ? false : true,
        };
      } finally {
        if (disposeTimer) clearTimeout(disposeTimer);
        svc.dispose();
        delete window.__IC_WORKER_URL;
      }
    },
  };
}
