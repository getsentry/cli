import { describe, expect, mock, test } from "bun:test";
import {
  readNdjsonStream,
  reconnectInitStream,
  resumeInitAction,
  startInitStream,
} from "../../../src/lib/init/transport.js";

function createJsonResponse(
  body: unknown,
  init: ResponseInit = {}
): Response {
  return new Response(JSON.stringify(body), {
    headers: {
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
    status: init.status ?? 200,
  });
}

describe("init transport", () => {
  test("starts a workflow run and reads the run id header", async () => {
    const fetchImpl = mock(async () =>
      createJsonResponse(
        { runId: "run_123" },
        {
          headers: {
            "content-type": "application/json",
            "x-workflow-run-id": "run_123",
          },
          status: 202,
        }
      )
    ) as typeof fetch;

    const started = await startInitStream(
      {
        cliVersion: "0.29.0-dev.0",
        directory: "/tmp/project",
        dryRun: false,
        yes: true,
      },
      {
        baseUrl: "http://localhost:3000",
        fetchImpl,
      }
    );

    expect(started.runId).toBe("run_123");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test("surfaces retryable start failures from the backend", async () => {
    const fetchImpl = mock(async () =>
      createJsonResponse(
        {
          error: "Runner did not become ready in time",
          retryable: true,
        },
        { status: 503 }
      )
    ) as typeof fetch;

    await expect(
      startInitStream(
        {
          cliVersion: "0.29.0-dev.0",
          directory: "/tmp/project",
          dryRun: false,
          yes: true,
        },
        {
          baseUrl: "http://localhost:3000",
          fetchImpl,
        }
      )
    ).rejects.toThrow(
      "Init start failed (503): Runner did not become ready in time [retryable]"
    );
  });

  test("reconnects the NDJSON stream from a start index", async () => {
    const fetchImpl = mock(async () =>
      new Response("", {
        headers: {
          "content-type": "application/x-ndjson; charset=utf-8",
        },
      })
    ) as typeof fetch;

    await reconnectInitStream("run_123", 7, {
      baseUrl: "http://localhost:3000",
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      "http://localhost:3000/api/init/run_123/stream?startIndex=7",
      expect.objectContaining({
        method: "GET",
      })
    );
  });

  test("posts action resume payloads", async () => {
    const fetchImpl = mock(async () => createJsonResponse({ ok: true })) as typeof fetch;

    await resumeInitAction(
      "run_123:action:001:read-files",
      {
        ok: true,
        output: {
          files: {},
        },
      },
      {
        baseUrl: "http://localhost:3000",
        fetchImpl,
      }
    );

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test("reads NDJSON events and validates them", async () => {
    const response = new Response(
      [
        JSON.stringify({
          message: "Inspecting project…",
          phase: "bootstrap",
          type: "status",
        }),
        JSON.stringify({
          ok: true,
          type: "done",
        }),
      ].join("\n"),
      {
        headers: {
          "content-type": "application/x-ndjson; charset=utf-8",
        },
      }
    );

    const seen: string[] = [];
    const count = await readNdjsonStream(response, async (event) => {
      seen.push(event.type);
    });

    expect(count).toBe(2);
    expect(seen).toEqual(["status", "done"]);
  });

  test("fails on malformed NDJSON events", async () => {
    const response = new Response('{"type":"status"}\n', {
      headers: {
        "content-type": "application/x-ndjson; charset=utf-8",
      },
    });

    await expect(
      readNdjsonStream(response, async () => {})
    ).rejects.toThrow("Invalid status event");
  });
});
