/**
 * Workflow client shim.
 *
 * The init server migrated from the Mastra workflow engine to Vercel Workflows,
 * which exposes a different HTTP protocol:
 *   - POST /api/wizard          -> { runId }
 *   - GET  /api/run?runId=...    -> run status + the pending tool/interactive request
 *   - POST /api/resume           -> { token, result }
 *
 * The wizard runner was written against the Mastra client
 * (`client.getWorkflow(id).createRun()` / `run.startAsync()` /
 * `run.resumeAsync()` / `workflow.runById()` returning a `WorkflowRunResult`).
 * Rather than rewrite that ~1300-line loop, this shim presents the same surface
 * while speaking the new protocol underneath, mapping the server's
 * `{ status, seq, request }` shape onto `WorkflowRunResult`.
 *
 * Suspend token: the server addresses each suspend point with a deterministic
 * hook token `wizard:<runId>:<seq>`. We reconstruct it from the runId returned
 * by /api/wizard and the `seq` reported by /api/run, so `resumeAsync` can target
 * the exact hook. The token is never received from the server — knowing
 * (runId, seq) plus the Bearer auth is what authorizes the resume.
 */

import { logger } from "../logger.js";
import type { SuspendPayload, WorkflowRunResult } from "./types.js";

const POLL_INTERVAL_MS = 1000;
const POLL_TIMEOUT_MS = 300_000;

/** Scoped diagnostic logger. Surfaced with `--verbose` / `--log-level=debug`. */
const log = logger.withTag("wizard-client");

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

type RunStatePayload = {
  status: "running" | "suspended" | "success" | "failed";
  seq?: number;
  request?: SuspendPayload;
  result?: WorkflowRunResult["result"];
  error?: string;
};

export type WorkflowRun = {
  /**
   * The run id. Empty until `startAsync` returns, because the new server assigns
   * it when the run starts (unlike Mastra, which minted it at createRun time).
   */
  readonly runId: string;
  startAsync(args: {
    inputData: Record<string, unknown>;
    initialState?: Record<string, unknown>;
    tracingOptions?: Record<string, unknown>;
  }): Promise<WorkflowRunResult>;
  resumeAsync(args: {
    step: string;
    resumeData: Record<string, unknown>;
    tracingOptions?: Record<string, unknown>;
  }): Promise<WorkflowRunResult>;
  /**
   * Sync the run's internal suspend-point sequence counter from a recovered
   * result. Called after `workflow.runById()` fetches state through its own
   * isolated `seqRef` — without this, the next `resumeAsync` would build a
   * stale token targeting the wrong hook.
   */
  updateSeq(seq: number): void;
};

export type WorkflowHandle = {
  createRun(): Promise<WorkflowRun>;
  runById(
    runId: string,
    opts?: { fields?: string[] }
  ): Promise<WorkflowRunResult>;
};

export type WorkflowClientOptions = {
  baseUrl: string;
  headers?: Record<string, string>;
  fetch: FetchLike;
  abortSignal?: AbortSignal;
};

/**
 * Synthesize a step id from a request so the runner's UI/labels and recovery
 * logic keep working. Tool requests map to their operation; interactive
 * requests to their kind.
 */
function stepIdForRequest(request: SuspendPayload): string {
  if (request.type === "tool") {
    return request.operation;
  }
  return `interactive-${request.kind}`;
}

/** Map the server's run-state payload onto the Mastra `WorkflowRunResult` shape. */
function toWorkflowRunResult(
  state: RunStatePayload,
  seqRef: { current: number }
): WorkflowRunResult {
  if (state.status === "success") {
    return { status: "success", result: state.result };
  }
  if (state.status === "failed") {
    return { status: "failed", error: state.error };
  }
  if (state.status === "suspended" && state.request) {
    if (typeof state.seq === "number") {
      seqRef.current = state.seq;
    }
    const stepId = stepIdForRequest(state.request);
    return {
      status: "suspended",
      suspended: [[stepId]],
      suspendPayload: state.request,
      steps: { [stepId]: { suspendPayload: state.request } },
      _seq: seqRef.current,
    };
  }
  // "running" — represented as suspended-less; the caller keeps polling.
  return { status: "suspended", suspended: [] };
}

const MAX_ERROR_DETAIL_LEN = 500;
const HTML_BODY_RE = /<html|<!doctype/i;
const ERROR_LINE_RE = /\b[A-Z]\w*Error\b[^<\n]*/;
const WHITESPACE_RE = /\s+/g;

/**
 * Reduce an error response body to a short, human-useful message.
 *
 * The server may return JSON (`{ "error": "..." }`), a plain string, or — when a
 * dev server crashes — a large HTML error page (e.g. Bun's fallback overlay). We
 * never surface the raw HTML/markup, so extract the meaningful bit and cap the
 * length.
 */
function extractErrorDetail(body: string): string {
  const trimmed = body.trim();
  if (!trimmed) {
    return "(empty response)";
  }

  // JSON error envelope from our own API.
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as { error?: unknown };
      if (typeof parsed.error === "string" && parsed.error) {
        return truncate(parsed.error);
      }
    } catch {
      // fall through
    }
  }

  // HTML error page (e.g. a crashed dev server) — pull the first meaningful
  // "<Something>Error: message" line out of the markup instead of dumping it.
  if (HTML_BODY_RE.test(trimmed)) {
    const match = trimmed.match(ERROR_LINE_RE);
    return truncate(
      match
        ? match[0]
        : "server returned an HTML error page (is the dev server crashing?)"
    );
  }

  return truncate(trimmed);
}

function truncate(s: string): string {
  const oneLine = s.replace(WHITESPACE_RE, " ").trim();
  return oneLine.length > MAX_ERROR_DETAIL_LEN
    ? `${oneLine.slice(0, MAX_ERROR_DETAIL_LEN)}…`
    : oneLine;
}

/** One-line description of a run state for debug logs. */
function describeRunState(state: RunStatePayload): string {
  const parts = [`status=${state.status}`];
  if (state.seq !== undefined) {
    parts.push(`seq=${state.seq}`);
  }
  if (state.request?.type === "tool") {
    parts.push(`op=${state.request.operation}`);
  } else if (state.request?.type === "interactive") {
    parts.push(`kind=${state.request.kind}`);
  }
  return parts.join(" ");
}

export function createWorkflowClient(options: WorkflowClientOptions): {
  getWorkflow(id: string): WorkflowHandle;
} {
  const { baseUrl, headers = {}, fetch, abortSignal } = options;

  log.debug(`workflow client targeting ${baseUrl}`);

  const jsonHeaders = { "content-type": "application/json", ...headers };

  async function post(
    path: string,
    body: unknown
  ): Promise<Record<string, unknown>> {
    log.debug(`POST ${baseUrl}${path}`);
    const res = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify(body),
      signal: abortSignal,
    });
    if (!res.ok) {
      const rawBody = await res.text();
      const detail = extractErrorDetail(rawBody);
      log.debug(`POST ${path} failed: ${res.status}`, detail);
      throw new Error(`HTTP error! status: ${res.status} - ${detail}`);
    }
    log.debug(`POST ${path} -> ${res.status}`);
    return (await res.json()) as Record<string, unknown>;
  }

  async function getRunState(runId: string): Promise<RunStatePayload> {
    const url = `${baseUrl}/api/run?runId=${encodeURIComponent(runId)}`;
    const res = await fetch(url, {
      method: "GET",
      headers,
      signal: abortSignal,
    });
    if (!res.ok) {
      const detail = extractErrorDetail(await res.text());
      log.debug(`GET /api/run failed: ${res.status}`, detail);
      throw new Error(`HTTP error! status: ${res.status} - ${detail}`);
    }
    const state = (await res.json()) as RunStatePayload;
    log.debug(`GET /api/run -> ${describeRunState(state)}`);
    return state;
  }

  /**
   * Poll /api/run until the run leaves the transient "running" state, i.e. it is
   * suspended on a request, has succeeded, or has failed.
   */
  async function pollUntilSettled(
    runId: string,
    seqRef: { current: number }
  ): Promise<WorkflowRunResult> {
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    let polls = 0;
    for (;;) {
      const state = await getRunState(runId);
      if (state.status !== "running") {
        log.debug(
          `run ${runId} settled as "${state.status}" after ${polls} poll(s)`
        );
        return toWorkflowRunResult(state, seqRef);
      }
      polls += 1;
      if (Date.now() > deadline) {
        throw new Error(
          `Workflow polling timed out after ${polls} poll(s) (run ${runId})`
        );
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  }

  function makeRun(): WorkflowRun {
    const seqRef = { current: -1 };
    // The server assigns the run id when the run starts. `createRun()` cannot
    // pre-mint it (unlike Mastra), so it is captured in `startAsync`.
    let runId = "";
    const run: WorkflowRun = {
      get runId() {
        return runId;
      },
      async startAsync({ inputData, initialState }) {
        // The new server takes a flat input; fold initialState (dirListing,
        // fileCache, existingSentry, knownPlatform) alongside it.
        const started = await post("/api/wizard", {
          ...inputData,
          ...(initialState ?? {}),
        });
        runId = String(started.runId);
        log.debug(`workflow started, run ${runId}`);
        return pollUntilSettled(runId, seqRef);
      },
      async resumeAsync({ resumeData }) {
        const token = `wizard:${runId}:${seqRef.current}`;
        log.debug(`resuming run ${runId} with token ${token}`);
        await post("/api/resume", { token, result: resumeData });
        return pollUntilSettled(runId, seqRef);
      },
      updateSeq(seq: number) {
        seqRef.current = seq;
      },
    };
    return run;
  }

  return {
    getWorkflow(_id: string): WorkflowHandle {
      return {
        createRun() {
          return Promise.resolve(makeRun());
        },
        runById(runId) {
          const seqRef = { current: -1 };
          return pollUntilSettled(runId, seqRef);
        },
      };
    },
  };
}
