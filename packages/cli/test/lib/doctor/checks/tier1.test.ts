// test/lib/doctor/checks/tier1.test.ts
import { describe, expect, it } from "vitest";
import { TIER1_CHECKS } from "../../../../src/lib/doctor/checks/tier1.js";
import {
  type Capture,
  type CheckResult,
  type DetectedDsn,
  runChecks,
  type ServerFacts,
} from "../../../../src/lib/doctor/types.js";

function dsn(publicKey: string, projectId = "42"): DetectedDsn {
  return {
    protocol: "https",
    publicKey,
    host: "o1.ingest.sentry.io",
    projectId,
    raw: `https://${publicKey}@o1.ingest.sentry.io/${projectId}`,
    source: "code",
    sourcePath: "src/instrument.ts",
  };
}

function makeCapture(overrides: Partial<Capture> = {}): Capture {
  return {
    cwd: "/tmp/app",
    ecosystems: ["javascript"],
    dsns: [dsn("abc123")],
    initSites: [],
    buildConfigs: [],
    manifests: {},
    ...overrides,
  };
}

function run(capture: Capture, server: ServerFacts): Map<string, CheckResult> {
  return new Map(
    runChecks(TIER1_CHECKS, { capture, server }).map((r) => [r.id, r])
  );
}

const HEALTHY: ServerFacts = {
  reachable: true,
  org: "acme",
  project: "web",
  projectPlatform: "javascript-react",
  firstEvent: "2026-08-01T00:00:00Z",
  lastIssueSeen: "2026-08-18T10:00:00Z",
  keys: [{ publicKey: "abc123", isActive: true }],
  dsnMatchesProject: true,
  environments: ["production", "staging"],
  latestRelease: { version: "1.0.0", lastEvent: "2026-08-18T10:00:00Z" },
  hasUploadedArtifacts: true,
};

describe("tier 1", () => {
  it("passes everything on a healthy project", () => {
    const results = run(makeCapture(), HEALTHY);
    for (const [id, result] of results) {
      expect(result.status, `${id}: ${result.detail}`).toBe("pass");
    }
  });

  it("fails first_event when the project has never received an event", () => {
    const results = run(makeCapture(), { ...HEALTHY, firstEvent: null });
    expect(results.get("project.first_event")?.status).toBe("fail");
    expect(results.get("project.first_event")?.detail).toContain("never");
  });

  it("fails when no DSN is present anywhere", () => {
    const results = run(makeCapture({ dsns: [] }), { reachable: false });
    expect(results.get("dsn.present")?.status).toBe("fail");
  });

  it("fails on a placeholder DSN copied from the docs", () => {
    const results = run(makeCapture({ dsns: [dsn("examplePublicKey", "0")] }), {
      reachable: false,
    });
    expect(results.get("dsn.placeholder")?.status).toBe("fail");
  });

  it("warns when two distinct DSNs are configured", () => {
    const results = run(
      makeCapture({ dsns: [dsn("abc123", "42"), dsn("zzz999", "77")] }),
      HEALTHY
    );
    expect(results.get("dsn.conflict")?.status).toBe("warn");
  });

  it("fails when the DSN key has been deactivated", () => {
    const results = run(makeCapture(), {
      ...HEALTHY,
      keys: [{ publicKey: "abc123", isActive: false }],
    });
    expect(results.get("project.key_active")?.status).toBe("fail");
    expect(results.get("project.key_active")?.remediation).toBeTruthy();
  });

  it("fails when the DSN resolves to no accessible project", () => {
    const results = run(makeCapture(), {
      reachable: true,
      dsnMatchesProject: false,
    });
    expect(results.get("dsn.resolves")?.status).toBe("fail");
  });

  it("skips every server check when Sentry is unreachable, and never fails", () => {
    const results = run(makeCapture(), {
      reachable: false,
      unreachableReason: "Not authenticated.",
    });

    for (const id of [
      "dsn.resolves",
      "project.first_event",
      "project.last_event",
      "project.key_active",
      "project.environments",
      "release.attribution",
      "artifacts.uploaded",
    ]) {
      const result = results.get(id);
      expect(result?.status, id).toBe("skip");
      expect(result?.detail, `${id} must explain its skip`).toBeTruthy();
    }
  });
});
