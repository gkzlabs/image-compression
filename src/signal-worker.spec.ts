/**
 * v1.1.1 regression: AbortSignal must NOT travel to the worker.
 *
 * Caught live on compress.gkz.info (2026-08-12): the demo's Cancel button
 * passes `signal` in CompressionOptions — the worker RPC postMessage then
 * threw `DataCloneError: The object can not be cloned` (AbortSignal is not
 * structured-cloneable), so webcodecs-worker AND offscreen-worker both
 * failed and the cascade silently fell back to canvas-main.
 *
 * These tests simulate the browser's structured-clone in the fake worker's
 * postMessage — if a non-cloneable value ever leaks into the RPC message,
 * structuredClone() throws exactly like the real browser and the test fails.
 */
import { describe, it, expect } from 'vitest';
import { wrap } from './rpc';
import { ImageCompression } from './service';
import type { CompressionOptions } from './types';

/** Fake Worker whose postMessage structured-clones (like the browser) then replies. */
function makeCloneCheckingWorker(received: unknown[]) {
  let handler: ((ev: MessageEvent) => void) | null = null;
  const fake: Record<string, unknown> = {
    postMessage(msg: unknown) {
      // THE regression check: real browsers clone the message before dispatch.
      structuredClone(msg);
      received.push(msg);
      const m = msg as { id: number; method: string };
      setTimeout(() => {
        handler?.({
          data: {
            id: m.id,
            ok: true,
            result: {
              blob: new Blob(['x'], { type: 'image/jpeg' }),
              width: 1,
              height: 1,
              mimeType: 'image/jpeg',
            },
          },
        } as MessageEvent);
      }, 0);
    },
  };
  Object.defineProperty(fake, 'onmessage', {
    get: () => handler,
    set: (fn: ((ev: MessageEvent) => void) | null) => {
      handler = fn;
    },
  });
  return fake;
}

describe('v1.1.1: AbortSignal is stripped before worker postMessage', () => {
  it('offscreen-worker path succeeds with a signal in options (no DataCloneError)', async () => {
    const received: unknown[] = [];
    const workerApi = wrap<{ compress(...a: unknown[]): Promise<unknown> }>(
      makeCloneCheckingWorker(received) as unknown as Worker,
    );
    const svc = new ImageCompression();
    (svc as unknown as { getWorker: () => Promise<unknown> }).getWorker = async () => workerApi;

    const file = new File([new Uint8Array([1, 2, 3])], 't.jpg', { type: 'image/jpeg' });
    const options: CompressionOptions = {
      quality: 0.8,
      signal: new AbortController().signal,
    };
    const result = await (
      svc as unknown as {
        executeWorkerPath(
          f: File,
          o: CompressionOptions,
          p: string,
        ): Promise<unknown>;
      }
    ).executeWorkerPath(file, options, 'offscreen-worker');

    expect(result).toBeTruthy();
    // The posted RPC args[1] (workerOptions) must NOT contain the signal.
    const postedArgs = (received[0] as { args: unknown[] }).args;
    expect(postedArgs[1]).not.toHaveProperty('signal');
    // Sanity: quality survives the strip.
    expect((postedArgs[1] as CompressionOptions).quality).toBe(0.8);
  });

  it('webcodecs-worker path (default cascade) also survives a signal', async () => {
    const received: unknown[] = [];
    const workerApi = wrap<{ compress(...a: unknown[]): Promise<unknown> }>(
      makeCloneCheckingWorker(received) as unknown as Worker,
    );
    const svc = new ImageCompression();
    (svc as unknown as { getWorker: () => Promise<unknown> }).getWorker = async () => workerApi;

    const file = new File([new Uint8Array([4, 5])], 't.jpg', { type: 'image/jpeg' });
    const result = await (
      svc as unknown as {
        executeWorkerPath(
          f: File,
          o: CompressionOptions,
          p: string,
        ): Promise<unknown>;
      }
    ).executeWorkerPath(
      file,
      { signal: new AbortController().signal, format: 'image/webp' },
      'webcodecs-worker',
    );

    expect(result).toBeTruthy();
    const postedArgs = (received[0] as { args: unknown[] }).args;
    expect(postedArgs[1]).not.toHaveProperty('signal');
  });
});
