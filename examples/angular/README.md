# @gkzlabs/image-compression — Angular (Vite) Example

Angular 18 standalone example for `@gkzlabs/image-compression`, built with **Vite** (via `@analogjs/vite-plugin-angular`).

**Zero worker setup required** — Vite handles `new URL('./worker.js', import.meta.url)` automatically.

## Quick start

```bash
npm install
npm start
```

Then open http://127.0.0.1:4200 and upload an image.

## Why Vite instead of Angular CLI?

Angular CLI's dev server has known issues with library worker URLs:
- `new Worker(new URL('./worker.js', import.meta.url))` from a library gets
  rewritten to `/node_modules/.vite/deps/worker.js?...` which returns 404
  (Angular CLI doesn't pre-bundle workers from libraries)
- Workaround in [angular-image-compression](https://...) was to copy worker
  to `public/` + set `__IC_WORKER_URL` escape hatch

Vite (via `@analogjs/vite-plugin-angular`) handles this natively. **No public/ folder, no escape hatch, no copy script needed.**

## Stack

- Angular 18 (standalone components, signals)
- Vite 6 (dev server + bundler)
- `@analogjs/vite-plugin-angular` (Angular + Vite integration)

## How Vite handles the worker

Vite detects the library's `new Worker(new URL('./worker.js', import.meta.url))` pattern and:

| Mode | Worker URL |
|---|---|
| **Dev** (`npm start`) | `/@fs/.../dist/worker.js` (served from `node_modules` via Vite's `@fs` scheme) |
| **Production** (`npm run build`) | `/assets/worker-<hash>.js` (auto-bundled as separate chunk) |

The `vite.config.ts` has two tweaks to make this work:

```ts
// 1. Exclude the lib from optimize-deps (Vite's optimizer fails on worker.js)
optimizeDeps: { exclude: ['@gkzlabs/image-compression'] },

// 2. Allow Vite to serve files from outside the project root
server: { fs: { allow: ['..', '../..'] } },
```

## Project structure

```
examples/angular/
├── index.html                # Vite entry (root)
├── package.json
├── tsconfig.json
├── tsconfig.app.json
├── vite.config.ts            # Vite + Analog plugin config
└── src/
    ├── main.ts               # bootstrapApplication + zone.js
    ├── styles.css
    └── app/
        ├── app.component.ts  # Angular signals demo
        ├── app.component.html
        └── app.component.css
```

**12 files total** — minimal, no public/, no setup scripts.

## HEIC support (optional)

The library's `tryDecodeHEICLazy()` decodes HEIC files in browsers without
native ImageDecoder support. For production, install `heic2any` and set
`__IC_HEIC2ANY_URL` to a path the lib can load.

This demo doesn't include HEIC setup (opt-in). To enable:

```bash
npm install heic2any
# Then copy heic2any.min.js to public/ and add to main.ts:
# (window as any).__IC_HEIC2ANY_URL = '/heic2any.js';
```

## Build & preview

```bash
npm run build       # vite build → dist/
npm run preview     # serve dist/ on port 4300
```

Build output:
```
dist/index.html                              0.36 kB
dist/assets/worker-<hash>.js                 8.58 kB  ← Vite-bundled worker
dist/assets/image-compression-<hash>.js      0.03 kB  ← Comlink
dist/assets/index-<hash>.js                224.36 kB
✓ built in ~1.7s
```

---

## ⚠️ Critical: NgZone + Web Worker integration

`@gkzlabs/image-compression` runs its core operations inside a Web Worker
(via Comlink). When the worker posts results back to the main thread,
**Zone.js does NOT patch `MessagePort` events** — so promise resolutions
and `onProgress` callbacks fire **outside** Angular's NgZone.

If you update component state (signals, change detection) directly inside
these callbacks or after a worker-based `await`, **Angular will not trigger
Change Detection**. The UI will appear "hung" until the user performs
some other interaction (click, scroll, input change) that IS tracked by
zone.

### The wrong way (UI hangs)

```ts
async onFileChange(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  this.isCompressing.set(true);

  // ❌ await resumes outside zone — signal updates don't trigger CD
  const r = await this.svc.compress(file, {
    onProgress: (p) => this.progress.set(p),  // ❌ outside zone
  });
  this.result.set(r);          // ❌ outside zone
  this.isCompressing.set(false); // ❌ outside zone
}
```

### The right way (UI updates immediately)

```ts
import { NgZone, inject } from '@angular/core';

export class AppComponent {
  private readonly zone = inject(NgZone);
  private svc = new ImageCompression();

  async onFileChange(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    this.isCompressing.set(true);

    const r = await this.svc.compress(file, {
      onProgress: (p) => {
        // ✅ onProgress fires from Worker — wrap to trigger CD
        this.zone.run(() => this.progress.set(p));
      },
    });

    // ✅ await continuation is outside zone — wrap signal updates
    this.zone.run(() => {
      this.result.set(r);
      this.isCompressing.set(false);
    });
  }
}
```

### Why `zone.run()` around the whole call doesn't work

A common attempt is to wrap the entire `core.compress()` call:

```ts
// ❌ Doesn't work reliably
const r = await new Promise((resolve) => {
  this.zone.run(() => {
    this.svc.compress(file, opts).then(resolve);
  });
});
```

The problem: when the inner Promise resolves from the worker's message
event, the `.then` callback fires **outside** zone, so `resolve()` is
called outside zone, so the outer Promise resolves outside zone, so
`await` resumes outside zone. The `zone.run()` doesn't help.

**Rule of thumb:** `zone.run()` must wrap the **state mutations**
(signal `.set()`, `.update()`), not the async control flow.

### What about RxJS Observables?

`compress$()` returns an `AsyncIterable<T>`, not an Observable. To use
it with RxJS in Angular, bridge it manually and wrap each emission:

```ts
import { NgZone } from '@angular/core';
import { Observable } from 'rxjs';
import { compress$ } from '@gkzlabs/image-compression';

function asyncIterableToObservable<T>(
  iter: AsyncIterable<T>,
  zone: NgZone,
): Observable<T> {
  return new Observable<T>((subscriber) => {
    let cancelled = false;
    zone.run(() => {
      (async () => {
        try {
          for await (const value of iter) {
            if (cancelled) break;
            // ✅ each emission in zone → immediate CD
            zone.run(() => subscriber.next(value));
          }
          if (!cancelled) zone.run(() => subscriber.complete());
        } catch (err) {
          if (!cancelled) zone.run(() => subscriber.error(err));
        }
      })();
    });
    return () => { cancelled = true; };
  });
}
```

This pattern is used in the official
[`angular-image-compression`](https://gitlab.com/guidekungz/angular-image-compression)
demo (production-ready, with batch mode, HEIC, and E2E tests).

### Summary

| Pattern | Where to wrap |
|---|---|
| **`onProgress` callback** | Wrap the signal update in `zone.run()` |
| **`await compress()` continuation** | Wrap signal updates in `zone.run()` |
| **`compressAll()` batch results** | Wrap signal updates in `zone.run()` |
| **RxJS bridge for `compress$`** | Wrap each `next`/`complete` emission in `zone.run()` |
| **Don't wrap** | Async control flow (`.then`, `await`) — won't help |

See [`../../docs/EXAMPLES.md`](../../docs/EXAMPLES.md#zone--ngzone) for
the cross-framework explanation.

---

## 🔄 Alternatives to `NgZone.run()`

The `NgZone.run()` pattern above is the **canonical fix** for the
zone/worker boundary problem. But there are alternatives, each with
trade-offs.

### Option A — `ChangeDetectorRef.detectChanges()` (manual CD)

Inject `ChangeDetectorRef` and call `.detectChanges()` after every state
mutation that happens outside the zone:

```ts
import { Component, ChangeDetectorRef, inject } from '@angular/core';

export class AppComponent {
  private readonly cdr = inject(ChangeDetectorRef);
  private svc = new ImageCompression();

  async onFileChange(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    this.isCompressing.set(true);
    this.cdr.detectChanges();

    const r = await this.svc.compress(file, {
      onProgress: (p) => {
        this.progress.set(p);
        this.cdr.detectChanges();  // ← trigger CD manually
      },
    });

    this.result.set(r);
    this.isCompressing.set(false);
    this.cdr.detectChanges();
  }
}
```

| ✅ Pros | ❌ Cons |
|---|---|
| No `NgZone` dependency — works even if Zone is removed | Must remember to call `.detectChanges()` at every state-mutation site (including inside callbacks) |
| One explicit call per change — easy to grep | Can fight with Zone in hybrid apps (mixed mode) |
| Slightly faster than zone tracking (less monkey-patching) | OnPush components still need `.markForCheck()` first |

### Option B — Zoneless Angular (Angular 18+)

Angular 18 introduced **experimental** zoneless support via the
`provideExperimentalZonelessChangeDetection()` provider. With zone.js
removed entirely, **the Web Worker zone problem disappears** because
Angular no longer relies on Zone for change detection — it schedules CD
based on **signal updates** directly.

```ts
// app.config.ts (Angular 18+)
import { ApplicationConfig, provideExperimentalZonelessChangeDetection } from '@angular/core';

export const appConfig: ApplicationConfig = {
  providers: [
    provideExperimentalZonelessChangeDetection(),
    // ... other providers
  ],
};
```

```ts
// main.ts — NO zone.js import
import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './app/app.component';
import { appConfig } from './app/app.config';

bootstrapApplication(AppComponent, appConfig);
// No `import 'zone.js'` — that's the whole point
```

Then your component code goes back to being **simple and zone-free**:

```ts
async onFileChange(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  this.isCompressing.set(true);

  // ✅ No zone.run() needed — signals schedule CD directly
  const r = await this.svc.compress(file, {
    onProgress: (p) => this.progress.set(p),
  });
  this.result.set(r);
  this.isCompressing.set(false);
}
```

| ✅ Pros | ❌ Cons |
|---|---|
| **Zero** zone-tracking overhead (~30% faster change detection in benchmarks) | **Experimental** API (Angular 18.x) — may change before stable |
| No `NgZone.run()` or `ChangeDetectorRef.detectChanges()` boilerplate | Doesn't work with libraries that rely on Zone (RxJS scheduling, NgRx, etc.) |
| Future-proof — zoneless is Angular's long-term direction | Some third-party components may not work without Zone |
| No risk of `MessagePort` events being missed by Zone | Requires Angular 18+ (use `provideExperimentalZonelessChangeDetection`) |

### Comparison matrix

| Approach | Setup cost | Per-update cost | Angular version | Stability |
|---|---|---|---|---|
| `NgZone.run()` (default) | Low | Wrap each signal set | 16+ | ✅ Stable |
| `ChangeDetectorRef.detectChanges()` | Low | Call after each change | 2+ | ✅ Stable |
| **Zoneless** (`provideExperimentalZonelessChangeDetection`) | **None** | **None** (signals auto-trigger) | **18+** | ⚠️ Experimental |

### 🎯 Recommendation

| If you… | Use |
|---|---|
| Are on **Angular 17** or earlier | `NgZone.run()` (or `ChangeDetectorRef`) |
| Are on **Angular 18+** and can accept experimental APIs | Zoneless — much cleaner code, no boilerplate |
| Need broad library compatibility (RxJS, NgRx, etc.) | `NgZone.run()` (safest) |
| Want zero change-detection overhead | Zoneless (Angular 18+) |

For the `angular-image-compression` showcase (Angular 17), this example
uses `NgZone.run()` because the project is on a stable Angular version.
If/when the project upgrades to Angular 18+, switching to zoneless is
a one-line config change — all the `zone.run()` wrappers can be
removed.

See [`../../docs/EXAMPLES.md`](../../docs/EXAMPLES.md#zone--ngzone) for
the cross-framework explanation and the [`AppComponent`](./src/app/app.component.ts)
source for a working `NgZone.run()` example.

## Comparison with other framework examples

| Feature | react/vue/svelte/vanilla | Angular (this) |
|---|---|---|
| Bundler | Vite | Vite (via Analog plugin) |
| Worker setup | None | **None** |
| Worker URL pattern | Auto by Vite | Auto by Vite (via `@fs` + optimize-deps exclude) |
| Angular CLI dep | No | No |
| Bootstrap | `createRoot().render(...)` | `bootstrapApplication(...)` |
| Files | 5-7 | **12** (config files for Angular) |

See [`../README.md`](../README.md) for the full examples comparison.