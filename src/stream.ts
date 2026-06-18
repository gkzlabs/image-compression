/**
 * Framework-agnostic streaming API for image compression.
 *
 * Uses native `AsyncIterable` (ES2018) — works with any framework:
 * - React: `for await (const evt of stream)` in useEffect
 * - Vue: `await` in setup
 * - Svelte: `async` block
 * - Angular: convert to Observable via `from()` (see angular-image-compression package)
 * - vanilla JS: `for await` loop
 *
 * No RxJS, no framework-specific abstractions.
 */

import { CompressionError, isCompressionResult } from './types';
import type {
  CompressionOptions,
  CompressionProgress,
  CompressionResult,
} from './types';
import type { ImageCompression } from './service';

/**
 * Per-file progress event emitted during `compressAll$()`.
 */
export interface BatchProgress {
  /** Zero-based index of the file being processed */
  fileIndex: number;
  /** Progress event for that file */
  progress: CompressionProgress;
}

/**
 * Union of events emitted by `compress$()`:
 * - `CompressionProgress` during processing
 * - `CompressionResult` once complete (final emission)
 */
export type CompressStreamEvent = CompressionProgress | CompressionResult;

/**
 * Union of events emitted by `compressAll$()`:
 * - `BatchProgress` during processing
 * - `CompressionResult[]` once all files complete (final emission)
 */
export type CompressAllStreamEvent = BatchProgress | CompressionResult[];

/**
 * Stream variant of `compress()`. Emits progress events during processing,
 * then the final result. Returns an `AsyncIterable` for `for await...of` consumption.
 *
 * @example
 * ```ts
 * const stream = svc.compress$(file, { quality: 0.85 });
 * for await (const evt of stream) {
 *   if (isCompressionResult(evt)) {
 *     // evt is CompressionResult — final
 *     console.log('Done:', evt.file.name);
 *   } else {
 *     // evt is CompressionProgress
 *     console.log(`[${evt.percent}%] ${evt.stage}`);
 *   }
 * }
 * ```
 *
 * Cancellation: pass `options.signal` (AbortSignal). The underlying
 * `compress()` will throw `CompressionError(ABORTED)`, which propagates
 * out of the iterator when you call `.next()`.
 */
export function compress$(
  file: File | Blob,
  options: CompressionOptions = {},
  svc: ImageCompression,
): AsyncIterable<CompressStreamEvent> {
  return {
    [Symbol.asyncIterator](): AsyncIterator<CompressStreamEvent> {
      const opts: CompressionOptions = {
        ...options,
        onProgress: options.onProgress, // preserve user's callback if set
      };

      // Use a queue + deferred to convert the Promise + progress events
      // into an async iterator.
      const queue: CompressStreamEvent[] = [];
      let pendingResolve: ((value: IteratorResult<CompressStreamEvent>) => void) | null = null;
      let isDone = false;
      let error: unknown = null;

      const push = (evt: CompressStreamEvent) => {
        if (pendingResolve) {
          const r = pendingResolve;
          pendingResolve = null;
          r({ value: evt, done: false });
        } else {
          queue.push(evt);
        }
      };

      // Wrap the user's onProgress to also push to our queue
      const wrappedOpts: CompressionOptions = {
        ...opts,
        onProgress: (e: CompressionProgress) => {
          push(e);
          opts.onProgress?.(e);
        },
      };

      // Kick off the compression
      const promise = svc.compress(file, wrappedOpts)
        .then((result) => {
          push(result);
          isDone = true;
        })
        .catch((err) => {
          error = err;
          isDone = true;
          // Wake up any pending next() so it can reject with the error.
          if (pendingResolve) {
            const r = pendingResolve;
            pendingResolve = null;
            r({ value: undefined as unknown as CompressStreamEvent, done: false });
          }
        });

      return {
        next(): Promise<IteratorResult<CompressStreamEvent>> {
          // Emit queued events
          if (queue.length > 0) {
            return Promise.resolve({ value: queue.shift()!, done: false });
          }
          // Throw stored error
          if (error !== null) {
            return Promise.reject(error);
          }
          // Done — no more events
          if (isDone) {
            return Promise.resolve({ value: undefined, done: true });
          }
          // Wait for next event
          return new Promise((resolve) => {
            pendingResolve = resolve;
          });
        },
        return(): Promise<IteratorResult<CompressStreamEvent>> {
          isDone = true;
          return Promise.resolve({ value: undefined, done: true });
        },
      };
    },
  };
}

/**
 * Batch stream variant of `compressAll()`. Emits per-file progress events
 * with a `fileIndex` tag, then the final array of results.
 *
 * Memory warning: all files are held in memory. The `maxConcurrent` parameter
 * (default 2) bounds parallel processing to prevent OOM on mobile.
 *
 * @example
 * ```ts
 * for await (const evt of svc.compressAll$(files, { quality: 0.85 })) {
 *   if (isBatchResult(evt)) {
 *     // evt is CompressionResult[] — all done
 *     console.log(`Processed ${evt.length} files`);
 *   } else {
 *     // evt is BatchProgress
 *     console.log(`File ${evt.fileIndex}: ${evt.progress.percent}%`);
 *   }
 * }
 * ```
 *
 * Error handling: if any file fails, the entire batch throws (via the
 * iterator's `.throw()`). For partial results, use `compress()` per file.
 */
export function compressAll$(
  files: (File | Blob)[],
  options: CompressionOptions = {},
  maxConcurrent: number = 2,
  svc: ImageCompression,
): AsyncIterable<CompressAllStreamEvent> {
  return {
    [Symbol.asyncIterator](): AsyncIterator<CompressAllStreamEvent> {
      if (files.length === 0) {
        // Empty batch: emit final empty array, then complete.
        // AsyncIterator contract: if `done: true`, the value is ignored.
        // So we return `done: false` once with the empty array, then `done: true` on the next call.
        let emitted = false;
        const emptyIter: AsyncIterator<CompressAllStreamEvent> = {
          next() {
            if (!emitted) {
              emitted = true;
              return Promise.resolve({ value: [] as CompressionResult[], done: false });
            }
            return Promise.resolve({ value: undefined, done: true });
          },
        };
        return emptyIter;
      }

      const queue: CompressAllStreamEvent[] = [];
      let pendingResolve: ((value: IteratorResult<CompressAllStreamEvent>) => void) | null = null;
      let isDone = false;
      let error: unknown = null;

      const push = (evt: CompressAllStreamEvent) => {
        if (pendingResolve) {
          const r = pendingResolve;
          pendingResolve = null;
          r({ value: evt, done: false });
        } else {
          queue.push(evt);
        }
      };

      // Per-file state
      const results: (CompressionResult | null)[] = new Array(files.length).fill(null);
      let completedCount = 0;
      let errored = false;

      // Bounded concurrency: launch up to maxConcurrent at a time
      let nextIndex = 0;
      let activeCount = 0;

      const launchNext = () => {
        if (errored) return;
        while (
          nextIndex < files.length &&
          (maxConcurrent <= 0 || activeCount < maxConcurrent)
        ) {
          const fileIndex = nextIndex++;
          activeCount++;
          const file = files[fileIndex];

          // Per-file wrapped onProgress (to add fileIndex tag)
          const wrappedOpts: CompressionOptions = {
            ...options,
            onProgress: (e: CompressionProgress) => {
              push({ fileIndex, progress: e });
              options.onProgress?.(e);
            },
          };

          svc.compress(file, wrappedOpts)
            .then((result) => {
              if (errored) return;
              results[fileIndex] = result;
            })
            .catch((err) => {
              if (errored) return;
              errored = true;
              error = err;
              isDone = true;
              // Wake up any pending next() so it can reject with the error.
              if (pendingResolve) {
                const r = pendingResolve;
                pendingResolve = null;
                r({ value: undefined as unknown as CompressAllStreamEvent, done: false });
              }
            })
            .finally(() => {
              activeCount--;
              completedCount++;
              if (!errored && completedCount === files.length) {
                // All done — emit final array
                push(results as CompressionResult[]);
                isDone = true;
              } else if (!errored) {
                // Launch next file
                launchNext();
              }
              // Wake up the iterator if waiting
              if (pendingResolve) {
                // Wake up the consumer's pending next() call so it can re-check state.
                // The next() implementation will check the queue first; if empty,
                // it will check error/done. This wakeup is a no-op data value.
                const r = pendingResolve;
                pendingResolve = null;
                r({ value: undefined as unknown as CompressAllStreamEvent, done: false });
              }
            });
        }
      };

      // Start the first batch
      launchNext();

      return {
        next(): Promise<IteratorResult<CompressAllStreamEvent>> {
          // Emit queued events
          if (queue.length > 0) {
            return Promise.resolve({ value: queue.shift()!, done: false });
          }
          // Throw stored error
          if (error !== null) {
            return Promise.reject(error);
          }
          // Done — no more events
          if (isDone) {
            return Promise.resolve({ value: undefined, done: true });
          }
          // Wait for next event
          return new Promise((resolve) => {
            pendingResolve = resolve;
          });
        },
        return(): Promise<IteratorResult<CompressAllStreamEvent>> {
          isDone = true;
          // Reject any pending consumer with a CompressionError
          if (pendingResolve) {
            const r = pendingResolve;
            pendingResolve = null;
            r({ value: undefined, done: true });
          }
          return Promise.resolve({ value: undefined, done: true });
        },
      };
    },
  };
}
