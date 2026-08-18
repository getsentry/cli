import { describe, expect, it, vi } from "vitest";
import type { Capture } from "../../../src/lib/doctor/types.js";

const baseCapture: Capture = {
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
      sourcePath: "src/instrument.ts",
    },
  ],
  initSites: [],
  buildConfigs: [],
  manifests: {},
};

describe("resolveServerFacts", () => {
  it("reports unreachable without throwing when the API is down", async () => {
    vi.resetModules();
    vi.doMock("../../../src/lib/api/projects.js", () => ({
      findProjectByDsnKey: vi.fn().mockRejectedValue(new Error("ENOTFOUND")),
      getProjectKeys: vi.fn(),
    }));

    const { resolveServerFacts } = await import(
      "../../../src/lib/doctor/resolve.js"
    );
    const facts = await resolveServerFacts(baseCapture);

    expect(facts.reachable).toBe(false);
    expect(facts.unreachableReason).toContain("ENOTFOUND");
  });

  it("collects project facts and tolerates a single failing endpoint", async () => {
    vi.resetModules();
    vi.doMock("../../../src/lib/api/projects.js", () => ({
      findProjectByDsnKey: vi.fn().mockResolvedValue({
        slug: "web",
        platform: "javascript-react",
        firstEvent: "2026-08-01T00:00:00Z",
        organization: { slug: "acme" },
      }),
      getProjectKeys: vi.fn().mockResolvedValue([
        {
          isActive: true,
          dsn: { public: "https://abc123@h/42" },
        },
      ]),
    }));
    vi.doMock("../../../src/lib/api/issues.js", () => ({
      listIssuesPaginated: vi
        .fn()
        .mockResolvedValue({ data: [{ lastSeen: "2026-08-17T12:00:00Z" }] }),
    }));
    vi.doMock("../../../src/lib/api/releases.js", () => ({
      listProjectEnvironments: vi.fn().mockRejectedValue(new Error("403")),
      listReleasesForProject: vi.fn().mockResolvedValue([]),
    }));

    const { resolveServerFacts } = await import(
      "../../../src/lib/doctor/resolve.js"
    );
    const facts = await resolveServerFacts(baseCapture);

    expect(facts.reachable).toBe(true);
    expect(facts.org).toBe("acme");
    expect(facts.project).toBe("web");
    expect(facts.firstEvent).toBe("2026-08-01T00:00:00Z");
    expect(facts.lastIssueSeen).toBe("2026-08-17T12:00:00Z");
    expect(facts.dsnMatchesProject).toBe(true);
    expect(facts.keys).toEqual([{ publicKey: "abc123", isActive: true }]);
    expect(facts.latestRelease).toBeNull();
    // The failing endpoint leaves its field absent rather than failing the run.
    expect(facts.environments).toBeUndefined();
  });

  it("returns unreachable-free empty facts when no DSN was captured", async () => {
    vi.resetModules();
    const { resolveServerFacts } = await import(
      "../../../src/lib/doctor/resolve.js"
    );
    const facts = await resolveServerFacts({ ...baseCapture, dsns: [] });

    expect(facts.reachable).toBe(false);
    expect(facts.unreachableReason).toContain("No DSN");
  });
});
