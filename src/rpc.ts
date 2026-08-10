/**
 * Minimal Worker RPC — a zero-dependency replacement for Comlink.
 *
 * Protocol (all over postMessage, structured-clone safe):
 *   main → worker:  { id, method, args }                    (a method call)
 *   worker → main:  { id, ok: true, result }                (success)
 *   worker → main:  { id, ok: false, error: string }        (failure)
 *   worker → main:  { __event: true, id, event }            (progress callback event)
 *
 * Design notes vs Comlink:
 * - Comlink.proxy(onProgress) creates a dedicated MessageChannel per
 *   callback. This implementation registers callbacks in a plain Map and
 *   routes events over the SAME worker channel — one less channel, no
 *   channel teardown, marginally less overhead.
 * - Comlink uses the `endpoint` marker + Proxy.get intercept. We use an
 *   explicit `wrap()` proxy that posts method calls keyed by numeric id.
 * - No transferable handling needed here: the lib's worker only ever
 *   exchanges File/Blob (structured-clone) and plain objects.
 *
 * Bundle cost: ~1KB minified (vs Comlink ~5KB). Zero dependencies.
 */

/** Marker for a callback reference passed through postMessage. */
interface CallbackRef {
  __callbackId: number;
}

const callbackRegistry = new Map<number, (event: unknown) => void>();
let nextCallbackId = 1;

/**
 * Worker side: expose an API object to the main thread.
 * Listens on `self.onmessage` and dispatches `{id, method, args}` calls.
 *
 * @param api Object whose methods become callable from the main thread
 */
export function expose<T extends object>(api: T): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ctx = self as unknown as { onmessage: ((ev: MessageEvent) => void) | null };
  ctx.onmessage = async (ev: MessageEvent) => {
    const { id, method, args } = (ev.data ?? {}) as {
      id?: number;
      method?: string;
      args?: unknown[];
    };
    if (id === undefined || typeof method !== 'string') return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fn = (api as any)[method];
    if (typeof fn !== 'function') {
      postMessage({ id, ok: false, error: `Unknown method: ${method}` });
      return;
    }
    try {
      const result = await fn(...(args ?? []));
      postMessage({ id, ok: true, result });
    } catch (err) {
      postMessage({
        id,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };
}

/**
 * Main thread side: wrap a Worker so its exposed methods are callable as
 * async functions.
 *
 * @param worker The Worker instance (or any postMessage/onmessage pair)
 * @returns A proxy object — `proxy.method(...args)` posts the call and
 *   resolves with the result.
 */
export function wrap<T extends object>(worker: Worker): T {
  const pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
  let nextId = 1;

  worker.onmessage = (ev: MessageEvent) => {
    const msg = (ev.data ?? {}) as {
      id?: number;
      ok?: boolean;
      result?: unknown;
      error?: string;
      __event?: boolean;
      event?: unknown;
    };
    // Progress callback events are NOT tied to a pending call — they arrive
    // asynchronously while a long-running method executes.
    if (msg.__event === true && msg.id !== undefined) {
      const cb = callbackRegistry.get(msg.id);
      if (cb) cb(msg.event);
      return;
    }
    if (msg.id === undefined) return;
    const entry = pending.get(msg.id);
    if (!entry) return;
    pending.delete(msg.id);
    if (msg.ok) {
      entry.resolve(msg.result);
    } else {
      entry.reject(new Error(msg.error ?? 'Worker RPC failed'));
    }
  };

  return new Proxy({} as T, {
    get(_target, prop) {
      if (typeof prop !== 'string' || prop === 'then') return undefined;
      return (...args: unknown[]) => {
        const id = nextId++;
        // Serialize callbacks → CallbackRef so postMessage stays structured-clone safe
        const serialized = args.map((arg) =>
          typeof arg === 'function'
            ? registerCallback(arg as (event: unknown) => void)
            : arg,
        );
        worker.postMessage({ id, method: prop, args: serialized });
        return new Promise((resolve, reject) => {
          pending.set(id, { resolve, reject });
        });
      };
    },
  });
}

/** Register a callback, return its ref for postMessage. */
function registerCallback(fn: (event: unknown) => void): CallbackRef {
  const id = nextCallbackId++;
  callbackRegistry.set(id, fn);
  return { __callbackId: id };
}
/**
 * Worker side: convert a CallbackRef (received via postMessage) into a
 * callable function that emits events back to the main thread.
 */
export function callbackOf<TEvent = unknown>(
  ref: unknown,
): ((event: TEvent) => void) | undefined {
  if (ref === undefined || ref === null) return undefined;
  const cbId = (ref as CallbackRef).__callbackId;
  if (typeof cbId !== 'number') return undefined;
  return (event: TEvent) => {
    postMessage({ __event: true, id: cbId, event });
  };
}

/**
 * Worker side: same as callbackOf but returns a no-op when no callback
 * was passed — keeps call sites free of `?.` churn.
 */
export function callbackOrNoop<TEvent = unknown>(
  ref: unknown,
): (event: TEvent) => void {
  return callbackOf<TEvent>(ref) ?? (() => {});
}
