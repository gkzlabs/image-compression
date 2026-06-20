<template>
  <div class="demo">
    <h1>🖼️ @GKz/image-compression <span class="badge">Vue</span></h1>

    <details v-if="caps">
      <summary>📱 Device Capabilities</summary>
      <table>
        <tbody>
          <tr><td>Tier</td><td>{{ caps.tier }}</td></tr>
          <tr><td>WebCodecs</td><td>{{ caps.hasWebCodecs ? '✅' : '❌' }}</td></tr>
          <tr><td>OffscreenCanvas</td><td>{{ caps.hasOffscreenCanvas ? '✅' : '❌' }}</td></tr>
          <tr><td>Web Worker</td><td>{{ caps.hasWorker ? '✅' : '❌' }}</td></tr>
          <tr><td>createImageBitmap</td><td>{{ caps.hasCreateImageBitmap ? '✅' : '❌' }}</td></tr>
        </tbody>
      </table>
    </details>
    <p v-else>Loading capabilities...</p>

    <label class="upload">
      <input
        type="file"
        accept="image/*"
        :disabled="isCompressing"
        @change="onFileChange"
      />
      <span>{{ isCompressing ? 'Compressing...' : 'Choose image' }}</span>
    </label>

    <div v-if="result" class="result">
      <h2>✅ Done</h2>
      <p><strong>Path:</strong> {{ result.path }}</p>
      <p><strong>Tier:</strong> {{ result.tier }}</p>
      <p><strong>Original:</strong> {{ formatBytes(result.originalSize) }}</p>
      <p><strong>Compressed:</strong> {{ formatBytes(result.compressedSize) }}</p>
      <p><strong>Saved:</strong> {{ saved }}%</p>
      <p v-if="result.width && result.height"><strong>Dimensions:</strong> {{ result.width }}×{{ result.height }}</p>
      <a :href="downloadUrl" :download="result.name">⬇️ Download</a>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * Vue 3 Composition API example for @GKz/image-compression.
 * Uses `<script setup>` + `ref()` + `onMounted()` for reactivity.
 */
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { ImageCompression, CompressionError } from '@GKz/image-compression';
import type { CompressionResult, DeviceCapabilities } from '@GKz/image-compression';

const svc = new ImageCompression();
const caps = ref<DeviceCapabilities | null>(null);
const isCompressing = ref(false);
const result = ref<CompressionResult | null>(null);

onMounted(async () => {
  caps.value = await svc.getCapabilities();
});

onUnmounted(() => {
  svc.dispose();
});

const saved = computed(() =>
  result.value
    ? Math.round((1 - result.value.compressedSize / result.value.originalSize) * 100)
    : null,
);

const downloadUrl = computed(() =>
  result.value ? URL.createObjectURL(result.value.blob) : '',
);

async function onFileChange(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  result.value = null;
  isCompressing.value = true;
  try {
    result.value = await svc.compress(file, {
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
    isCompressing.value = false;
  }
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}
</script>

<style>
body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; background: #f5f5f5; }
.demo { background: white; padding: 24px; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
.badge { background: #42b883; color: white; padding: 2px 8px; border-radius: 4px; font-size: 14px; }
.upload { display: block; margin: 20px 0; padding: 12px; border: 2px dashed #ccc; border-radius: 8px; text-align: center; cursor: pointer; }
.upload input { display: none; }
.result { background: #f9f9f9; padding: 16px; border-radius: 8px; margin-top: 20px; }
.result a { display: inline-block; margin-top: 12px; padding: 8px 16px; background: #05a647; color: white; text-decoration: none; border-radius: 6px; }
details { margin-bottom: 20px; }
details table { width: 100%; border-collapse: collapse; margin-top: 8px; }
details td { padding: 4px 8px; border-bottom: 1px solid #eee; }
</style>