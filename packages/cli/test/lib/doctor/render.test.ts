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

  it("dedupes identical remediations", () => {
    const lines = fixBlock([
      {
        id: "dsn.resolves",
        status: "fail",
        detail: "a",
        remediation: "Copy the DSN again.",
      },
      {
        id: "live.roundtrip",
        status: "fail",
        detail: "b",
        remediation: "Copy the DSN again.",
      },
    ]);
    expect(lines).toEqual(["Copy the DSN again."]);
  });

  it("replaces traversal paths with [invalid path]", () => {
    const poisoned: CheckResult[] = [
      {
        id: "bad.path",
        status: "fail",
        detail: "Poisoned evidence.",
        evidence: [{ file: "../../etc/passwd" }],
        remediation: "Check the file.",
      },
    ];
    const lines = fixBlock(poisoned);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("[invalid path]");
    expect(lines[0]).not.toContain("../../etc/passwd");
  });
});

describe("renderHuman", () => {
  const output = renderHuman({ results, elapsedMs: 1400, plain: true });

  it("lists passes so it is clear what was checked", () => {
    expect(output).toContain("dsn.present");
    expect(output).toContain("DSN found (code).");
    expect(output).toContain("project.first_event");
    expect(output).toContain("1 passed");
    expect(output.indexOf("Passed")).toBeGreaterThan(
      output.indexOf("Warnings")
    );
    expect(output.indexOf("Skipped")).toBeGreaterThan(output.indexOf("Passed"));
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

  it("keeps a space between a long check id and its detail", () => {
    const long = renderHuman({
      results: [
        {
          id: "build.upload_configured",
          status: "warn",
          detail:
            "No source-map or debug-file upload configuration found for java.",
        },
      ],
      elapsedMs: 100,
      plain: true,
    });
    expect(long).toMatch(/build\.upload_configured\s+No source-map/);
    expect(long).not.toContain("build.upload_configuredNo");
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

  it("omits keys and cwd from the serialized report", () => {
    const capture = {
      cwd: "/tmp/app",
      ecosystems: ["javascript"],
      dsns: [],
      initSites: [
        {
          kind: "init",
          file: "src/instrument.ts",
          line: 3,
          text: "Sentry.init({ dsn: 'https://abc@o1.ingest.sentry.io/1' })",
          keys: {
            dsn: { value: "https://abc@o1.ingest.sentry.io/1", dynamic: false },
          },
        },
      ],
      buildConfigs: [
        {
          kind: "bundler-plugin",
          file: "vite.config.ts",
          line: 1,
          text: "sentryVitePlugin({})",
          keys: { org: { value: "acme", dynamic: false } },
        },
      ],
      manifests: {},
    };

    const report = buildReport({
      capture,
      server: { reachable: false },
      results,
      cliVersion: "1.2.3",
      timestamp: "2026-08-18T00:00:00.000Z",
      elapsedMs: 1400,
    });

    expect(report.capture.initSites[0]).not.toHaveProperty("keys");
    expect(report.capture.buildConfigs[0]).not.toHaveProperty("keys");
    expect(report.capture).not.toHaveProperty("cwd");
    expect(report.capture.initSites[0]?.text).toContain("Sentry.init");
    // In-memory capture used by checks is untouched.
    expect(capture.initSites[0]?.keys.dsn?.value).toContain("abc");
    expect(capture.cwd).toBe("/tmp/app");
  });
});
