/**
 * Stand-in HEIC decoder used by the browser suites.
 *
 * Purpose: prove the library's `window.__IC_HEIC2ANY_URL` hatch loads a module at
 * RUNTIME and uses it — with no `eval` and no bundler-specific setup (v1.3.2
 * replaced the eval-based loader with a plain dynamic import).
 *
 * It mimics heic2any's contract: `default({ blob, toType }) => Promise<Blob>`.
 * Instead of decoding HEIC (that needs the WASM decoder), it returns a small
 * JPEG so the rest of the cascade can be asserted.
 */
window.__fakeHeicDecoderLoaded = true;

export default async function fakeHeicDecoder({ toType = 'image/jpeg' } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = 80;
  canvas.height = 40;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#00c853';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, toType, 0.9));
  return blob;
}
