<script lang="ts">
/**
 * Svelte 4 example for @gkzlabs/image-compression.
 * Uses Svelte's reactive `let` bindings + `$:` derived values.
 */
import { onDestroy, onMount } from 'svelte';
import { ImageCompression, CompressionError } from '@gkzlabs/image-compression';
import type { CompressionResult, DeviceCapabilities } from '@gkzlabs/image-compression';

let svc = new ImageCompression();
let caps: DeviceCapabilities | null = null;
let isCompressing = false;
let result: CompressionResult | null = null;

onMount(async () => {
  caps = await svc.getCapabilities();
});

onDestroy(() => {
  svc.dispose();
});

$: saved = result
  ? Math.round((1 - result.compressedSize / result.originalSize) * 100)
  : null;

$: downloadUrl = result ? URL.createObjectURL(result.blob) : '';

async function onFileChange(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  result = null;
  isCompressing = true;
  try {
    result = await svc.compress(file, {
      maxWidthOrHeight: 2048,
      quality: 0.85,
      format: 'image/jpeg',
    });
  } catch (err) {
    const msg = err instanceof CompressionError
      ? `${err.code}: ${err.message}`
      : (err as Error).message;
    alert(`Compression failed: ${msg}`);
  } finally {
    isCompressing = false;
  }
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}
</script>

<div class="demo">
  <h1>🖼️ @gkzlabs/image-compression <span class="badge">Svelte</span></h1>

  {#if caps}
    <details>
      <summary>📱 Device Capabilities</summary>
      <table>
        <tbody>
          <tr><td>Tier</td><td>{caps.tier}</td></tr>
          <tr><td>WebCodecs</td><td>{caps.hasWebCodecs ? '✅' : '❌'}</td></tr>
          <tr><td>OffscreenCanvas</td><td>{caps.hasOffscreenCanvas ? '✅' : '❌'}</td></tr>
          <tr><td>Web Worker</td><td>{caps.hasWorker ? '✅' : '❌'}</td></tr>
          <tr><td>createImageBitmap</td><td>{caps.hasCreateImageBitmap ? '✅' : '❌'}</td></tr>
        </tbody>
      </table>
    </details>
  {:else}
    <p>Loading capabilities...</p>
  {/if}

  <label class="upload">
    <input type="file" accept="image/*" disabled={isCompressing} on:change={onFileChange} />
    <span>{isCompressing ? 'Compressing...' : 'Choose image'}</span>
  </label>

  {#if result}
    <div class="result">
      <h2>✅ Done</h2>
      <p><strong>Path:</strong> {result.path}</p>
      <p><strong>Tier:</strong> {result.tier}</p>
      <p><strong>Original:</strong> {formatBytes(result.originalSize)}</p>
      <p><strong>Compressed:</strong> {formatBytes(result.compressedSize)}</p>
      <p><strong>Saved:</strong> {saved}%</p>
      {#if result.width && result.height}
        <p><strong>Dimensions:</strong> {result.width}×{result.height}</p>
      {/if}
      <a href={downloadUrl} download={result.name}>⬇️ Download</a>
    </div>
  {/if}
</div>

<style>
  body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; background: #f5f5f5; }
  .demo { background: white; padding: 24px; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
  .badge { background: #ff3e00; color: white; padding: 2px 8px; border-radius: 4px; font-size: 14px; }
  .upload { display: block; margin: 20px 0; padding: 12px; border: 2px dashed #ccc; border-radius: 8px; text-align: center; cursor: pointer; }
  .upload input { display: none; }
  .result { background: #f9f9f9; padding: 16px; border-radius: 8px; margin-top: 20px; }
  .result a { display: inline-block; margin-top: 12px; padding: 8px 16px; background: #05a647; color: white; text-decoration: none; border-radius: 6px; }
  details { margin-bottom: 20px; }
  details table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  details td { padding: 4px 8px; border-bottom: 1px solid #eee; }
</style>