import { describe, expect, it, vi } from "vitest";
import type { DoctorReport } from "../../../src/lib/doctor/render.js";

const runWizard = vi.fn();
vi.mock("../../../src/lib/init/wizard-runner.js", () => ({
  runWizard: (...a: unknown[]) => runWizard(...a),
}));

const written: string[] = [];
vi.mock("../../../src/lib/logger.js", () => ({
  logger: {
    info: (m: string) => written.push(m),
    warn: (m: string) => written.push(m),
    success: (m: string) => written.push(m),
    debug: vi.fn(),
  },
}));

function makeReport(overrides: Partial<DoctorReport> = {}): DoctorReport {
  return {
    schema_version: 1,
    cli_version: "1.2.3",
    timestamp: "2026-08-18T00:00:00.000Z",
    elapsed_ms: 1400,
    capture: {
      cwd: "/tmp/app",
      ecosystems: ["javascript"],
      dsns: [],
      initSites: [],
      buildConfigs: [],
      manifests: {},
    },
    server: { reachable: false },
    results: [
      { id: "project.first_event", status: "fail", detail: "never" },
      { id: "artifacts.uploaded", status: "fail", detail: "none" },
    ],
    ...overrides,
  };
}

describe("deriveFeatures", () => {
  it("asks for source maps when the artifacts check failed", async () => {
    const { deriveFeatures } = await import("../../../src/lib/doctor/fix.js");
    expect(deriveFeatures(makeReport())).toContain("sourcemaps");
  });

  it("returns an empty list when nothing maps to a feature", async () => {
    const { deriveFeatures } = await import("../../../src/lib/doctor/fix.js");
    const report = makeReport({
      results: [{ id: "config.debug", status: "warn", detail: "noisy" }],
    });
    expect(deriveFeatures(report)).toEqual([]);
  });
});

describe("runFix", () => {
  it("always runs the wizard in dry-run mode", async () => {
    runWizard.mockResolvedValue({ result: { codemodPlan: [] } });
    const { runFix } = await import("../../../src/lib/doctor/fix.js");

    await runFix({ cwd: "/tmp/app" } as never, makeReport());

    const args = runWizard.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(args.dryRun).toBe(true);
  });

  it("renders each codemod entry with its risk level", async () => {
    runWizard.mockResolvedValue({
      result: {
        codemodPlan: [
          {
            description: "Add Sentry.init to src/instrument.ts",
            riskLevel: "low",
          },
          { description: "Wrap next.config.js", riskLevel: "medium" },
        ],
      },
    });
    written.length = 0;
    const { runFix } = await import("../../../src/lib/doctor/fix.js");

    await runFix({ cwd: "/tmp/app" } as never, makeReport());

    const output = written.join("\n");
    expect(output).toContain("Add Sentry.init");
    expect(output).toContain("medium");
  });

  it("reports rather than throws when the wizard fails", async () => {
    runWizard.mockRejectedValue(new Error("workflow timed out"));
    written.length = 0;
    const { runFix } = await import("../../../src/lib/doctor/fix.js");

    await expect(
      runFix({ cwd: "/tmp/app" } as never, makeReport())
    ).resolves.toBeUndefined();
    expect(written.join("\n")).toContain("workflow timed out");
  });
});
