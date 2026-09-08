// test/lib/doctor/judge.test.ts
import { describe, expect, it, vi } from "vitest";
import type { Capture } from "../../../src/lib/doctor/types.js";

const capture: Capture = {
  cwd: "/tmp/app",
  ecosystems: ["javascript"],
  dsns: [],
  initSites: [
    {
      kind: "init",
      file: "src/instrument.ts",
      line: 3,
      text: "Sentry.init({ dsn: process.env.SENTRY_DSN, beforeSend: () => null })",
      keys: { dsn: { dynamic: true }, beforeSend: { dynamic: true } },
    },
  ],
  buildConfigs: [],
  manifests: {},
};

/** Returns `undefined` — no agent is present. */
function noAgent() {
  return;
}

/** Mock module for detect-agent that reports no agent present. */
const noAgentMock = () => ({ detectAgent: noAgent });

describe("judge", () => {
  it("hands off to the agent instead of calling the API", async () => {
    vi.resetModules();
    vi.doMock("../../../src/lib/detect-agent.js", () => ({
      detectAgent: () => ({ name: "claude-code" }),
    }));

    const { judge } = await import("../../../src/lib/doctor/judge.js");
    const results = await judge(capture, { apiKey: "sk-should-not-be-used" });

    expect(results).toHaveLength(1);
    expect(results[0]?.status).toBe("skip");
    expect(results[0]?.id).toBe("judge.handoff");
    expect(results[0]?.detail).toContain("src/instrument.ts");
  });

  it("skips silently with no key and no agent", async () => {
    vi.resetModules();
    vi.doMock("../../../src/lib/detect-agent.js", noAgentMock);

    const { judge } = await import("../../../src/lib/doctor/judge.js");
    const results = await judge(capture, {});

    expect(results).toHaveLength(1);
    expect(results[0]?.status).toBe("skip");
    expect(results[0]?.id).toBe("judge.unavailable");
  });

  it("drops malformed model output rather than trusting it", async () => {
    vi.resetModules();
    vi.doMock("../../../src/lib/detect-agent.js", noAgentMock);
    vi.doMock("@anthropic-ai/sdk", () => ({
      default: class {
        messages = {
          create: vi.fn().mockResolvedValue({
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  findings: [
                    { id: "judge.before_send", status: "warn", detail: "ok" },
                    { id: "judge.bad", status: "explode", detail: "nope" },
                    { id: "dsn.present", status: "fail", detail: "hijack" },
                    { id: "judge.nodetail", status: "warn" },
                  ],
                }),
              },
            ],
          }),
        };
      },
    }));

    const { judge } = await import("../../../src/lib/doctor/judge.js");
    const results = await judge(capture, { apiKey: "sk-test" });

    expect(results.map((r) => r.id)).toEqual(["judge.before_send"]);
  });

  it("never throws when the API call fails", async () => {
    vi.resetModules();
    vi.doMock("../../../src/lib/detect-agent.js", noAgentMock);
    vi.doMock("@anthropic-ai/sdk", () => ({
      default: class {
        messages = {
          create: vi.fn().mockRejectedValue(new Error("429 rate limited")),
        };
      },
    }));

    const { judge } = await import("../../../src/lib/doctor/judge.js");
    const results = await judge(capture, { apiKey: "sk-test" });

    expect(results[0]?.status).toBe("skip");
    expect(results[0]?.detail).toContain("429");
  });
});
