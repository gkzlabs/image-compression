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
import { ImageCompression, toPictureSet } from '/dist/index.js';

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
     * Compress a fake HEIC file so the `__IC_HEIC2ANY_URL` hatch is exercised:
     * the library must load the decoder module at RUNTIME (no eval) and use its
     * default export. test/fake-heic-decoder.mjs sets window.__fakeHeicDecoderLoaded.
     */
    async compressHeic({ decoderUrl, options = {} }) {
      window.__fakeHeicDecoderLoaded = false;
      window.__IC_HEIC2ANY_URL = new URL(decoderUrl, document.baseURI).href;
      const svc = new ImageCompression();
      // Bytes that start like a HEIC container; the fake decoder ignores content.
      const file = new File(
        [new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 104, 101, 105, 99])],
        'photo.heic',
        { type: 'image/heic' },
      );
      const stages = [];
      try {
        const result = await svc.compress(file, {
          ...options,
          onProgress: (p) => stages.push(p.stage),
        });
        return {
          ok: true,
          path: result.path,
          width: result.width,
          height: result.height,
          compressedSize: result.compressedSize,
          mimeType: result.mimeType,
          decoderLoaded: window.__fakeHeicDecoderLoaded === true,
          stages,
        };
      } catch (err) {
        return {
          ok: false,
          code: err && err.code ? err.code : 'UNKNOWN',
          message: err instanceof Error ? err.message : String(err),
          decoderLoaded: window.__fakeHeicDecoderLoaded === true,
          stages,
        };
      } finally {
        svc.dispose();
        delete window.__IC_HEIC2ANY_URL;
      }
    },

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

    /**
     * HEIC with NO decoder available anywhere: no native ImageDecoder (headless
     * Chrome has none), no `__IC_HEIC2ANY_URL`, no `window.heic2any` global, and
     * no installed package. Measures how long the attempt takes and what the
     * caller actually receives. Exists to answer "if a consumer never installs
     * heic2any, does compress() hang?" with a number instead of a claim.
     */
    async heicNoDecoderProbe({ heicUrl, options = {} }) {
      const bytes = new Uint8Array(await (await fetch(new URL(heicUrl, document.baseURI))).arrayBuffer());
      delete window.__IC_HEIC2ANY_URL;
      delete window.heic2any;
      const svc = new ImageCompression();
      const stages = [];
      const started = performance.now();
      try {
        const result = await svc.compress(
          new File([bytes], 'sample.heic', { type: 'image/heic' }),
          { ...options, onProgress: (p) => stages.push(`${p.stage}${p.path ? `:${p.path}` : ''}`) },
        );
        const out = new Uint8Array(await result.blob.arrayBuffer());
        let identical = out.length === bytes.length;
        if (identical) for (let i = 0; i < out.length; i++) if (out[i] !== bytes[i]) { identical = false; break; }
        return {
          ok: true,
          path: result.path,
          durationMs: Math.round(performance.now() - started),
          originalSize: result.originalSize,
          compressedSize: result.compressedSize,
          returnsOriginalBytes: identical,
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
        svc.dispose();
        delete window.__IC_HEIC2ANY_URL;
      }
    },

    /**
     * v1.3.3 (C4): `<picture>` output in a real browser — reports which formats
     * the engine can actually encode, the generated markup, and whether
     * `revoke()` really releases the object URLs.
     */
    async pictureSetProbe({ fixtureBase64, name, options = {} }) {
      const file = base64ToFile(fixtureBase64, name);
      let set;
      try {
        set = await toPictureSet(file, options);
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : String(err) };
      }
      const urls = [set.fallback.url, ...set.sources.map((s) => s.url)];
      const result = {
        ok: true,
        fallback: { type: set.fallback.type, bytes: set.fallback.bytes, width: set.fallback.width, height: set.fallback.height },
        sources: set.sources.map((s) => ({ type: s.type, bytes: s.bytes })),
        html: set.html,
        urlCount: urls.length,
      };
      set.revoke();
      // A revoked object URL must no longer resolve — the observable proof that
      // revoke() released the blobs instead of just forgetting them.
      try {
        const res = await fetch(urls[0]);
        result.fetchAfterRevoke = res.ok ? 'still-ok' : `status-${res.status}`;
      } catch {
        result.fetchAfterRevoke = 'failed';
      }
      return result;
    },

    /**
     * v1.3.3: sharpen runs in the Worker — browser-side evidence.
     *
     * Compresses the same synthetic step-edge image twice (sharpen 0 vs N) with a
     * fresh service each time, then reports the mean pixel delta and the mean
     * luminance of the 7px band immediately LEFT of the step edge (the additive
     * unsharp mask's halo signature). Optionally measures main-thread rAF gaps.
     */
    async sharpenProbe({ sharpen = 0.9, options = {}, probeMainThread = false, width = 240, height = 160 }) {
      const makeEdge = async () => {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#101010';
        ctx.fillRect(0, 0, width / 2, height);
        ctx.fillStyle = '#f0f0f0';
        ctx.fillRect(width / 2, 0, width / 2, height);
        const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.95));
        return new File([blob], 'edge.jpg', { type: 'image/jpeg' });
      };

      const raster = async (blob) => {
        const bitmap = await createImageBitmap(blob);
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(bitmap, 0, 0);
        bitmap.close();
        return { data: ctx.getImageData(0, 0, canvas.width, canvas.height).data, width: canvas.width, height: canvas.height };
      };

      const run = async (strength) => {
        const svc = new ImageCompression();
        const file = await makeEdge();
        let probe = null;
        if (probeMainThread) {
          probe = { frames: 0, maxGapMs: 0, last: performance.now(), running: true };
          const tick = () => {
            const now = performance.now();
            probe.maxGapMs = Math.max(probe.maxGapMs, now - probe.last);
            probe.last = now;
            probe.frames++;
            if (probe.running) requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        }
        try {
          const result = await svc.compress(file, {
            format: 'image/jpeg',
            quality: 0.9,
            sharpen: strength,
            ...options,
          });
          if (probe) probe.running = false;
          return { path: result.path, width: result.width, height: result.height, blob: result.blob, probe };
        } finally {
          if (probe) probe.running = false;
          svc.dispose();
        }
      };

      const plain = await run(0);
      const sharpened = await run(sharpen);

      const a = await raster(plain.blob);
      const b = await raster(sharpened.blob);
      let delta = 0;
      const n = Math.min(a.data.length, b.data.length);
      for (let i = 0; i < n; i += 4) {
        delta += Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2]);
      }
      delta = delta / (n / 4) / 3;

      // Band just left of the edge (edge sits at width/2).
      const bandLuma = (rasterized) => {
        const edgeX = Math.floor(rasterized.width / 2);
        let sum = 0;
        let count = 0;
        for (let y = 0; y < rasterized.height; y++) {
          for (let x = Math.max(0, edgeX - 7); x < edgeX; x++) {
            const i = (y * rasterized.width + x) * 4;
            sum += (rasterized.data[i] + rasterized.data[i + 1] + rasterized.data[i + 2]) / 3;
            count++;
          }
        }
        return sum / count;
      };

      return {
        path: sharpened.path,
        plainPath: plain.path,
        dims: `${sharpened.width}x${sharpened.height}`,
        delta,
        bandLumaPlain: bandLuma(a),
        bandLumaSharpened: bandLuma(b),
        probe: sharpened.probe ? { frames: sharpened.probe.frames, maxGapMs: sharpened.probe.maxGapMs } : null,
      };
    },

    /**
     * v1.3.3: HEIC fixture end-to-end with the real file, reporting whether the
     * PAGE-side decoder ran. `test/fixtures/reference-decoder.mjs` records itself
     * on `globalThis.__IC_REFERENCE_DECODER`, so a page-side decode is visible
     * here while a Worker-side decode is not — which is exactly the evidence
     * needed to prove the decode moved off the main thread.
     */
    async heicFixtureProbe({ decoderUrl, heicUrl, options = {}, probeMainThread = false, referenceUrl = null }) {
      const bytes = new Uint8Array(await (await fetch(new URL(heicUrl, document.baseURI))).arrayBuffer());
      let fnv = 0x811c9dc5;
      for (let i = 0; i < bytes.length; i++) {
        fnv ^= bytes[i];
        fnv = Math.imul(fnv, 0x01000193) >>> 0;
      }

      delete window.__IC_REFERENCE_DECODER;
      window.__IC_HEIC2ANY_URL = new URL(decoderUrl, document.baseURI).href;

      const svc = new ImageCompression();
      let probe = null;
      if (probeMainThread) {
        probe = { frames: 0, maxGapMs: 0, last: performance.now(), running: true };
        const tick = () => {
          const now = performance.now();
          probe.maxGapMs = Math.max(probe.maxGapMs, now - probe.last);
          probe.last = now;
          probe.frames++;
          if (probe.running) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }

      const stages = [];
      try {
        const result = await svc.compress(
          new File([bytes], 'sample.heic', { type: 'image/heic' }),
          { format: 'image/jpeg', quality: 0.9, ...options, onProgress: (p) => stages.push(`${p.stage}${p.path ? `:${p.path}` : ''}`) },
        );
        if (probe) probe.running = false;

        const bitmap = await createImageBitmap(result.blob);
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(bitmap, 0, 0);
        bitmap.close();
        const at = (x, y) => [...ctx.getImageData(x, y, 1, 1).data].slice(0, 3);

        // Optional: mean per-channel difference against a ground-truth image
        // (ImageIO's own decode of the same .heic) — proves the decoder's
        // output is not merely "some image" but the right one.
        let meanDeltaVsReference = null;
        if (referenceUrl) {
          const refBlob = await (await fetch(new URL(referenceUrl, document.baseURI))).blob();
          const refBitmap = await createImageBitmap(refBlob);
          const refCanvas = new OffscreenCanvas(refBitmap.width, refBitmap.height);
          const refCtx = refCanvas.getContext('2d');
          refCtx.drawImage(refBitmap, 0, 0);
          refBitmap.close();
          if (refCanvas.width === canvas.width && refCanvas.height === canvas.height) {
            const a = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
            const b = refCtx.getImageData(0, 0, refCanvas.width, refCanvas.height).data;
            let sum = 0;
            for (let i = 0; i < a.length; i += 4) {
              sum += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
            }
            meanDeltaVsReference = sum / (a.length / 4) / 3;
          } else {
            meanDeltaVsReference = `size mismatch: ${canvas.width}x${canvas.height} vs ${refCanvas.width}x${refCanvas.height}`;
          }
        }

        return {
          ok: true,
          path: result.path,
          width: result.width,
          height: result.height,
          compressedSize: result.compressedSize,
          originalSize: result.originalSize,
          stages,
          fixtureBytes: bytes.length,
          fixtureFnv: fnv,
          meanDeltaVsReference,
          decoderSawOnPage: window.__IC_REFERENCE_DECODER
            ? { size: window.__IC_REFERENCE_DECODER.size, fnv1a: window.__IC_REFERENCE_DECODER.fnv1a, calls: window.__IC_REFERENCE_DECODER.calls }
            : null,
          quadrants: {
            topLeft: at(40, 40),
            topRight: canvas.width > 280 ? at(280, 40) : null,
            bottomLeft: canvas.height > 200 ? at(40, 200) : null,
            bottomRight: canvas.height > 200 && canvas.width > 280 ? at(280, 200) : null,
          },
          probe: probe ? { frames: probe.frames, maxGapMs: probe.maxGapMs } : null,
        };
      } catch (err) {
        if (probe) probe.running = false;
        return {
          ok: false,
          code: err && err.code ? err.code : 'UNKNOWN',
          message: err instanceof Error ? err.message : String(err),
          stages,
          fixtureBytes: bytes.length,
          fixtureFnv: fnv,
          decoderSawOnPage: window.__IC_REFERENCE_DECODER ?? null,
          probe: probe ? { frames: probe.frames, maxGapMs: probe.maxGapMs } : null,
        };
      } finally {
        if (probe) probe.running = false;
        svc.dispose();
        delete window.__IC_HEIC2ANY_URL;
        delete window.__IC_REFERENCE_DECODER;
      }
    },
  };
}
