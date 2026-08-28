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

  it("warns when Android traces.sample-rate is 1.0", () => {
    const results = run(
      makeCapture({
        ecosystems: ["java"],
        initSites: [
          block({
            kind: "android-manifest",
            file: "src/main/AndroidManifest.xml",
            keys: {
              dsn: { value: "x", dynamic: false },
              "traces.sample-rate": { value: "1.0", dynamic: false },
            },
          }),
        ],
      })
    );
    expect(results.get("config.sample_rate")?.status).toBe("warn");
    expect(results.get("config.sample_rate")?.detail).toContain("1.0");
  });

  it("warns on replay and profiling sample rates, but not error sampleRate", () => {
    const produced = runChecks(TIER2_CHECKS, {
      capture: makeCapture({
        initSites: [
          block({
            keys: {
              dsn: { value: "x", dynamic: false },
              profilesSampleRate: { value: "1.0", dynamic: false },
              replaysSessionSampleRate: { value: "1.0", dynamic: false },
              "session-replay.session-sample-rate": {
                value: "1.0",
                dynamic: false,
              },
              "traces.profiling.session-sample-rate": {
                value: "1.0",
                dynamic: false,
              },
              "anr.profiling.sample-rate": { value: "1.0", dynamic: false },
              sampleRate: { value: "1.0", dynamic: false },
            },
          }),
        ],
      }),
      server: { reachable: false },
    });
    const details = produced
      .filter((r) => r.id === "config.sample_rate")
      .map((r) => r.detail)
      .join("\n");
    expect(details).toContain("profilesSampleRate");
    expect(details).toContain("replaysSessionSampleRate");
    expect(details).toContain("session-replay.session-sample-rate");
    expect(details).toContain("traces.profiling.session-sample-rate");
    expect(details).toContain("anr.profiling.sample-rate");
    expect(details).not.toMatch(/(^|\n)sampleRate is /);
  });

  it("does not warn when only the replay on-error sample rate is 1.0", () => {
    const results = run(
      makeCapture({
        initSites: [
          block({
            keys: {
              dsn: { value: "x", dynamic: false },
              onErrorSampleRate: { value: "1.0", dynamic: false },
              sessionSampleRate: { value: "1.0", dynamic: false },
            },
          }),
        ],
      })
    );
    const details = [...results.values()]
      .filter((r) => r.id === "config.sample_rate")
      .map((r) => r.detail)
      .join("\n");
    expect(details).toContain("sessionSampleRate");
    expect(details).not.toContain("onErrorSampleRate");
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

  it("skips android.double_init when there is no Android manifest", () => {
    const results = run(makeCapture());
    expect(results.get("android.double_init")?.status).toBe("skip");
  });

  it("skips android.double_init when the app only auto-inits from the manifest", () => {
    const results = run(
      makeCapture({
        ecosystems: ["java"],
        initSites: [
          block({
            kind: "android-manifest",
            file: "src/main/AndroidManifest.xml",
          }),
        ],
      })
    );
    expect(results.get("android.double_init")?.status).toBe("skip");
  });

  it("warns when a code init exists and auto-init is still on", () => {
    const results = run(
      makeCapture({
        ecosystems: ["java"],
        initSites: [
          block({
            kind: "android-manifest",
            file: "app/src/main/AndroidManifest.xml",
            keys: { dsn: { value: "x", dynamic: false } },
          }),
          block({
            kind: "init",
            file: "app/src/main/java/MyApplication.java",
            text: "SentryAndroid.init(this, options -> {})",
          }),
        ],
      })
    );
    expect(results.get("android.double_init")?.status).toBe("warn");
    expect(results.get("android.double_init")?.detail).toMatch(
      /twice|auto-init/i
    );
  });

  it("passes when auto-init is false next to a code init", () => {
    const results = run(
      makeCapture({
        ecosystems: ["java"],
        initSites: [
          block({
            kind: "android-manifest",
            file: "app/src/main/AndroidManifest.xml",
            keys: { "auto-init": { value: "false", dynamic: false } },
          }),
          block({
            kind: "init",
            file: "app/src/main/java/MyApplication.java",
          }),
        ],
      })
    );
    expect(results.get("android.double_init")?.status).toBe("pass");
  });
});
