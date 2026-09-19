/**
 * Tests for the zero-dependency Worker RPC layer (src/rpc.ts).
 *
 * v0.11.0: replaced Comlink with this in-repo protocol. These tests verify
 * the full message flow WITHOUT a real Worker — we simulate the two halves
 * with a fake Worker object whose postMessage feeds the other side's
 * onmessage directly (in-memory transport).
 *
 * Coverage:
 * - Method call roundtrip: main → worker → result back
 * - Error propagation: worker throws → main rejects
 * - Async methods (promise resolution before reply)
 * - Progress callbacks: function arg → CallbackRef → events routed back
 * - Multiple concurrent calls: id mapping doesn't cross wires
 * - Unknown method: worker replies with an error
 * - 'then' trap guard: proxy is not treated as a thenable
 */
import { describe, it, expect, vi } from 'vitest';
import { expose, wrap, callbackOf, __callbackRegistrySize } from './rpc';

interface TestApi {
  add(a: number, b: number): Promise<number>;
  fail(): Promise<never>;
  slow(): Promise<string>;
  emitProgress(cb?: (e: { step: number }) => void): Promise<void>;
  ping(): Promise<string>;
}

/**
 * Build a fake Worker pair: `mainWorker` is what the main thread wraps,
 * `workerApi` is what the worker exposes. Messages flow through an
 * in-memory channel (the same object both sides share).
 */
function makePair(api: TestApi) {
  // In-memory transport: postMessage on one side invokes the other's onmessage
  let mainOnMessage: ((ev: MessageEvent) => void) | null = null;
  let workerOnMessage: ((ev: MessageEvent) => void) | null = null;

  // Worker half
  const workerCtx = {
    onmessage: null as ((ev: MessageEvent) => void) | null,
  };
  // Run expose() in a worker-like context: it assigns workerCtx.onmessage.
  // rpc.expose uses `self` — stub it.
  const origSelf = (globalThis as Record<string, unknown>)['self'];
  (globalThis as Record<string, unknown>)['self'] = workerCtx;
  expose(api);
  (globalThis as Record<string, unknown>)['self'] = origSelf;
  workerOnMessage = workerCtx.onmessage;

  // Main half: a fake Worker with postMessage that feeds workerOnMessage,
  // and an onmessage setter that records mainOnMessage.
  const fakeWorker = {
    postMessage(msg: unknown) {
      // Deliver to worker side
      const ev = { data: msg } as MessageEvent;
      // Defer so promise chains settle like real postMessage (async)
      queueMicrotask(() => workerOnMessage?.(ev));
    },
    set onmessage(fn: ((ev: MessageEvent) => void) | null) {
      mainOnMessage = fn;
    },
    get onmessage() {
      return mainOnMessage;
    },
    terminate() {},
  } as unknown as Worker;

  // Patch worker side to deliver replies back to main via the same channel:
  // override the worker's postMessage (used by rpc.expose replies) to feed
  // the main thread's onmessage.
  const workerPostMessage = (msg: unknown) => {
    const ev = { data: msg } as MessageEvent;
    queueMicrotask(() => mainOnMessage?.(ev));
  };
  // rpc.expose posts via global postMessage — stub it during the test
  const origPost = (globalThis as Record<string, unknown>)['postMessage'];
  (globalThis as Record<string, unknown>)['postMessage'] = workerPostMessage;
  const restore = () => {
    (globalThis as Record<string, unknown>)['postMessage'] = origPost;
  };

  return { fakeWorker, workerPostMessage, restore };
}

describe('v0.11.0 rpc layer (comlink replacement)', () => {
  it('resolves a method call roundtrip', async () => {
    const api: TestApi = {
      async add(a, b) {
        return a + b;
      },
      async fail() {
        throw new Error('boom');
      },
      async slow() {
        return 'done';
      },
      async emitProgress() {},
      async ping() {
        return 'pong';
      },
    };
    const { fakeWorker, restore } = makePair(api);
    try {
      const proxy = wrap<TestApi>(fakeWorker);
      const result = await proxy.add(2, 3);
      expect(result).toBe(5);
    } finally {
      restore();
    }
  });

  it('rejects when the worker method throws', async () => {
    const api: TestApi = {
      async add() {
        return 0;
      },
      async fail() {
        throw new Error('boom');
      },
      async slow() {
        return '';
      },
      async emitProgress() {},
      async ping() {
        return '';
      },
    };
    const { fakeWorker, restore } = makePair(api);
    try {
      const proxy = wrap<TestApi>(fakeWorker);
      await expect(proxy.fail()).rejects.toThrow('boom');
    } finally {
      restore();
    }
  });

  it('handles concurrent calls without crossing wires', async () => {
    const api: TestApi = {
      async add(a, b) {
        // Simulate variable latency: bigger sum takes longer
        await new Promise((r) => setTimeout(r, a * 5));
        return a + b;
      },
      async fail() {
        throw new Error('x');
      },
      async slow() {
        return '';
      },
      async emitProgress() {},
      async ping() {
        return '';
      },
    };
    const { fakeWorker, restore } = makePair(api);
    try {
      const proxy = wrap<TestApi>(fakeWorker);
      const [r1, r2, r3] = await Promise.all([
        proxy.add(1, 1),
        proxy.add(2, 2),
        proxy.add(100, 1),
      ]);
      expect(r1).toBe(2);
      expect(r2).toBe(4);
      expect(r3).toBe(101);
    } finally {
      restore();
    }
  });

  it('routes progress callback events back to the caller', async () => {
    const events: { step: number }[] = [];
    const api: TestApi = {
      async add() {
        return 0;
      },
      async fail() {
        throw new Error('x');
      },
      async slow() {
        return '';
      },
      async emitProgress(cb) {
        // cb arrives as a CallbackRef — resolve with callbackOf
        const emit = callbackOf<{ step: number }>(cb);
        emit?.({ step: 1 });
        emit?.({ step: 2 });
        emit?.({ step: 3 });
      },
      async ping() {
        return '';
      },
    };
    const { fakeWorker, restore } = makePair(api);
    try {
      const proxy = wrap<TestApi>(fakeWorker);
      await proxy.emitProgress((e) => events.push(e));
      expect(events).toEqual([{ step: 1 }, { step: 2 }, { step: 3 }]);
    } finally {
      restore();
    }
  });

  it('no-ops when a callback ref is absent (callbackOrNoop path)', async () => {
    const api: TestApi = {
      async add() {
        return 0;
      },
      async fail() {
        throw new Error('x');
      },
      async slow() {
        return '';
      },
      async emitProgress(cb) {
        const emit = callbackOf<{ step: number }>(cb);
        expect(emit).toBeUndefined(); // no callback passed → nothing to emit to
      },
      async ping() {
        return '';
      },
    };
    const { fakeWorker, restore } = makePair(api);
    try {
      const proxy = wrap<TestApi>(fakeWorker);
      await proxy.emitProgress(undefined); // no callback
    } finally {
      restore();
    }
  });

  it('rejects with an error for unknown methods', async () => {
    const api: TestApi = {
      async add() {
        return 0;
      },
      async fail() {
        throw new Error('x');
      },
      async slow() {
        return '';
      },
      async emitProgress() {},
      async ping() {
        return '';
      },
    };
    const { fakeWorker, restore } = makePair(api);
    try {
      const proxy = wrap<TestApi>(fakeWorker);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await expect((proxy as any).nonexistent()).rejects.toThrow(/Unknown method/);
    } finally {
      restore();
    }
  });

  it('proxy is not accidentally treated as a thenable (async/await safe)', async () => {
    const api: TestApi = {
      async add() {
        return 0;
      },
      async fail() {
        throw new Error('x');
      },
      async slow() {
        return '';
      },
      async emitProgress() {},
      async ping() {
        return 'pong';
      },
    };
    const { fakeWorker, restore } = makePair(api);
    try {
      const proxy = wrap<TestApi>(fakeWorker);
      // Awaiting the proxy itself must NOT hang (no .then interception).
      // A non-thenable awaits to its own value ({}) — the point is it
      // resolves immediately instead of deadlocking.
      const value = await (proxy as unknown as Promise<unknown>);
      expect(value).toBeDefined();
      // And normal methods still work afterwards
      expect(await proxy.ping()).toBe('pong');
    } finally {
      restore();
    }
  });

  it('spy: wrap posts structured-clone-safe args (functions become refs)', async () => {
    const posted: unknown[] = [];
    const api: TestApi = {
      async add() {
        return 0;
      },
      async fail() {
        throw new Error('x');
      },
      async slow() {
        return '';
      },
      async emitProgress() {},
      async ping() {
        return '';
      },
    };
    const { fakeWorker, restore } = makePair(api);
    try {
      const origPost = fakeWorker.postMessage.bind(fakeWorker);
      fakeWorker.postMessage = (msg: unknown) => {
        posted.push(msg);
        return origPost(msg);
      };
      const proxy = wrap<TestApi>(fakeWorker);
      await proxy.emitProgress(() => {});
      const msg = posted[0] as { method: string; args: unknown[] };
      expect(msg.method).toBe('emitProgress');
      expect(typeof msg.args[0]).toBe('object'); // CallbackRef, not a function
      expect((msg.args[0] as { __callbackId: number }).__callbackId).toBeTypeOf('number');
    } finally {
      restore();
    }
  });

  it('rejects pending calls when the worker errors (e.g. worker URL 404s)', async () => {
    // A worker that never loaded cannot reply — before this guard the RPC
    // promise stayed pending forever, so compress() never settled and the
    // cascade never fell back to canvas-main.
    const listeners = new Map<string, ((ev: unknown) => void)[]>();
    const silentWorker = {
      postMessage() {
        /* never replies */
      },
      terminate() {},
      addEventListener(type: string, fn: (ev: unknown) => void) {
        listeners.set(type, [...(listeners.get(type) ?? []), fn]);
      },
    } as unknown as Worker;

    const proxy = wrap<TestApi>(silentWorker);
    const pending = proxy.ping();
    listeners.get('error')?.forEach((fn) => fn({ message: 'worker load failed' }));
    await expect(pending).rejects.toThrow(/failed to load/i);
  });

  it('rejects pending calls on messageerror (undeserializable worker reply)', async () => {
    const listeners = new Map<string, ((ev: unknown) => void)[]>();
    const silentWorker = {
      postMessage() {
        /* never replies */
      },
      terminate() {},
      addEventListener(type: string, fn: (ev: unknown) => void) {
        listeners.set(type, [...(listeners.get(type) ?? []), fn]);
      },
    } as unknown as Worker;

    const proxy = wrap<TestApi>(silentWorker);
    const pending = proxy.ping();
    listeners.get('messageerror')?.forEach((fn) => fn({}));
    await expect(pending).rejects.toThrow(/deserialized/i);
  });

  it('exposes __dispose() to settle in-flight calls before the worker is killed', async () => {
    // Worker.terminate() drops pending RPCs on the floor — without __dispose a
    // dispose()/terminate() during an in-flight compress() hangs forever.
    const silentWorker = {
      postMessage() {
        /* never replies */
      },
      terminate() {},
      addEventListener() {},
    } as unknown as Worker;

    const proxy = wrap<TestApi>(silentWorker) as TestApi & { __dispose: (reason?: Error) => void };
    const pending = proxy.ping();
    expect(typeof proxy.__dispose).toBe('function');
    proxy.__dispose(new Error('Worker terminated by test'));
    await expect(pending).rejects.toThrow(/terminated by test/i);
  });

  it('does not post __dispose to the worker (local control method only)', () => {
    const posted: unknown[] = [];
    const fakeWorker = {
      postMessage(msg: unknown) {
        posted.push(msg);
      },
      terminate() {},
      addEventListener() {},
    } as unknown as Worker;

    const proxy = wrap<TestApi>(fakeWorker) as TestApi & { __dispose: () => void };
    proxy.__dispose();
    expect(posted).toHaveLength(0);
  });

  it('releases the progress callback when the call settles (no registry leak)', async () => {
    const api: TestApi = {
      async add(a, b) {
        return a + b;
      },
      async fail() {
        throw new Error('nope');
      },
      async slow() {
        return 'x';
      },
      // The worker receives the callback as a CallbackRef ({__callbackId}), not
      // as a function — this test only cares about registry lifecycle.
      async emitProgress() {},
      async ping() {
        return 'pong';
      },
    };
    const { fakeWorker, restore } = makePair(api);
    try {
      const proxy = wrap<TestApi>(fakeWorker);
      const before = __callbackRegistrySize();
      for (let i = 0; i < 25; i++) {
        await proxy.emitProgress(() => {});
      }
      // Each call registers one callback; all of them must be released on
      // settle, otherwise a long upload session grows the map without bound.
      expect(__callbackRegistrySize()).toBe(before);
      await expect(proxy.fail()).rejects.toThrow('nope');
      expect(__callbackRegistrySize()).toBe(before);
    } finally {
      restore();
    }
  });
});
