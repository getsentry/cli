// test/lib/doctor/checks/tier2.test.ts
import { describe, expect, it } from "vitest";
import { TIER2_CHECKS } from "../../../../src/lib/doctor/checks/tier2.js";
import {
  type Capture,
  type CapturedBlock,
  type CheckResult,
  runChecks,
} from "../../../../src/lib/doctor/types.js";

function block(over: Partial<CapturedBlock> = {}): CapturedBlock {
  return {
    kind: "init",
    file: "src/instrument.ts",
    line: 3,
    text: "Sentry.init({ dsn: 'x' })",
    keys: { dsn: { value: "x", dynamic: false } },
    ...over,
  };
}

function makeCapture(over: Partial<Capture> = {}): Capture {
  return {
    cwd: "/tmp/app",
    ecosystems: ["javascript"],
    dsns: [],
    initSites: [block()],
    buildConfigs: [],
    manifests: {},
    ...over,
  };
}

function run(capture: Capture): Map<string, CheckResult> {
  return new Map(
    runChecks(TIER2_CHECKS, { capture, server: { reachable: false } }).map(
      (r) => [r.id, r]
    )
  );
}

describe("tier 2", () => {
  it("fails when no init call is found on a code-init ecosystem", () => {
    const results = run(makeCapture({ initSites: [] }));
    expect(results.get("init.present")?.status).toBe("fail");
  });

  it("skips init.present on an auto-init platform", () => {
    const results = run(
      makeCapture({
        ecosystems: ["java"],
        initSites: [block({ kind: "android-manifest" })],
      })
    );
    expect(results.get("init.present")?.status).toBe("pass");
  });

  it("skips rather than fails when the ecosystem is unknown", () => {
    const results = run(makeCapture({ ecosystems: [], initSites: [] }));
    expect(results.get("init.present")?.status).toBe("skip");
  });

  it("treats a dynamic dsn as configured, not absent", () => {
    const results = run(
      makeCapture({ initSites: [block({ keys: { dsn: { dynamic: true } } })] })
    );
    expect(results.get("config.dsn_set")?.status).toBe("pass");
    expect(results.get("config.dsn_set")?.detail).toContain("runtime");
  });

  it("fails when the init call sets no dsn at all", () => {
    const results = run(makeCapture({ initSites: [block({ keys: {} })] }));
    expect(results.get("config.dsn_set")?.status).toBe("fail");
  });

  it("warns on unconditional debug", () => {
    const results = run(
      makeCapture({
        initSites: [
          block({
            keys: {
              dsn: { value: "x", dynamic: false },
              debug: { value: "true", dynamic: false },
            },
          }),
        ],
      })
    );
    expect(results.get("config.debug")?.status).toBe("warn");
  });

  it("warns when no upload config exists for a JavaScript project", () => {
    const results = run(makeCapture({ buildConfigs: [] }));
    expect(results.get("build.upload_configured")?.status).toBe("warn");
  });

  it("reports an incomplete capture and never fails on it", () => {
    const results = run(makeCapture({ incomplete: "budget exhausted" }));
    expect(results.get("capture.complete")?.status).toBe("warn");
    expect(results.get("capture.complete")?.detail).toContain(
      "budget exhausted"
    );
  });
});
