# Server-Side Fallback Reference

When the browser can't compress client-side (very old browser, no Canvas, or
you explicitly `forceServer: true`), `compress()` returns a `server-fallback`
result — the **original file unchanged**, wrapped with `width: 0, height: 0`
and the original MIME type. The caller then uploads the raw file to your server
to compress there.

This doc shows how to build that server endpoint. It's a reference /
starting point — copy the pieces you need.

## When does the library fall back to the server?

- `options.forceServer: true` — caller explicitly wants server processing
- `options.forcePath: 'server-fallback'`
- The browser lacks every client compression path (no Canvas / OffscreenCanvas
  at all — extremely rare in 2026)
- HEIC provided but not decodable client-side (`HEIC_UNSUPPORTED`)

## How `server-fallback` results behave

```ts
const result = await svc.compress(file, { forceServer: true });
result.path            // 'server-fallback'
result.file            // the ORIGINAL file (unchanged)
result.width           // 0
result.height          // 0
result.mimeType        // original file.type
result.compressedSize  // == originalSize (no compression happened)
```

Important: the server-fallback result does **not** apply transforms or
`maxSizeMB`. If callers set those options AND get a server-fallback, your
server must honor them. Inspect `result.path` and handle it.

## Reference implementations

### Option A — Node.js (ESM), `sharp` (recommended)

`sharp` is the de-facto high-performance image lib for Node, with a WASM/CL
build that downscales, converts formats, and honors quality targets.

```js
// server/route.js — Express (or any framework) receiving a multipart upload
import sharp from 'sharp';

export async function handleUpload(req, res) {
  const { file } = req.files;            // busboy / multer multipart
  const {
    format = 'image/jpeg',
    quality = 0.85,
    maxWidthOrHeight = 2048,
    maxSizeMB,                            // optional hard budget
  } = req.body;

  let img = sharp(file.data);

  // Multi-step downscale approximates the client's ~50% halving ladders.
  if (maxWidthOrHeight > 0) {
    img = img.resize({ width: maxWidthOrHeight, height: maxWidthOrHeight, fit: 'inside', withoutEnlargement: true });
  }

  // Format conversion (sharp supports jpeg/webp/png/avif).
  const q = Math.round((quality ?? 0.85) * 100);
  let out = img[format === 'image/png' ? 'png' : format === 'image/webp' ? 'webp'
    : format === 'image/avif' ? 'avif' : 'jpeg']({ quality: q });

  // Hard size target: sharp has no built-in loop — resize until <= maxSizeMB
  // (mirror the client's binary-search / dimension ladder intent).
  let buffer = await out.toBuffer();
  if (maxSizeMB) {
    const target = maxSizeMB * 1024 * 1024;
    let scale = 1;
    while (buffer.length > target && scale > 0.5) {
      scale -= 0.1;
      const meta = await sharp(file.data).metadata();
      buffer = await img
        .clone()
        .resize({ width: Math.round(meta.width * scale), withoutEnlargement: true })
        [format === 'image/png' ? 'png' : format === 'image/webp' ? 'webp' : format === 'image/avif' ? 'avif' : 'jpeg']({ quality: q })
        .toBuffer();
    }
  }

  res.setHeader('Content-Type', format);
  res.send(buffer);
}
```

> Node ≥ 18 required. `sharp` is a native module — install with
> `npm install sharp`. For pure-JS alternatives see `jimp` (slower, no AVIF)
> or `@napi-rs/canvas`.

### Option B — `@gkzlabs/image-compression` itself on a Node/WASM runtime

Since v1.2.0 the package ships **both** ESM and CJS bundles. In a Node context
there's no DOM/Canvas by default, so `compress()` resolves to `server-fallback`
again — not useful. This path only works in a runtime that provides a
Canvas2D implementation (e.g. `@napi-rs/canvas`, or jsdom with a canvas mock):

```js
// Node with a canvas polyfill — lets you reuse the SAME client pipeline server-side
globalThis.HTMLCanvasElement = require('@napi-rs/canvas').HTMLCanvasElement;
const { ImageCompression } = require('@gkzlabs/image-compression'); // CJS
```

In practice **Option A (sharp) is simpler and faster** for a real server —
the CJS export is primarily for SSR frameworks (Next.js/Nuxt) that compile
consumer code to CJS and only partially run client paths.

## Reading the browser's `path` result

The client-facing contract for partial-failure UIs:

```ts
const result = await svc.compress(file, options);
if (result.path === 'server-fallback') {
  // Optionally notify the user compression happened on the server.
  upload(file); // send the ORIGINAL file to the endpoint above
} else {
  upload(result.file); // send the compressed file
}
```

## Full client + server contract

| Client result.path      | File to upload            | Server responsibility            |
|-------------------------|---------------------------|----------------------------------|
| `webcodecs-worker` / `offscreen-worker` / `canvas-main` / `passthrough` | `result.file` (already compressed) | Store/reprocess, no client-shrink needed |
| `server-fallback`       | `result.file` (== original, unmodified) | Downscale to `maxWidthOrHeight`, convert to `format`, honor `maxSizeMB`, honor transforms |

## Security notes

- Always validate the uploaded file's MIME + magic bytes server-side
  (`sharp` does sniffing; still set a size cap before compress).
- Never trust `maxWidthOrHeight`/`maxSizeMB` from the client blindly — clamp
  to a server-side maximum (e.g. max 4096px) to prevent decompression bombs.
- Set a read timeout + memory cap on the compress route.