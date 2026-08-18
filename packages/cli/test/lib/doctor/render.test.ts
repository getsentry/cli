// test/lib/doctor/render.test.ts
import { describe, expect, it } from "vitest";
import {
  buildReport,
  exitCodeFor,
  fixBlock,
  renderHuman,
  verdictFor,
} from "../../../src/lib/doctor/render.js";
import type { CheckResult } from "../../../src/lib/doctor/types.js";

const results: CheckResult[] = [
  { id: "dsn.present", status: "pass", detail: "DSN found (code)." },
  {
    id: "project.first_event",
    status: "fail",
    detail: "No event has ever reached javascript-android/my-app.",
    evidence: [{ file: "app/build.gradle.kts", line: 14 }],
    remediation: "Confirm the SDK initializes before your app does any work.",
  },
  {
    id: "config.debug",
    status: "warn",
    detail: "`debug` is enabled unconditionally.",
  },
  {
    id: "live.roundtrip",
    status: "skip",
    detail: "Not requested. Run with --send-test-event.",
  },
];

describe("exitCodeFor", () => {
  it("is 1 when anything failed", () => {
    expect(exitCodeFor(results)).toBe(1);
  });

  it("is 0 when only warnings and skips are present", () => {
    expect(exitCodeFor(results.filter((r) => r.status !== "fail"))).toBe(0);
  });
});

describe("verdictFor", () => {
  it("states a conclusion, not a count", () => {
    const verdict = verdictFor(results);
    expect(verdict).toContain("never received an event");
    expect(verdict).not.toMatch(/\d+ failed/);
  });

  it("reports health when nothing failed", () => {
    expect(verdictFor([results[0] as CheckResult])).toContain("healthy");
  });
});

describe("fixBlock", () => {
  it("returns one numbered instruction per failure", () => {
    const lines = fixBlock(results);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("initializes before your app");
  });

  it("is empty when nothing failed", () => {
    expect(fixBlock([results[0] as CheckResult])).toEqual([]);
  });
});

describe("renderHuman", () => {
  const output = renderHuman({ results, elapsedMs: 1400, plain: true });

  it("collapses passes to a count and keeps failures verbatim", () => {
    expect(output).not.toContain("dsn.present");
    expect(output).toContain("project.first_event");
    expect(output).toContain("1 passed");
  });

  it("renders evidence as file:line", () => {
    expect(output).toContain("app/build.gradle.kts:14");
  });

  it("shows skips with their reason, after warnings", () => {
    expect(output).toContain("live.roundtrip");
    expect(output).toContain("Run with --send-test-event");
    expect(output.indexOf("Skipped")).toBeGreaterThan(
      output.indexOf("Warnings")
    );
  });

  it("prints the Fix block without being asked", () => {
    expect(output).toContain("Fix");
    expect(output).toContain("initializes before your app");
  });

  it("emits no color tags in plain mode", () => {
    expect(output).not.toContain("<green>");
    expect(output).not.toContain("<red>");
  });
});

describe("buildReport", () => {
  it("includes every result, passes included", () => {
    const report = buildReport({
      capture: {
        cwd: "/tmp/app",
        ecosystems: [],
        dsns: [],
        initSites: [],
        buildConfigs: [],
        manifests: {},
      },
      server: { reachable: false },
      results,
      cliVersion: "1.2.3",
      timestamp: "2026-08-18T00:00:00.000Z",
      elapsedMs: 1400,
    });

    expect(report.results).toHaveLength(4);
    expect(report.schema_version).toBe(1);
    expect(report.cli_version).toBe("1.2.3");
    expect(report.elapsed_ms).toBe(1400);
  });
});
