/**
 * Worker pool for parallel file-grep work.
 *
 * Lazy-initialized singleton: the first call to `getWorkerPool()`
 * spawns N workers via a Blob URL (for compatibility with
 * `bun build --compile`'s single-file binary — see
 * `grep-worker.js` for the worker body + rationale). Subsequent
 * calls reuse the pool.
 *
 * ### Lifetime
 *
 * Workers are kept ref'd — they hold the event loop open. The CLI
 * relies on `process.exit()` at the end of command execution to
 * tear them down; no explicit shutdown is required from callers.
 *
 * An earlier iteration `.unref()`'d each worker for "clean" exit,
 * but that caused a deadlock: when the main thread's only pending
 * work was a promise awaiting a worker result, unref'd workers
 * didn't process messages on idle ticks and the pipeline hung with
 * in-flight batches never settling.
 *
 * `terminatePool()` is provided for tests that need to reset the
 * singleton between cases; it's not part of the CLI shutdown path.
 *
 * ### Feature-gate
 *
 * `isWorkerSupported()` returns true only when `Worker`, `Blob`,
 * and `URL.createObjectURL` are available. The Bun runtime and
 * Bun-compiled binaries always pass this check; the Node library
 * bundle (`dist/index.cjs`) may or may not depending on the
 * consumer's Node version. We avoid depending on `bun:*` or
 * `Bun.*` APIs so the same code works in both runtimes.
 *
 * When unsupported, callers fall back to the async
 * `mapFilesConcurrent` path.
 */

import { availableParallelism } from "node:os";
// Raw-text import: Bun reads the file's contents at bundle time and
// exposes them as the module's default export (a string). The file
// is a real `.js` file (`grep-worker.js`) so it's lintable,
// syntax-checked, and easy to edit. At runtime we feed the string
// to a `Blob` + `URL.createObjectURL` to spawn workers. See
// `grep-worker.js` for full rationale.
//
// TypeScript's type system doesn't model Bun's `with { type: "text" }`
// attribute (the default export gets typed as the module's shape),
// so we cast through unknown. Guarded at startup by the runtime
// Blob constructor which would throw if given a non-string.
import grepWorkerSource from "./grep-worker.js" with { type: "text" };

const GREP_WORKER_SOURCE = grepWorkerSource as unknown as string;

import type { GrepMatch } from "./types.js";

/**
 * Batch dispatched to a worker. `paths` are absolute filesystem
 * paths the worker will `readFileSync`. `pathsBase` is the
 * relative-path prefix (usually the walker's `cwd + "/"`) that the
 * caller uses to reconstruct `GrepMatch.path` from
 * `pathsBase + absolutePath.slice(pathsBase.length)`.
 */
export type WorkerGrepRequest = {
  paths: string[];
  patternSource: string;
  flags: string;
  maxLineLength: number;
  maxMatchesPerFile: number;
  literal: string | null;
};

/**
 * Packed result from a single worker batch. Rehydrate via
 * `decodeWorkerMatches`.
 */
export type WorkerGrepResult = {
  /** Packed 4-u32-per-match (pathIdx, lineNum, lineOffset, lineLength). */
  ints: Uint32Array;
  /** Concatenated line text, indexed by `ints[i*4 + 2]` and `+3`. */
  linePool: string;
};

/**
 * Per-worker state. Dispatch queues requests FIFO per worker — we
 * can't use `addEventListener` per request because multiple
 * concurrent dispatches to the same worker would make their handlers
 * all fire on the first `result` message (they each match the
 * shape), resulting in the wrong `resolve()` getting called with
 * the wrong batch's data.
 *
 * Instead: one `onmessage` per worker, `pending` queue of resolvers,
 * shift the head on each `result` message.
 */
type PooledWorker = {
  worker: Worker;
  /** Promise that resolves once the worker signals `"ready"`. */
  ready: Promise<void>;
  /** Number of batches currently dispatched to this worker. */
  inflight: number;
  /**
   * Queue of pending result resolvers. Populated by `dispatch`,
   * drained in FIFO order by `worker.onmessage` as `result` messages
   * arrive. Workers process messages sequentially so FIFO matching
   * is sound.
   */
  pending: Array<{
    resolve: (r: WorkerGrepResult) => void;
    reject: (e: unknown) => void;
  }>;
  /**
   * False once the worker has emitted an `error` event. Dispatchers
   * skip dead workers — without this, the least-loaded selection
   * would favor a dead worker (its `inflight` gets reset to 0 in
   * the error handler), new dispatches would post to a worker that
   * can't respond, and the calling `grepViaWorkers` would deadlock
   * waiting for results that never arrive.
   */
  alive: boolean;
};

type WorkerPool = {
  workers: PooledWorker[];
  /**
   * Dispatch `request` to the least-loaded worker, returning a
   * promise that resolves when the worker posts its `"result"`.
   */
  dispatch(request: WorkerGrepRequest): Promise<WorkerGrepResult>;
  /**
   * Terminate all workers in the pool. Used by tests and on process
   * teardown. Safe to call multiple times.
   */
  terminate(): void;
};

/**
 * Module-level pool singleton. Lazily initialized on first
 * `getWorkerPool()` call. Cleared by `terminatePool()` (used by
 * tests).
 */
let pool: WorkerPool | null = null;

/**
 * True when the runtime supports Web-Workers-style `new Worker(url)`
 * with a Blob-URL source. Covers:
 *   - Bun (dev mode and single-file compiled binary)
 *   - Node 22+ when the library bundle is consumed (Node exposes
 *     `Worker` via the DOM shim in newer versions; older Node lacks
 *     it, so we fall back).
 */
export function isWorkerSupported(): boolean {
  return (
    typeof Worker !== "undefined" &&
    typeof Blob !== "undefined" &&
    typeof URL !== "undefined" &&
    typeof URL.createObjectURL === "function"
  );
}

/**
 * Default pool size: clamped to [2, 8] based on `availableParallelism()`.
 * Bench (synthetic/large, 10k files, `import.*from`): 4 workers hits
 * the knee (183ms p50 vs 171ms for 8 workers; 316ms for 2). Most
 * CLI hosts are 4–16 core, so clamping at 8 prevents over-spawn on
 * high-core boxes where per-worker stat/read contention dominates.
 */
export function getPoolSize(): number {
  return Math.max(2, Math.min(8, availableParallelism()));
}

/**
 * Call `worker.ref()` if the runtime exposes it. Both Bun's native
 * `Worker` and Node's `worker_threads.Worker` have `.ref()` / `.unref()`;
 * DOM Worker shims may not. Guarded.
 */
function refWorker(w: Worker): void {
  if (typeof (w as unknown as { ref?: () => void }).ref === "function") {
    (w as unknown as { ref: () => void }).ref();
  }
}

/** Counterpart to {@link refWorker}. */
function unrefWorker(w: Worker): void {
  if (typeof (w as unknown as { unref?: () => void }).unref === "function") {
    (w as unknown as { unref: () => void }).unref();
  }
}

/**
 * Build the worker's Blob-URL source once per pool. Cached so
 * repeated pool recreation (in tests) doesn't leak URLs.
 */
let cachedBlobUrl: string | null = null;
function getWorkerBlobUrl(): string {
  if (cachedBlobUrl !== null) {
    return cachedBlobUrl;
  }
  const blob = new Blob([GREP_WORKER_SOURCE], {
    type: "application/javascript",
  });
  cachedBlobUrl = URL.createObjectURL(blob);
  return cachedBlobUrl;
}

/**
 * Get or lazily create the worker pool. Throws if
 * `isWorkerSupported()` is false — callers should feature-gate
 * on that first.
 */
export function getWorkerPool(): WorkerPool {
  if (pool !== null) {
    return pool;
  }
  if (!isWorkerSupported()) {
    throw new Error(
      "Worker pool requested but Workers are unavailable in this runtime"
    );
  }

  const size = getPoolSize();
  const url = getWorkerBlobUrl();
  const workers: PooledWorker[] = [];

  for (let i = 0; i < size; i += 1) {
    const w = new Worker(url);
    // Workers are unref'd at spawn so an idle pool doesn't hold the
    // event loop open. On each `dispatch()` we `ref()` the worker
    // before posting work; when inflight drops to zero (i.e., the
    // worker goes idle), we `unref()` it again. This gives us:
    //
    //   - Clean CLI exit: once all pending dispatches settle,
    //     workers are idle + unref'd, the loop drains, and the
    //     process exits naturally — no `beforeExit` / explicit
    //     `terminatePool()` required on the CLI happy path.
    //   - No mid-pipeline deadlock: ref'd workers during active
    //     work means their `message` events fire on the main
    //     thread's next tick, not starved by idle-tick bypass.
    //
    // IMPORTANT: `Worker.ref()` / `.unref()` are idempotent booleans,
    // NOT reference-counted. Calling `unref()` on a worker that has
    // multiple dispatches in flight unrefs it entirely (subsequent
    // `ref()` calls are no-ops until the worker becomes idle again).
    // Hence the inflight-zero guard in every unref site — we only
    // unref when the LAST dispatch for this worker completes.
    unrefWorker(w);
    const pw: PooledWorker = {
      worker: w,
      ready: new Promise<void>((resolve) => {
        // Single readiness listener; removed when the ready signal
        // arrives. Subsequent messages are handled by `onmessage`
        // set below (which takes over after ready).
        const readyHandler = (event: MessageEvent) => {
          if (event.data?.type === "ready") {
            w.removeEventListener("message", readyHandler);
            resolve();
          }
        };
        w.addEventListener("message", readyHandler);
      }),
      inflight: 0,
      pending: [],
      alive: true,
    };
    // Single onmessage handler per worker. Matches `result` messages
    // to the oldest pending dispatch via FIFO shift. Messages from
    // the worker arrive in the same order as `postMessage` calls,
    // and the worker processes requests sequentially (single-thread
    // inside), so FIFO matching is sound.
    w.addEventListener("message", (event) => {
      const data = event.data as { type?: string } & WorkerGrepResult;
      if (data.type !== "result") {
        return;
      }
      const next = pw.pending.shift();
      if (!next) {
        return;
      }
      pw.inflight -= 1;
      // `ref()` / `unref()` are idempotent booleans, NOT reference-
      // counted. Only unref when the worker's own inflight drops to
      // zero — unrefing while other dispatches are still in flight
      // would let the event loop exit and drop their results.
      if (pw.inflight === 0) {
        unrefWorker(pw.worker);
      }
      next.resolve({ ints: data.ints, linePool: data.linePool });
    });
    w.addEventListener("error", (err) => {
      // Mark the worker dead before rejecting pending dispatches —
      // `dispatch` consults `alive` under the least-loaded picker to
      // avoid routing new work to a worker that can't respond.
      pw.alive = false;
      const errMsg = err.message ?? String(err);
      // Drain the pending queue: reject each dispatch. Then unref
      // the worker ONCE at the end (ref/unref are idempotent; one
      // unref is sufficient to release the event-loop hold even if
      // there were multiple pending dispatches).
      let slot = pw.pending.shift();
      while (slot !== undefined) {
        slot.reject(new Error(`worker error: ${errMsg}`));
        slot = pw.pending.shift();
      }
      pw.inflight = 0;
      unrefWorker(pw.worker);
    });
    workers.push(pw);
  }

  pool = {
    workers,
    dispatch(request: WorkerGrepRequest): Promise<WorkerGrepResult> {
      // Pick least-loaded LIVE worker. Dead workers (those that
      // emitted an `error` event) are skipped entirely — dispatching
      // to them would hang because they can't respond. Their
      // `inflight` gets reset to 0 in the error handler, which
      // would otherwise make them the "least loaded" and silently
      // capture all subsequent dispatches.
      let best: PooledWorker | null = null;
      for (const pw of workers) {
        if (!pw.alive) {
          continue;
        }
        if (best === null || pw.inflight < best.inflight) {
          best = pw;
        }
      }
      if (best === null) {
        return Promise.reject(new Error("worker pool: all workers dead"));
      }
      const chosen = best;
      chosen.inflight += 1;
      // Ref the worker while this dispatch is in flight. Matched by
      // the `unref()` call in the `message` result handler (or the
      // mass-unref in the `error` handler / `terminate()` path).
      refWorker(chosen.worker);

      // Enqueue a pending slot for this request. The worker's
      // `onmessage` handler will resolve it when the corresponding
      // `result` message arrives (FIFO).
      const result = new Promise<WorkerGrepResult>((resolve, reject) => {
        chosen.pending.push({ resolve, reject });
      });
      // Wait for readiness (first dispatch only), then post the
      // request. Subsequent dispatches skip the await (the ready
      // promise is already settled).
      chosen.ready.then(
        () => {
          chosen.worker.postMessage(request);
        },
        (err) => {
          // Readiness failed — fail this dispatch's resolver. Only
          // unref if no other dispatches are in flight (same
          // reasoning as the `message` handler: `unref()` is
          // idempotent and unrefing while others are in flight
          // would let the loop exit prematurely).
          const slot = chosen.pending.pop();
          if (slot) {
            chosen.inflight -= 1;
            if (chosen.inflight === 0) {
              unrefWorker(chosen.worker);
            }
            slot.reject(err);
          }
        }
      );
      return result;
    },
    terminate(): void {
      for (const pw of workers) {
        pw.alive = false;
        // Drain pending: reject every dispatch. `ref`/`unref` are
        // idempotent booleans — one unref at the end is sufficient
        // to release the event-loop hold even if the worker had
        // multiple pending dispatches.
        let slot = pw.pending.shift();
        while (slot !== undefined) {
          slot.reject(new Error("worker pool terminated"));
          slot = pw.pending.shift();
        }
        pw.inflight = 0;
        unrefWorker(pw.worker);
        try {
          pw.worker.terminate();
        } catch {
          // Ignore — terminate is experimental in Bun and may throw
          // on already-terminated workers.
        }
      }
    },
  };

  return pool;
}

/**
 * Tear down the singleton pool. Primarily for tests — the
 * singleton is otherwise kept alive for the process lifetime.
 */
export function terminatePool(): void {
  if (pool !== null) {
    pool.terminate();
    pool = null;
  }
  if (cachedBlobUrl !== null) {
    // URL.revokeObjectURL is safe to call on Node + Bun.
    URL.revokeObjectURL(cachedBlobUrl);
    cachedBlobUrl = null;
  }
}

/**
 * Decode a worker's packed `{ints, linePool}` into an array of
 * `GrepMatch`es, using the caller's `paths` and `relPaths` to
 * reconstruct path fields.
 *
 * Optional `mtimes` is a parallel per-path array: when provided,
 * each emitted `GrepMatch` gets an `mtime` field indexed by the
 * match's `pathIdx`. Populated by callers that set
 * `recordMtimes: true` — the mtime is known on the main thread
 * from the walker, not from the worker.
 */
export function decodeWorkerMatches(
  result: WorkerGrepResult,
  paths: readonly string[],
  relPaths: readonly string[],
  mtimes: readonly number[] | null = null
): GrepMatch[] {
  const { ints, linePool } = result;
  const matches: GrepMatch[] = [];
  // 4 u32s per match (pathIdx, lineNum, lineOffset, lineLength).
  const count = Math.floor(ints.length / 4);
  for (let i = 0; i < count; i += 1) {
    const base = i * 4;
    const pathIdx = ints[base] ?? 0;
    const lineNum = ints[base + 1] ?? 0;
    const lineOffset = ints[base + 2] ?? 0;
    const lineLength = ints[base + 3] ?? 0;
    const absolutePath = paths[pathIdx] ?? "";
    const relativePath = relPaths[pathIdx] ?? absolutePath;
    const line = linePool.slice(lineOffset, lineOffset + lineLength);
    const match: GrepMatch = {
      path: relativePath,
      absolutePath,
      lineNum,
      line,
    };
    if (mtimes !== null) {
      match.mtime = mtimes[pathIdx];
    }
    matches.push(match);
  }
  return matches;
}
