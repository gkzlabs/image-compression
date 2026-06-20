# @GKz/image-compression — Svelte 5 Example

Svelte 5 + TypeScript example using `$state` runes (Svelte 5 reactive primitives).

## Quick start

```bash
npm install
npm run dev
```

Then open http://127.0.0.1:5173 and upload an image.

## When to use this example

- Building a Svelte 5 app (SvelteKit, Vite, etc.)
- Using runes (`$state`, `$derived`, `$effect`)
- Want smallest bundle size

## How it works

Single-file component `App.svelte`:
- **`$state`** for reactive state (caps, result, isCompressing)
- **`$effect`** initializes the service and disposes on cleanup
- Plain `let` for the service (not reactive)

The key file: [`src/App.svelte`](./src/App.svelte) (~150 lines, fully commented).

## Core API usage (Svelte 5)

```svelte
<script lang="ts">
  import { ImageCompression, CompressionError } from '@GKz/image-compression';
  import type { CompressionResult, DeviceCapabilities } from '@GKz/image-compression';

  // Reactive state (Svelte 5 runes)
  let caps = $state<DeviceCapabilities | null>(null);
  let result = $state<CompressionResult | null>(null);
  let isCompressing = $state(false);
  let error = $state<string | null>(null);

  // Non-reactive service instance
  let svc: ImageCompression | null = null;

  // Lifecycle: initialize on mount, dispose on unmount
  $effect(() => {
    svc = new ImageCompression();
    svc.getCapabilities().then(c => caps = c);
    return () => svc?.dispose();
  });

  async function onFileChange(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file || !svc) return;
    error = null;
    result = null;
    isCompressing = true;
    try {
      result = await svc.compress(file, {
        maxWidthOrHeight: 2048,
        quality: 0.85,
        format: 'image/jpeg',
      });
    } catch (err) {
      error = err instanceof CompressionError
        ? `${err.code}: ${err.message}`
        : (err as Error).message;
    } finally {
      isCompressing = false;
    }
  }

  function download() {
    if (!result) return;
    const url = URL.createObjectURL(result.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = result.name;
    a.click();
    URL.revokeObjectURL(url);
  }
</script>

<div class="demo">
  <h1>🖼️ @GKz/image-compression <span class="badge">Svelte</span></h1>

  {#if caps}
    <details>
      <summary>📱 Device Capabilities</summary>
      <p>Tier: {caps.tier}</p>
    </details>
  {/if}

  <label class="upload">
    <input type="file" accept="image/*" disabled={isCompressing} onchange={onFileChange} />
    <span>{isCompressing ? 'Compressing...' : 'Choose image'}</span>
  </label>

  {#if error}
    <p class="error">{error}</p>
  {/if}

  {#if result}
    <div class="result">
      <h2>✅ Done</h2>
      <p><strong>Path:</strong> {result.path}</p>
      <p><strong>Original:</strong> {formatBytes(result.originalSize)}</p>
      <p><strong>Compressed:</strong> {formatBytes(result.compressedSize)}</p>
      <button onclick={download}>⬇️ Download</button>
    </div>
  {/if}
</div>
```

## Svelte 4 vs Svelte 5

This example uses **Svelte 5 runes** (`$state`, `$effect`). For Svelte 4:

```svelte
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';

  let caps = null;  // Svelte 4: plain let is reactive
  let result = null;
  let isCompressing = false;

  let svc: ImageCompression | null = null;
  onMount(() => {
    svc = new ImageCompression();
    svc.getCapabilities().then(c => caps = c);
  });
  onDestroy(() => svc?.dispose());
</script>
```

Svelte 5 runes are opt-in (mix runes and Svelte 4 syntax freely).

## Common pitfalls

- **`$state` vs plain `let`** — only `$state` makes values reactive. Use plain `let` for non-reactive service instances
- **`$effect` cleanup** — return a function from `$effect` to clean up (like `useEffect` in React)
- **Svelte 5 requires `vite-plugin-svelte` ≥4.0** — check your `package.json`

## Project structure

```
examples/svelte/
├── index.html
├── package.json
├── svelte.config.js
├── tsconfig.json
├── vite.config.ts
└── src/
    ├── App.svelte          # 150 lines, single file
    └── main.ts             # Svelte 5 mount
```

## See also

- [`../vanilla/`](../vanilla/) — no-framework equivalent
- [`../react/`](../react/) — React 18 equivalent
- [`../vue/`](../vue/) — Vue 3 equivalent
- [`../angular/`](../angular/) — Angular 18 equivalent
- [`../../docs/EXAMPLES.md`](../../docs/EXAMPLES.md)