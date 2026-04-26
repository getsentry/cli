/**
 * HTTP transport for the init wizard.
 *
 * Three calls:
 *   - POST /api/init                          — start a workflow run.
 *   - GET  /api/init/:runId/stream            — open the NDJSON event stream.
 *   - POST /api/init/actions/:actionId        — submit a local-action result.
 */

import { getTraceData } from "@sentry/node-core/light";
import {
  API_TIMEOUT_MS,
  INIT_API_URL,
  STREAM_CONNECT_TIMEOUT_MS,
} from "./constants.js";
import { readNdjsonStream } from "./stream-parser.js";
import type {
  InitActionResumeBody,
  InitStartInput,
} from "./types.js";

type InitTransportOptions = {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  requestTimeoutMs?: number;
  streamConnectTimeoutMs?: number;
};

export type InitStreamConnection = {
  response: Response;
  runId?: string;
};

type FetchHeaders = Record<string, string>;
type ErrorPayload = { message: string; retryable: boolean };
type ResolvedTransportOptions = {
  baseUrl: string;
  fetchImpl: typeof fetch;
  requestTimeoutMs: number;
  streamConnectTimeoutMs: number;
};

const RUN_ID_HEADERS = [
  "x-workflow-run-id",
  "x-vercel-workflow-run-id",
  "x-init-run-id",
] as const;

function buildApiUrl(baseUrl: string, pathname: string): string {
  return new URL(pathname, baseUrl).toString();
}

function readRunId(response: Response): string | undefined {
  for (const headerName of RUN_ID_HEADERS) {
    const runId = response.headers.get(headerName)?.trim();
    if (runId) return runId;
  }
  return undefined;
}

function createFetchHeaders(contentType = false): FetchHeaders {
  const traceData = getTraceData();
  return {
    ...(contentType ? { "content-type": "application/json" } : {}),
    ...(traceData["sentry-trace"] && {
      "sentry-trace": traceData["sentry-trace"],
    }),
    ...(traceData.baggage && { baggage: traceData.baggage }),
  };
}

function resolveTransportOptions(
  options: InitTransportOptions
): ResolvedTransportOptions {
  return {
    baseUrl: options.baseUrl ?? INIT_API_URL,
    fetchImpl: options.fetchImpl ?? fetch,
    requestTimeoutMs: options.requestTimeoutMs ?? API_TIMEOUT_MS,
    streamConnectTimeoutMs:
      options.streamConnectTimeoutMs ?? STREAM_CONNECT_TIMEOUT_MS,
  };
}

async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  input: string | URL | Request,
  init: RequestInit,
  ms: number,
  label: string
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(label), ms);
  try {
    return await fetchImpl(input, { ...init, signal: controller.signal });
  } catch (error) {
    if ((error as Error).name === "AbortError") {
      throw new Error(`${label} timed out after ${ms / 1000}s`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function readErrorPayload(response: Response): Promise<ErrorPayload> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const payload = (await response.json().catch(() => null)) as
      | { error?: unknown; retryable?: unknown }
      | null;
    if (payload && typeof payload.error === "string") {
      return {
        message: payload.error,
        retryable: payload.retryable === true,
      };
    }
  }
  const text = await response.text();
  return {
    message: text || response.statusText,
    retryable: false,
  };
}

async function throwIfNotOk(response: Response, label: string): Promise<void> {
  if (response.ok) return;
  const error = await readErrorPayload(response);
  throw new Error(
    `${label} failed (${response.status}): ${error.message}${error.retryable ? " [retryable]" : ""}`
  );
}

async function requestInitApi(args: {
  body?: string;
  contentType?: boolean;
  label: string;
  method: string;
  options: InitTransportOptions;
  path: string;
  timeoutMs: number;
}): Promise<Response> {
  const resolved = resolveTransportOptions(args.options);
  const response = await fetchWithTimeout(
    resolved.fetchImpl,
    buildApiUrl(resolved.baseUrl, args.path),
    {
      method: args.method,
      headers: createFetchHeaders(args.contentType),
      ...(args.body ? { body: args.body } : {}),
    },
    args.timeoutMs,
    args.label
  );

  await throwIfNotOk(response, args.label);
  return response;
}

export async function startInit(
  input: InitStartInput,
  options: InitTransportOptions = {}
): Promise<{ runId: string }> {
  const resolved = resolveTransportOptions(options);
  const response = await requestInitApi({
    body: JSON.stringify(input),
    contentType: true,
    label: "Init start",
    method: "POST",
    options,
    path: "/api/init",
    timeoutMs: resolved.requestTimeoutMs,
  });
  const fromHeader = readRunId(response);
  if (fromHeader) return { runId: fromHeader };
  const body = (await response.json().catch(() => null)) as
    | { runId?: string }
    | null;
  if (!body?.runId) {
    throw new Error("Init start succeeded but did not return a runId");
  }
  return { runId: body.runId };
}

type OpenStreamOptions = InitTransportOptions & {
  /** Replay events starting at this index (used for reconnects). */
  startIndex?: number;
};

export async function openInitStream(
  runId: string,
  options: OpenStreamOptions = {}
): Promise<Response> {
  const resolved = resolveTransportOptions(options);
  const search =
    typeof options.startIndex === "number"
      ? `?startIndex=${options.startIndex}`
      : "";
  return requestInitApi({
    label: "Init stream",
    method: "GET",
    options,
    path: `/api/init/${encodeURIComponent(runId)}/stream${search}`,
    timeoutMs: resolved.streamConnectTimeoutMs,
  });
}

export async function resumeInitAction(
  actionId: string,
  body: InitActionResumeBody,
  options: InitTransportOptions = {}
): Promise<void> {
  const resolved = resolveTransportOptions(options);
  await requestInitApi({
    body: JSON.stringify(body),
    contentType: true,
    label: `Resume action ${actionId}`,
    method: "POST",
    options,
    path: `/api/init/actions/${encodeURIComponent(actionId)}`,
    timeoutMs: resolved.requestTimeoutMs,
  });
}

export { readNdjsonStream };
