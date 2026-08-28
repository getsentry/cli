// test/lib/doctor/report.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DoctorReport } from "../../../src/lib/doctor/render.js";

const captureFeedback = vi.fn();
const isEnabled = vi.fn();
const flush = vi.fn();
const prompt = vi.fn();
const isatty = vi.fn();
const detectAgent = vi.fn();
const getClient = vi.fn();
const getUserInfo = vi.fn();

vi.mock("@sentry/node-core/light", () => ({
  captureFeedback: (...a: unknown[]) => captureFeedback(...a),
  isEnabled: () => isEnabled(),
  flush: (...a: unknown[]) => flush(...a),
  getClient: () => getClient(),
}));
vi.mock("node:tty", () => ({ isatty: (...a: unknown[]) => isatty(...a) }));
vi.mock("../../../src/lib/detect-agent.js", () => ({
  detectAgent: () => detectAgent(),
}));
vi.mock("../../../src/lib/db/user.js", () => ({
  getUserInfo: () => getUserInfo(),
}));
vi.mock("../../../src/lib/logger.js", () => ({
  logger: {
    prompt: (...a: unknown[]) => prompt(...a),
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    success: vi.fn(),
  },
}));

function makeReport(failed: boolean): DoctorReport {
  return {
    schema_version: 1,
    cli_version: "1.2.3",
    timestamp: "2026-08-18T00:00:00.000Z",
    elapsed_ms: 1400,
    capture: {
      ecosystems: ["javascript"],
      dsns: [],
      initSites: [],
      buildConfigs: [],
      manifests: {},
    },
    server: { reachable: false },
    results: failed
      ? [{ id: "project.first_event", status: "fail", detail: "never" }]
      : [{ id: "dsn.present", status: "pass", detail: "found" }],
  };
}

describe("offerSupportExport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isatty.mockReturnValue(true);
    detectAgent.mockReturnValue(undefined);
    isEnabled.mockReturnValue(true);
    prompt.mockResolvedValue(true);
    flush.mockResolvedValue(true);
    getClient.mockReturnValue({ getOptions: () => ({ enabled: true }) });
    getUserInfo.mockReturnValue({
      userId: "u1",
      email: "roman@sentry.io",
      name: "Roman",
      username: "romtsn",
    });
  });

  it("sends after an explicit yes, tagged with the failing ids", async () => {
    const { offerSupportExport } = await import(
      "../../../src/lib/doctor/report.js"
    );

    expect(await offerSupportExport(makeReport(true))).toBe(true);
    expect(captureFeedback).toHaveBeenCalledOnce();
    const payload = captureFeedback.mock.calls[0]?.[0] as {
      message: string;
      email?: string;
      name?: string;
    };
    expect(payload.message).toContain("project.first_event");
    expect(payload.email).toBe("roman@sentry.io");
    expect(payload.name).toBe("Roman");
  });

  it("sends nothing when the user declines", async () => {
    prompt.mockResolvedValue(false);
    const { offerSupportExport } = await import(
      "../../../src/lib/doctor/report.js"
    );

    expect(await offerSupportExport(makeReport(true))).toBe(false);
    expect(captureFeedback).not.toHaveBeenCalled();
  });

  it("prompts even when nothing failed", async () => {
    const { offerSupportExport } = await import(
      "../../../src/lib/doctor/report.js"
    );

    expect(await offerSupportExport(makeReport(false))).toBe(true);
    expect(prompt).toHaveBeenCalledOnce();
    expect(captureFeedback).toHaveBeenCalledOnce();
  });

  it("never prompts outside a TTY", async () => {
    isatty.mockReturnValue(false);
    const { offerSupportExport } = await import(
      "../../../src/lib/doctor/report.js"
    );

    expect(await offerSupportExport(makeReport(true))).toBe(false);
    expect(prompt).not.toHaveBeenCalled();
  });

  it("never prompts inside an agent", async () => {
    detectAgent.mockReturnValue({ name: "claude-code" });
    const { offerSupportExport } = await import(
      "../../../src/lib/doctor/report.js"
    );

    expect(await offerSupportExport(makeReport(true))).toBe(false);
    expect(prompt).not.toHaveBeenCalled();
  });

  it("sends after yes even when telemetry is disabled", async () => {
    isEnabled.mockReturnValue(false);
    const opts = { enabled: false };
    getClient.mockReturnValue({ getOptions: () => opts });
    captureFeedback.mockImplementation(() => {
      expect(opts.enabled).toBe(true);
    });
    const { offerSupportExport } = await import(
      "../../../src/lib/doctor/report.js"
    );

    expect(await offerSupportExport(makeReport(true))).toBe(true);
    expect(prompt).toHaveBeenCalledOnce();
    expect(captureFeedback).toHaveBeenCalledOnce();
    expect(opts.enabled).toBe(false);
  });
});
