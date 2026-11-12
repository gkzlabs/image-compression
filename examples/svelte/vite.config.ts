import { defineConfig } from 'vite';
import { svelte, vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/**
 * Svelte example for @gkzlabs/image-compression.
 *
 * Svelte 5 + vite-plugin-svelte 7: `vitePreprocess` replaces the old
 * `svelte-preprocess` dependency (which peer-caps Svelte at 4) so the
 * `<script lang="ts">` blocks — including `import type { ... }` — compile.
 */
export default defineConfig({
  plugins: [svelte({ preprocess: [vitePreprocess()] })],
  server: { port: 5173, open: true },
});