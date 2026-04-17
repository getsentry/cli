import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  readNdjsonStream,
  reconnectInitStream,
  resumeInitAction,
  startInitStream,
} from "../../../src/lib/init/transport.js";
import type { InitEvent, InitStartInput } from "../../../src/lib/init/types.js";
import { mockFetch } from "../../helpers.js";

function streamResponse(
  chunks: string[],
  headers?: HeadersInit,
  status = 200
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });

  return new Response(stream, {
    status,
    headers: {
      "content-type": "application/x-ndjson",
      ...headers,
    },
  });
}

async function collectEvents(response: Response): Promise<InitEvent[]> {
  const events: InitEvent[] = [];
  await readNdjsonStream(response, async (event) => {
    events.push(event);
  });
  return events;
}

type FetchCall = {
  url: string;
  init?: RequestInit;
};

let originalFetch: typeof globalThis.fetch;
let calls: FetchCall[];
let responses: Response[];

beforeEach(() => {
  calls = [];
  responses = [];
  originalFetch = globalThis.fetch;
  globalThis.fetch = mockFetch(async (input, init) => {
    calls.push({ url: String(input), init });
    return (
      responses.shift() ??
      new Response("Unexpected fetch", {
        status: 500,
      })
    );
  });
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("init transport", () => {
  test("starts with POST /api/init and returns the runId", async () => {
    responses = [
      new Response(JSON.stringify({ runId: "run-123" }), {
        headers: {
          "content-type": "application/json",
          "x-workflow-run-id": "run-123",
        },
        status: 202,
      }),
    ];

    const input: InitStartInput = {
      directory: "/tmp/test",
      yes: true,
      dryRun: false,
      org: "acme",
      cliVersion: "0.29.0-dev.0",
    };

    const started = await startInitStream(input, {
      baseUrl: "https://example.test",
    });

    expect(started.runId).toBe("run-123");
    expect(calls[0]?.url).toBe("https://example.test/api/init");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual(input);
  });

  test("reconnects the stream with startIndex", async () => {
    responses = [streamResponse(['{"type":"done","ok":true}\n'])];

    const response = await reconnectInitStream("run-123", 7, {
      baseUrl: "https://example.test",
    });
    const events = await collectEvents(response);

    expect(events).toEqual([{ type: "done", ok: true }]);
    expect(calls[0]?.url).toBe(
      "https://example.test/api/init/run-123/stream?startIndex=7"
    );
    expect(calls[0]?.init?.method).toBe("GET");
  });

  test("posts wrapped action results to the action endpoint", async () => {
    responses = [new Response(null, { status: 204 })];

    await resumeInitAction(
      "action-1",
      {
        ok: true,
        output: {
          action: "continue",
          _phase: "apply",
        },
      },
      { baseUrl: "https://example.test" }
    );

    expect(calls[0]?.url).toBe("https://example.test/api/init/actions/action-1");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      ok: true,
      output: {
        action: "continue",
        _phase: "apply",
      },
    });
  });

  test("parses split NDJSON chunks across line boundaries", async () => {
    const events = await collectEvents(
      streamResponse([
        '{"type":"summary","output":{"platform":"No',
        'de"}}\n{"type":"done","ok":true}\n',
      ])
    );

    expect(events).toEqual([
      { type: "summary", output: { platform: "Node" } },
      { type: "done", ok: true },
    ]);
  });
});
