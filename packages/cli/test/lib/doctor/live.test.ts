import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Capture, ServerFacts } from "../../../src/lib/doctor/types.js";

const sendEnvelopeRequest = vi.fn();
const queryEvents = vi.fn();

vi.mock("../../../src/lib/envelope/transport.js", () => ({
  sendEnvelopeRequest: (...args: unknown[]) => sendEnvelopeRequest(...args),
}));
vi.mock("../../../src/lib/api/explore.js", () => ({
  queryEvents: (...args: unknown[]) => queryEvents(...args),
}));

const capture: Capture = {
  cwd: "/tmp/app",
  ecosystems: ["javascript"],
  dsns: [
    {
      protocol: "https",
      publicKey: "abc123",
      host: "o1.ingest.sentry.io",
      projectId: "42",
      raw: "https://abc123@o1.ingest.sentry.io/42",
      source: "code",
    },
  ],
  initSites: [],
  buildConfigs: [],
  manifests: {},
};

const server: ServerFacts = {
  reachable: true,
  org: "acme",
  project: "web",
};

describe("liveRoundtripCheck", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sendEnvelopeRequest.mockResolvedValue(undefined);
    queryEvents.mockResolvedValue({ data: { data: [] } });
  });

  it("fails when the envelope cannot be delivered", async () => {
    sendEnvelopeRequest.mockRejectedValue(new Error("ECONNREFUSED"));
    const { liveRoundtripCheck } = await import(
      "../../../src/lib/doctor/live.js"
    );

    const result = await liveRoundtripCheck(capture, server);
    expect(result.status).toBe("fail");
    expect(result.detail).toContain("ECONNREFUSED");
    expect(result.remediation).toBeTruthy();
  });

  it("passes when the event is found in search", async () => {
    queryEvents.mockImplementation((_org, opts) => ({
      data: { data: [{ id: "1", message: extractNonce(opts) }] },
    }));
    const { liveRoundtripCheck } = await import(
      "../../../src/lib/doctor/live.js"
    );

    const result = await liveRoundtripCheck(capture, server, {
      pollAttempts: 1,
      pollIntervalMs: 0,
    });
    expect(result.status).toBe("pass");
    expect(queryEvents).toHaveBeenCalledWith(
      "acme",
      expect.objectContaining({
        dataset: "errors",
        fields: ["title"],
        query: expect.stringMatching(/project:web \w+/),
      })
    );
    const body = String(sendEnvelopeRequest.mock.calls[0]?.[1] ?? "");
    expect(body).toContain('"level":"error"');
    expect(body).toContain("TestError");
  });

  it("warns — never fails — when delivery succeeded but search is empty", async () => {
    const { liveRoundtripCheck } = await import(
      "../../../src/lib/doctor/live.js"
    );

    const result = await liveRoundtripCheck(capture, server, {
      pollAttempts: 2,
      pollIntervalMs: 0,
    });
    expect(result.status).toBe("warn");
    expect(result.detail).toContain("accepted");
    expect(queryEvents).toHaveBeenCalledTimes(2);
  });

  it("skips when there is no DSN to send to", async () => {
    const { liveRoundtripCheck } = await import(
      "../../../src/lib/doctor/live.js"
    );

    const result = await liveRoundtripCheck({ ...capture, dsns: [] }, server);
    expect(result.status).toBe("skip");
    expect(sendEnvelopeRequest).not.toHaveBeenCalled();
  });

  it("skips the search half when the org is unknown, without failing", async () => {
    const { liveRoundtripCheck } = await import(
      "../../../src/lib/doctor/live.js"
    );

    const result = await liveRoundtripCheck(capture, { reachable: false });
    expect(result.status).toBe("warn");
    expect(queryEvents).not.toHaveBeenCalled();
  });

  it("fails when the DSN did not resolve to a project", async () => {
    const { liveRoundtripCheck } = await import(
      "../../../src/lib/doctor/live.js"
    );

    const result = await liveRoundtripCheck(capture, {
      reachable: true,
      dsnMatchesProject: false,
    });
    expect(result.status).toBe("fail");
    expect(result.detail).toMatch(/does not match/i);
    expect(sendEnvelopeRequest).not.toHaveBeenCalled();
    expect(queryEvents).not.toHaveBeenCalled();
  });
});

/** Pull the nonce back out of the events search query. */
function extractNonce(opts: { query?: string }): string {
  return (opts.query ?? "").match(/project:\S+\s+(\w+)/)?.[1] ?? "";
}
