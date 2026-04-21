/**
 * Worker pool for parallel file-grep work.
 *
 * Lazy-initialized singleton: the first call to `getWorkerPool()`
 * spawns N workers via a Blob URL (for compatibility with
 * `bun build --compile`'s single-file binary — see
 * `grep-worker-source.ts`). Subsequent calls reuse the pool.
 *
 * Workers are `.unref()`'d so the CLI exits cleanly without an
 * explicit shutdown — they'll be torn down by the runtime when the
 * main process ends.
 *
 * ### Feature-gate
 *
 * `isWorkerSupported()` returns true only when `Worker` and `Blob`
 * + `URL.createObjectURL` are available. On the Node library bundle
 * (`dist/index.cjs`), these globals exist (Node provides them via
 * `worker_threads` aliases in Bun, and Node 22+ has `Blob` /
 * `createObjectURL`). We avoid depending on `bun:*` or `Bun.*` APIs
 * so the same code works in both runtimes.
 *
 * When unsupported, callers fall back to the current async
 * `mapFilesConcurrent` path.
 */

import { availableParallelism } from "node:os";
import { GREP_WORKER_SOURCE } from "./grep-worker-source.js";
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
    // Note: NOT calling .unref() — when multiple dispatches are
    // in-flight but the main thread only has promise waits pending,
    // unref'd workers don't process messages on idle ticks, causing
    // deadlock. The CLI explicitly terminates the pool at exit via
    // `terminatePool()` so this doesn't leak.
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
      next.resolve({ ints: data.ints, linePool: data.linePool });
    });
    w.addEventListener("error", (err) => {
      // Mark the worker dead before rejecting pending dispatches —
      // `dispatch` consults `alive` under the least-loaded picker to
      // avoid routing new work to a worker that can't respond.
      pw.alive = false;
      const errMsg = err.message ?? String(err);
      while (pw.pending.length > 0) {
        const p = pw.pending.shift();
        p?.reject(new Error(`worker error: ${errMsg}`));
      }
      pw.inflight = 0;
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
          // Readiness failed — fail this dispatch's resolver.
          const slot = chosen.pending.pop();
          if (slot) {
            chosen.inflight -= 1;
            slot.reject(err);
          }
        }
      );
      return result;
    },
    terminate(): void {
      for (const pw of workers) {
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
