# @gkz/image-compression — Examples

Five complete, working examples demonstrating the same library API across different frameworks. Each example:

- Uses **identical UI logic** (upload file → compress → display result → download)
- Has a **framework-specific binding** (state, lifecycle, render)
- Shares the **same `compress()` API** — no per-framework wrappers
- Runs on **Vite** for dev/preview

## The five examples

| Framework | Files | Bundle size | Setup time | Best for |
|---|---|---|---|---|
| **vanilla** | 5 | ~11 KB (gzip) | <10s | Non-framework sites, drop-in usage |
| **react** | 5 | ~57 KB (gzip) | <10s | React 18 apps, hooks-based state |
| **vue** | 6 | ~38 KB (gzip) | <10s | Vue 3 apps, Composition API |
| **svelte** | 6 | ~14 KB (gzip) | <10s | Svelte 5 apps, smallest bundle |
| **angular** | 12 | ~67 KB (gzip) | <2 min | Angular 18 apps, standalone + signals |

All examples work in **dev mode** and **production build** without any worker setup. Vite handles worker bundling automatically.

## Run any example

```bash
cd examples/vanilla    # or react, vue, svelte, angular
npm install
npm run dev
```

## Common API across all examples

Every example uses the same library calls:

```ts
import { ImageCompression, CompressionError } from '@gkz/image-compression';

// 1. Initialize
const svc = new ImageCompression();

// 2. Detect capabilities (one-time)
const caps = await svc.getCapabilities();

// 3. Compress
const result = await svc.compress(file, {
  maxWidthOrHeight: 2048,
  quality: 0.85,
  format: 'image/jpeg',
});

// 4. Cleanup (terminates worker)
svc.dispose();
```

The **only differences** between examples are:
- How state is held (ref, useState, $state, signals, plain object)
- How lifecycle is managed (onMount, useEffect, $effect, ngOnInit)
- How DOM is rendered (template, JSX, SFC template, signals template)

## Framework-specific patterns

### Vanilla (`examples/vanilla/`)
- Single class, manual `innerHTML` updates
- Re-attach event listeners after `innerHTML` overwrite
- No lifecycle hooks — just constructor + manual cleanup

### React (`examples/react/`)
- `useRef` for the service (persists across renders, not reactive)
- `useState` for reactive UI
- `useEffect` with cleanup for lifecycle
- `useEffect` deps array = `[]` to initialize once

### Vue 3 (`examples/vue/`)
- Plain `let svc` for the service (not `ref()` — ref would be reactive)
- `ref()` for reactive UI state
- `onMounted` + `onUnmounted` for lifecycle
- `<script setup>` for concise SFCs

### Svelte 5 (`examples/svelte/`)
- Plain `let svc` for the service
- `$state(...)` for reactive UI state
- `$effect(() => { ... return cleanup; })` for lifecycle
- Compatible with Svelte 4 (without runes)

### Angular 18 (`examples/angular/`)
- Class field `private svc = new ImageCompression()` (created eagerly)
- `signal<T>()` for reactive state
- `OnInit` + `OnDestroy` for lifecycle
- Uses **Vite** (not Angular CLI) for dev server

## See also

- [`docs/EXAMPLES.md`](../docs/EXAMPLES.md) — Detailed framework comparison, common pitfalls, performance tips
- [`docs/BROWSER_COMPAT.md`](../docs/BROWSER_COMPAT.md) — Per-bundler setup notes
- [`README.md`](../README.md) — Library overview and quick start