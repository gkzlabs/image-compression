# @gkz/image-compression — React Example

React 18 + TypeScript example using **hooks** (useState, useEffect, useRef).

## Quick start

```bash
npm install
npm run dev
```

Then open http://127.0.0.1:5173 and upload an image.

## When to use this example

- Building a React app (Create React App, Vite, Next.js client component, etc.)
- Need lifecycle management (cleanup on unmount)
- Want reactive UI updates tied to compression state

## How it works

Single `CompressorDemo` functional component:
- **`useRef`** holds the `ImageCompression` instance (created once, persists across renders)
- **`useState`** holds reactive state (caps, result, isCompressing)
- **`useEffect`** initializes the service on mount, disposes on unmount

The key file: [`src/main.tsx`](./src/main.tsx) (~120 lines, fully commented).

## Core API usage (React)

```tsx
import { useEffect, useRef, useState } from 'react';
import { ImageCompression, CompressionError } from '@gkz/image-compression';
import type { CompressionResult, DeviceCapabilities } from '@gkz/image-compression';

function ImageCompressor() {
  // 1. Hold service in a ref (survives re-renders, not a dep of useEffect)
  const svcRef = useRef<ImageCompression | null>(null);

  // 2. Reactive state
  const [caps, setCaps] = useState<DeviceCapabilities | null>(null);
  const [result, setResult] = useState<CompressionResult | null>(null);
  const [isCompressing, setIsCompressing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 3. Initialize once on mount, dispose on unmount
  useEffect(() => {
    const svc = new ImageCompression();
    svcRef.current = svc;
    svc.getCapabilities().then(setCaps);
    return () => svc.dispose();  // terminates worker if running
  }, []);

  // 4. Compression handler
  async function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !svcRef.current) return;
    setError(null);
    setResult(null);
    setIsCompressing(true);
    try {
      const r = await svcRef.current.compress(file, {
        maxWidthOrHeight: 2048,
        quality: 0.85,
        format: 'image/jpeg',
        onProgress: (e) => {
          // update UI: e.stage, e.percent, e.path
        },
      });
      setResult(r);
    } catch (err) {
      const msg = err instanceof CompressionError
        ? `${err.code}: ${err.message}`
        : (err as Error).message;
      setError(msg);
    } finally {
      setIsCompressing(false);
    }
  }

  // 5. Trigger download
  function download() {
    if (!result) return;
    const url = URL.createObjectURL(result.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = result.name;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      {caps && <div>Tier: {caps.tier}</div>}
      <input type="file" accept="image/*" onChange={onFileChange} disabled={isCompressing} />
      {isCompressing && <p>Compressing...</p>}
      {error && <p style={{ color: 'red' }}>{error}</p>}
      {result && (
        <div>
          <p>{result.path} — {result.compressedSize} bytes ({Math.round((1 - result.compressedSize / result.originalSize) * 100)}% saved)</p>
          <button onClick={download}>Download</button>
        </div>
      )}
    </div>
  );
}
```

## Why `useRef` for the service?

```tsx
// ❌ Wrong — useState would cause re-render and re-init
const [svc] = useState(() => new ImageCompression());

// ❌ Wrong — useState with default creates new instance every render
const [svc] = useState(new ImageCompression());

// ✅ Correct — useRef persists across renders, no re-render on change
const svcRef = useRef<ImageCompression | null>(null);
useEffect(() => {
  svcRef.current = new ImageCompression();
  return () => svcRef.current?.dispose();
}, []);
```

If you use `useState` without the lazy initializer `() => new ImageCompression()`, the service gets re-created on every render — wastes the worker.

## Batch processing (multiple files)

```tsx
async function onMultipleFiles(e: React.ChangeEvent<HTMLInputElement>) {
  const files = Array.from(e.target.files ?? []);
  if (!files.length || !svcRef.current) return;
  setIsCompressing(true);
  try {
    // compressAll returns an AsyncIterable<CompressAllStreamEvent>
    const results = [];
    for await (const event of svcRef.current.compressAll(files, options)) {
      if (event.type === 'progress') {
        setProgress(`${event.index + 1}/${event.total}`);
      } else if (event.type === 'result') {
        results.push(event.result);
        setPartialResults([...results]);
      }
    }
  } finally {
    setIsCompressing(false);
  }
}
```

## Aborting compression

```tsx
const abortRef = useRef<AbortController | null>(null);

async function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
  abortRef.current?.abort();
  abortRef.current = new AbortController();
  // ...
  await svc.compress(file, {
    ...options,
    signal: abortRef.current.signal,
  });
}

function cancel() {
  abortRef.current?.abort();
}
```

## Common pitfalls

- **Don't create a new service in render** — use `useRef` + `useEffect` to persist
- **Don't forget `dispose()` on unmount** — leaks the worker otherwise
- **Handle `CompressionError` separately** — has a `code` and `path` for diagnostics
- **`useEffect` cleanup runs on every dep change** — if you pass `[svc]`, it re-creates the service

## Project structure

```
examples/react/
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
└── src/
    └── main.tsx              # 120 lines
```

## See also

- [`../vanilla/`](../vanilla/) — no-framework equivalent
- [`../vue/`](../vue/) — Vue 3 equivalent
- [`../svelte/`](../svelte/) — Svelte 5 equivalent
- [`../angular/`](../angular/) — Angular 18 equivalent
- [`../../docs/EXAMPLES.md`](../../docs/EXAMPLES.md)