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

  it("lists debug files from files/dsyms, not the assemble-only files/difs path", async () => {
    vi.resetModules();
    const apiRequestToRegion = vi
      .fn()
      .mockResolvedValue({ data: [{ id: "1" }] });
    vi.doMock("../../../src/lib/api/infrastructure.js", () => ({
      apiRequestToRegion,
    }));
    vi.doMock("../../../src/lib/region.js", () => ({
      resolveOrgRegion: vi.fn().mockResolvedValue("us"),
    }));
    vi.doMock("../../../src/lib/api/projects.js", () => ({
      findProjectByDsnKey: vi.fn().mockResolvedValue({
        slug: "web",
        organization: { slug: "acme" },
      }),
      getProjectKeys: vi.fn().mockResolvedValue([]),
    }));
    vi.doMock("../../../src/lib/api/issues.js", () => ({
      listIssuesPaginated: vi.fn().mockResolvedValue({ data: [] }),
    }));
    vi.doMock("../../../src/lib/api/releases.js", () => ({
      listProjectEnvironments: vi.fn().mockResolvedValue([]),
      listReleasesForProject: vi.fn().mockResolvedValue([]),
    }));

    const { resolveServerFacts } = await import(
      "../../../src/lib/doctor/resolve.js"
    );
    const facts = await resolveServerFacts(baseCapture);

    expect(facts.hasUploadedArtifacts).toBe(true);
    expect(apiRequestToRegion).toHaveBeenCalledWith(
      "us",
      "projects/acme/web/files/dsyms/"
    );
    expect(apiRequestToRegion).toHaveBeenCalledWith(
      "us",
      "projects/acme/web/files/artifact-bundles/"
    );
    expect(apiRequestToRegion).not.toHaveBeenCalledWith(
      "us",
      "projects/acme/web/files/difs/"
    );
  });

  it("treats a non-empty artifact-bundles listing as uploaded artifacts", async () => {
    vi.resetModules();
    const apiRequestToRegion = vi.fn().mockImplementation((_region, path) => {
      if (String(path).includes("artifact-bundles")) {
        return { data: [{ id: "bundle-1" }] };
      }
      return { data: [] };
    });
    vi.doMock("../../../src/lib/api/infrastructure.js", () => ({
      apiRequestToRegion,
    }));
    vi.doMock("../../../src/lib/region.js", () => ({
      resolveOrgRegion: vi.fn().mockResolvedValue("us"),
    }));
    vi.doMock("../../../src/lib/api/projects.js", () => ({
      findProjectByDsnKey: vi.fn().mockResolvedValue({
        slug: "web",
        organization: { slug: "acme" },
      }),
      getProjectKeys: vi.fn().mockResolvedValue([]),
    }));
    vi.doMock("../../../src/lib/api/issues.js", () => ({
      listIssuesPaginated: vi.fn().mockResolvedValue({ data: [] }),
    }));
    vi.doMock("../../../src/lib/api/releases.js", () => ({
      listProjectEnvironments: vi.fn().mockResolvedValue([]),
      listReleasesForProject: vi.fn().mockResolvedValue([]),
    }));

    const { resolveServerFacts } = await import(
      "../../../src/lib/doctor/resolve.js"
    );
    const facts = await resolveServerFacts(baseCapture);

    expect(facts.hasUploadedArtifacts).toBe(true);
  });

  it("prefers a recent release that has events over a newer unused sibling", async () => {
    vi.resetModules();
    const listReleasesForProject = vi.fn().mockResolvedValue([
      { version: "io.sentry.samples.android@8.53.0+2", lastEvent: null },
      {
        version: "io.sentry.samples.android.debug@8.53.0+2",
        lastEvent: "2026-08-18T10:00:00Z",
      },
    ]);
    vi.doMock("../../../src/lib/api/projects.js", () => ({
      findProjectByDsnKey: vi.fn().mockResolvedValue({
        slug: "web",
        organization: { slug: "acme" },
      }),
      getProjectKeys: vi.fn().mockResolvedValue([]),
    }));
    vi.doMock("../../../src/lib/api/issues.js", () => ({
      listIssuesPaginated: vi.fn().mockResolvedValue({ data: [] }),
    }));
    vi.doMock("../../../src/lib/api/releases.js", () => ({
      listProjectEnvironments: vi.fn().mockResolvedValue([]),
      listReleasesForProject,
    }));
    vi.doMock("../../../src/lib/api/infrastructure.js", () => ({
      apiRequestToRegion: vi.fn().mockResolvedValue({ data: [] }),
    }));
    vi.doMock("../../../src/lib/region.js", () => ({
      resolveOrgRegion: vi.fn().mockResolvedValue("us"),
    }));

    const { resolveServerFacts } = await import(
      "../../../src/lib/doctor/resolve.js"
    );
    const facts = await resolveServerFacts(baseCapture);

    expect(listReleasesForProject).toHaveBeenCalledWith(
      "acme",
      "web",
      expect.objectContaining({ perPage: 20 })
    );
    expect(facts.latestRelease).toEqual({
      version: "io.sentry.samples.android.debug@8.53.0+2",
      lastEvent: "2026-08-18T10:00:00Z",
    });
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

  it("skips lookup when the DSN host is not the logged-in instance", async () => {
    vi.resetModules();
    const findProjectByDsnKey = vi.fn();
    vi.doMock("../../../src/lib/api/projects.js", () => ({
      findProjectByDsnKey,
      getProjectKeys: vi.fn(),
    }));
    vi.doMock("../../../src/lib/token-host.js", async (importOriginal) => {
      const actual =
        await importOriginal<typeof import("../../../src/lib/token-host.js")>();
      return { ...actual, getActiveTokenHost: () => "https://sentry.io" };
    });

    const { resolveServerFacts } = await import(
      "../../../src/lib/doctor/resolve.js"
    );
    const facts = await resolveServerFacts({
      ...baseCapture,
      dsns: [
        {
          ...baseCapture.dsns[0]!,
          host: "sandbox-mirror.sentry.gg",
          raw: "https://abc123@sandbox-mirror.sentry.gg/1",
        },
      ],
    });

    expect(findProjectByDsnKey).not.toHaveBeenCalled();
    expect(facts.reachable).toBe(false);
    expect(facts.unreachableReason).toMatch(/sandbox-mirror\.sentry\.gg/);
    expect(facts.unreachableReason).toMatch(/sentry\.io/);
  });

  it("resolves via sentry.properties when dsn: search misses", async () => {
    vi.resetModules();
    const { mkdtemp, writeFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const cwd = await mkdtemp(join(tmpdir(), "doctor-props-"));
    await writeFile(
      join(cwd, "sentry.properties"),
      "defaults.org=demo\ndefaults.project=android\n"
    );

    vi.doMock("../../../src/lib/api/projects.js", () => ({
      findProjectByDsnKey: vi.fn().mockResolvedValue(null),
      getProjectKeys: vi.fn().mockResolvedValue([
        {
          isActive: true,
          dsn: { public: "https://abc123@h/1" },
        },
      ]),
    }));
    vi.doMock("../../../src/lib/api/issues.js", () => ({
      listIssuesPaginated: vi.fn().mockResolvedValue({ data: [] }),
    }));
    vi.doMock("../../../src/lib/api/releases.js", () => ({
      listProjectEnvironments: vi.fn().mockResolvedValue([]),
      listReleasesForProject: vi.fn().mockResolvedValue([]),
    }));
    vi.doMock("../../../src/lib/api/infrastructure.js", () => ({
      apiRequestToRegion: vi.fn().mockResolvedValue({ data: [] }),
    }));
    vi.doMock("../../../src/lib/region.js", () => ({
      resolveOrgRegion: vi.fn().mockResolvedValue("us"),
    }));

    const { resolveServerFacts } = await import(
      "../../../src/lib/doctor/resolve.js"
    );
    const facts = await resolveServerFacts({ ...baseCapture, cwd });

    expect(facts.dsnMatchesProject).toBe(true);
    expect(facts.org).toBe("demo");
    expect(facts.project).toBe("android");
  });
});
