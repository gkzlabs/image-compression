# @GKz/image-compression — Vue 3 Example

Vue 3 + TypeScript + Composition API example using `<script setup>` and `ref()`.

## Quick start

```bash
npm install
npm run dev
```

Then open http://127.0.0.1:5173 and upload an image.

## When to use this example

- Building a Vue 3 app (Vite, Nuxt 3, etc.)
- Prefer Composition API over Options API
- Want minimal reactivity boilerplate

## How it works

Single-file component (SFC) `App.vue`:
- **`ref()`** for reactive state (caps, result, isCompressing)
- **`onMounted()`** initializes the service
- **`onUnmounted()`** disposes the service (terminates worker)
- **`<script setup>`** — no need for `setup()` wrapper or `return` statements

The key file: [`src/App.vue`](./src/App.vue) (~150 lines, fully commented).

## Core API usage (Vue 3)

```vue
<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { ImageCompression, CompressionError } from '@GKz/image-compression';
import type { CompressionResult, DeviceCapabilities } from '@GKz/image-compression';

// Reactive state
const caps = ref<DeviceCapabilities | null>(null);
const result = ref<CompressionResult | null>(null);
const isCompressing = ref(false);
const error = ref<string | null>(null);

// Service instance (not reactive)
let svc: ImageCompression | null = null;

onMounted(async () => {
  svc = new ImageCompression();
  caps.value = await svc.getCapabilities();
});

onUnmounted(() => {
  svc?.dispose();
  svc = null;
});

async function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file || !svc) return;
  error.value = null;
  result.value = null;
  isCompressing.value = true;
  try {
    result.value = await svc.compress(file, {
      maxWidthOrHeight: 2048,
      quality: 0.85,
      format: 'image/jpeg',
    });
  } catch (err) {
    error.value = err instanceof CompressionError
      ? `${err.code}: ${err.message}`
      : (err as Error).message;
  } finally {
    isCompressing.value = false;
  }
}

function download() {
  if (!result.value) return;
  const url = URL.createObjectURL(result.value.blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = result.value.name;
  a.click();
  URL.revokeObjectURL(url);
}
</script>

<template>
  <div class="demo">
    <h1>🖼️ @GKz/image-compression <span class="badge">Vue</span></h1>

    <details v-if="caps">
      <summary>📱 Device Capabilities</summary>
      <p>Tier: {{ caps.tier }}</p>
      <p>WebCodecs: {{ caps.hasWebCodecs ? '✅' : '❌' }}</p>
    </details>

    <label class="upload">
      <input type="file" accept="image/*" :disabled="isCompressing" @change="onFileChange" />
      <span>{{ isCompressing ? 'Compressing...' : 'Choose image' }}</span>
    </label>

    <p v-if="error" class="error">{{ error }}</p>

    <div v-if="result" class="result">
      <h2>✅ Done</h2>
      <p><strong>Path:</strong> {{ result.path }}</p>
      <p><strong>Original:</strong> {{ formatBytes(result.originalSize) }}</p>
      <p><strong>Compressed:</strong> {{ formatBytes(result.compressedSize) }}</p>
      <p><strong>Saved:</strong> {{ savedPct }}%</p>
      <button @click="download">⬇️ Download</button>
    </div>
  </div>
</template>
```

## Why not `ref()` for the service?

```vue
<script setup lang="ts">
// ❌ Wrong — would trigger Vue reactivity tracking, wastes performance
const svc = ref(new ImageCompression());

// ✅ Correct — plain variable, lifecycle managed by onMounted/onUnmounted
let svc: ImageCompression | null = null;
onMounted(() => { svc = new ImageCompression(); });
onUnmounted(() => { svc?.dispose(); });
</script>
```

## Batch processing

```vue
<script setup lang="ts">
import { ref } from 'vue';

const files = ref<File[]>([]);
const results = ref<CompressionResult[]>([]);
const progress = ref('');

async function compressAll() {
  if (!svc) return;
  results.value = [];
  isCompressing.value = true;
  try {
    // compressAll is async iterable — use for-await-of
    for await (const event of svc.compressAll(files.value, {
      maxWidthOrHeight: 2048,
      quality: 0.85,
    })) {
      if (event.type === 'progress') {
        progress.value = `${event.index + 1}/${event.total} (${event.path})`;
      } else if (event.type === 'result') {
        results.value.push(event.result);
      }
    }
  } finally {
    isCompressing.value = false;
  }
}
</script>

<template>
  <input type="file" multiple @change="files = Array.from($event.target.files ?? [])" />
  <button @click="compressAll" :disabled="isCompressing">Compress {{ files.length }} files</button>
  <p>{{ progress }}</p>
  <ul>
    <li v-for="r in results" :key="r.name">
      {{ r.name }} — {{ formatBytes(r.compressedSize) }}
    </li>
  </ul>
</template>
```

## Common pitfalls

- **Don't use `ref()` for the service** — `ref()` is for reactive state, not non-reactive instances
- **Use `onUnmounted` for cleanup** — disposes the worker, prevents memory leaks
- **`<script setup>`** — auto-exposes top-level bindings to template (no `return` needed)

## Project structure

```
examples/vue/
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
└── src/
    ├── App.vue              # 150 lines, single file
    └── main.ts              # Vue + App mount
```

## See also

- [`../vanilla/`](../vanilla/) — no-framework equivalent
- [`../react/`](../react/) — React 18 equivalent
- [`../svelte/`](../svelte/) — Svelte 5 equivalent
- [`../angular/`](../angular/) — Angular 18 equivalent
- [`../../docs/EXAMPLES.md`](../../docs/EXAMPLES.md)