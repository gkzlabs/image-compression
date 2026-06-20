import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { sveltePreprocess } from 'svelte-preprocess';

/**
 * Svelte example for @GKz/image-compression.
 * svelte-preprocess is required so the `<script lang="ts">` blocks
 * (with `import type { ... }`) compile correctly. Without it, Svelte's
 * native parser chokes on TypeScript-only syntax like `import type`.
 */
export default defineConfig({
  plugins: [svelte({ preprocess: [sveltePreprocess()] })],
  server: { port: 5173, open: true },
});