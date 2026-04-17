import { getTraceData } from "@sentry/node-core/light";
import {
  API_TIMEOUT_MS,
  INIT_API_URL,
  STREAM_CONNECT_TIMEOUT_MS,
} from "./constants.js";
import type { InitActionResumeBody, InitEvent, InitStartInput } from "./types.js";

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

const RUN_ID_HEADERS = [
  "x-workflow-run-id",
  "x-vercel-workflow-run-id",
  "x-init-run-id",
] as const;

function buildApiUrl(baseUrl: string, pathname: string): string {
  return new URL(pathname, baseUrl).toString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isWizardOutput(value: unknown): boolean {
  return isRecord(value);
}

function assertInitEvent(raw: unknown): InitEvent {
  if (!isRecord(raw) || typeof raw.type !== "string") {
    throw new Error("Invalid init event");
  }

  switch (raw.type) {
    case "status":
      if (typeof raw.message !== "string") {
        throw new Error("Invalid status event");
      }
      return raw as InitEvent;
    case "action_request":
      if (
        typeof raw.actionId !== "string" ||
        (raw.kind !== "tool" && raw.kind !== "prompt") ||
        typeof raw.name !== "string"
      ) {
        throw new Error("Invalid action_request event");
      }
      return raw as InitEvent;
    case "action_result":
      if (typeof raw.actionId !== "string" || typeof raw.ok !== "boolean") {
        throw new Error("Invalid action_result event");
      }
      return raw as InitEvent;
    case "warning":
      if (typeof raw.message !== "string") {
        throw new Error("Invalid warning event");
      }
      return raw as InitEvent;
    case "summary":
      if (!isWizardOutput(raw.output)) {
        throw new Error("Invalid summary event");
      }
      return raw as InitEvent;
    case "error":
      if (typeof raw.message !== "string") {
        throw new Error("Invalid error event");
      }
      return raw as InitEvent;
    case "done":
      if (typeof raw.ok !== "boolean") {
        throw new Error("Invalid done event");
      }
      return raw as InitEvent;
    default:
      throw new Error(`Unknown init event type: ${String(raw.type)}`);
  }
}

function readRunId(response: Response): string | undefined {
  for (const headerName of RUN_ID_HEADERS) {
    const runId = response.headers.get(headerName)?.trim();
    if (runId) {
      return runId;
    }
  }
  return;
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

async function throwIfNotOk(response: Response, label: string): Promise<void> {
  if (response.ok) {
    return;
  }

  const text = await response.text();
  throw new Error(
    `${label} failed (${response.status}): ${text || response.statusText}`
  );
}

export async function startInitStream(
  input: InitStartInput,
  options: InitTransportOptions = {}
): Promise<InitStreamConnection> {
  const baseUrl = options.baseUrl ?? INIT_API_URL;
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchWithTimeout(
    fetchImpl,
    buildApiUrl(baseUrl, "/api/init"),
    {
      method: "POST",
      headers: createFetchHeaders(true),
      body: JSON.stringify(input),
    },
    options.requestTimeoutMs ?? API_TIMEOUT_MS,
    "Init start"
  );

  await throwIfNotOk(response, "Init start");
  return { response, runId: readRunId(response) };
}

export async function reconnectInitStream(
  runId: string,
  startIndex: number,
  options: InitTransportOptions = {}
): Promise<Response> {
  const baseUrl = options.baseUrl ?? INIT_API_URL;
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchWithTimeout(
    fetchImpl,
    buildApiUrl(
      baseUrl,
      `/api/init/${encodeURIComponent(runId)}/stream?startIndex=${startIndex}`
    ),
    {
      method: "GET",
      headers: createFetchHeaders(),
    },
    options.streamConnectTimeoutMs ?? STREAM_CONNECT_TIMEOUT_MS,
    "Init stream connection"
  );

  await throwIfNotOk(response, "Init stream");
  return response;
}

export async function resumeInitAction(
  actionId: string,
  body: InitActionResumeBody,
  options: InitTransportOptions = {}
): Promise<void> {
  const baseUrl = options.baseUrl ?? INIT_API_URL;
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchWithTimeout(
    fetchImpl,
    buildApiUrl(baseUrl, `/api/init/actions/${encodeURIComponent(actionId)}`),
    {
      method: "POST",
      headers: createFetchHeaders(true),
      body: JSON.stringify(body),
    },
    options.requestTimeoutMs ?? API_TIMEOUT_MS,
    `Resume action ${actionId}`
  );

  await throwIfNotOk(response, `Resume action ${actionId}`);
}

export async function readNdjsonStream(
  response: Response,
  onEvent: (event: InitEvent) => Promise<void>
): Promise<number> {
  if (!response.body) {
    throw new Error("Init stream response had no body");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let eventCount = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      let newlineIndex = buffer.indexOf("\n");

      while (newlineIndex !== -1) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (line) {
          await onEvent(assertInitEvent(JSON.parse(line)));
          eventCount += 1;
        }
        newlineIndex = buffer.indexOf("\n");
      }
    }

    buffer += decoder.decode();
    const trailing = buffer.trim();
    if (trailing) {
      await onEvent(assertInitEvent(JSON.parse(trailing)));
      eventCount += 1;
    }
  } finally {
    reader.releaseLock();
  }

  return eventCount;
}
