/**
 * Event View Command Tests
 *
 * Tests for positional argument parsing and project resolution
 * in src/commands/event/view.ts
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from "bun:test";
import {
  parsePositionalArgs,
  resolveAutoDetectTarget,
  resolveEventTarget,
  resolveOrgAllTarget,
} from "../../../src/commands/event/view.js";
import type { ProjectWithOrg } from "../../../src/lib/api-client.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as apiClient from "../../../src/lib/api-client.js";
import { ProjectSpecificationType } from "../../../src/lib/arg-parsing.js";
import { ContextError, ValidationError } from "../../../src/lib/errors.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as resolveTarget from "../../../src/lib/resolve-target.js";
import { resolveProjectBySlug } from "../../../src/lib/resolve-target.js";

describe("parsePositionalArgs", () => {
  describe("single argument (event ID only)", () => {
    test("parses single arg as event ID", () => {
      const result = parsePositionalArgs(["abc123def456"]);
      expect(result.eventId).toBe("abc123def456");
      expect(result.targetArg).toBeUndefined();
    });

    test("parses UUID-like event ID", () => {
      const result = parsePositionalArgs([
        "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      ]);
      expect(result.eventId).toBe("a1b2c3d4-e5f6-7890-abcd-ef1234567890");
      expect(result.targetArg).toBeUndefined();
    });

    test("parses short event ID", () => {
      const result = parsePositionalArgs(["abc"]);
      expect(result.eventId).toBe("abc");
      expect(result.targetArg).toBeUndefined();
    });
  });

  describe("two arguments (target + event ID)", () => {
    test("parses org/project target and event ID", () => {
      const result = parsePositionalArgs(["my-org/frontend", "abc123def456"]);
      expect(result.targetArg).toBe("my-org/frontend");
      expect(result.eventId).toBe("abc123def456");
    });

    test("parses project-only target and event ID", () => {
      const result = parsePositionalArgs(["frontend", "abc123def456"]);
      expect(result.targetArg).toBe("frontend");
      expect(result.eventId).toBe("abc123def456");
    });

    test("parses org/ target (all projects) and event ID", () => {
      const result = parsePositionalArgs(["my-org/", "abc123def456"]);
      expect(result.targetArg).toBe("my-org/");
      expect(result.eventId).toBe("abc123def456");
    });
  });

  describe("error cases", () => {
    test("throws ContextError for empty args", () => {
      expect(() => parsePositionalArgs([])).toThrow(ContextError);
    });

    test("throws ContextError with usage hint", () => {
      try {
        parsePositionalArgs([]);
        expect.unreachable("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(ContextError);
        expect((error as ContextError).message).toContain("Event ID");
      }
    });
  });

  describe("slash-separated org/project/eventId (single arg)", () => {
    test("parses org/project/eventId as target + event ID", () => {
      const result = parsePositionalArgs(["sentry/cli/abc123def"]);
      expect(result.targetArg).toBe("sentry/cli");
      expect(result.eventId).toBe("abc123def");
    });

    test("parses with long hex event ID", () => {
      const result = parsePositionalArgs([
        "my-org/frontend/a1b2c3d4e5f67890abcdef1234567890",
      ]);
      expect(result.targetArg).toBe("my-org/frontend");
      expect(result.eventId).toBe("a1b2c3d4e5f67890abcdef1234567890");
    });

    test("handles hyphenated org and project slugs", () => {
      const result = parsePositionalArgs(["my-org/my-project/deadbeef"]);
      expect(result.targetArg).toBe("my-org/my-project");
      expect(result.eventId).toBe("deadbeef");
    });

    test("one slash (org/project, missing event ID) throws ContextError", () => {
      expect(() => parsePositionalArgs(["sentry/cli"])).toThrow(ContextError);
    });

    test("trailing slash (org/project/) throws ContextError", () => {
      expect(() => parsePositionalArgs(["sentry/cli/"])).toThrow(ContextError);
    });

    test("one-slash ContextError mentions Event ID", () => {
      try {
        parsePositionalArgs(["sentry/cli"]);
        expect.unreachable("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(ContextError);
        expect((error as ContextError).message).toContain("Event ID");
      }
    });
  });

  describe("edge cases", () => {
    test("handles more than two args (ignores extras)", () => {
      const result = parsePositionalArgs([
        "my-org/frontend",
        "abc123",
        "extra-arg",
      ]);
      expect(result.targetArg).toBe("my-org/frontend");
      expect(result.eventId).toBe("abc123");
    });

    test("handles empty string event ID in two-arg case", () => {
      const result = parsePositionalArgs(["my-org/frontend", ""]);
      expect(result.targetArg).toBe("my-org/frontend");
      expect(result.eventId).toBe("");
    });
  });

  // URL integration tests — applySentryUrlContext may set SENTRY_URL as a side effect
  describe("Sentry URL inputs", () => {
    let savedSentryUrl: string | undefined;

    beforeEach(() => {
      savedSentryUrl = process.env.SENTRY_URL;
      delete process.env.SENTRY_URL;
    });

    afterEach(() => {
      if (savedSentryUrl !== undefined) {
        process.env.SENTRY_URL = savedSentryUrl;
      } else {
        delete process.env.SENTRY_URL;
      }
    });

    test("event URL extracts eventId and passes org as OrgAll target", () => {
      const result = parsePositionalArgs([
        "https://sentry.io/organizations/my-org/issues/32886/events/abc123def456/",
      ]);
      expect(result.eventId).toBe("abc123def456");
      expect(result.targetArg).toBe("my-org/");
    });

    test("self-hosted event URL extracts eventId, passes org, sets SENTRY_URL", () => {
      const result = parsePositionalArgs([
        "https://sentry.example.com/organizations/acme/issues/999/events/deadbeef/",
      ]);
      expect(result.eventId).toBe("deadbeef");
      expect(result.targetArg).toBe("acme/");
      expect(process.env.SENTRY_URL).toBe("https://sentry.example.com");
    });

    test("issue URL without event ID throws ContextError", () => {
      expect(() =>
        parsePositionalArgs([
          "https://sentry.io/organizations/my-org/issues/32886/",
        ])
      ).toThrow(ContextError);
    });

    test("issue-only URL error mentions event ID", () => {
      try {
        parsePositionalArgs([
          "https://sentry.io/organizations/my-org/issues/32886/",
        ]);
        expect.unreachable("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(ContextError);
        expect((error as ContextError).message).toContain("Event ID");
      }
    });

    test("org-only URL throws ContextError", () => {
      expect(() =>
        parsePositionalArgs(["https://sentry.io/organizations/my-org/"])
      ).toThrow(ContextError);
    });
  });
});

describe("resolveProjectBySlug", () => {
  const HINT = "sentry event view <org>/<project> <event-id>";
  let findProjectsBySlugSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    findProjectsBySlugSpy = spyOn(apiClient, "findProjectsBySlug");
  });

  afterEach(() => {
    findProjectsBySlugSpy.mockRestore();
  });

  describe("no projects found", () => {
    test("throws ContextError when project not found", async () => {
      findProjectsBySlugSpy.mockResolvedValue([]);

      await expect(resolveProjectBySlug("my-project", HINT)).rejects.toThrow(
        ContextError
      );
    });

    test("includes project name in error message", async () => {
      findProjectsBySlugSpy.mockResolvedValue([]);

      try {
        await resolveProjectBySlug("frontend", HINT);
        expect.unreachable("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(ContextError);
        expect((error as ContextError).message).toContain('Project "frontend"');
        expect((error as ContextError).message).toContain(
          "Check that you have access"
        );
      }
    });
  });

  describe("multiple projects found", () => {
    test("throws ValidationError when project exists in multiple orgs", async () => {
      findProjectsBySlugSpy.mockResolvedValue([
        { slug: "frontend", orgSlug: "org-a", id: "1", name: "Frontend" },
        { slug: "frontend", orgSlug: "org-b", id: "2", name: "Frontend" },
      ] as ProjectWithOrg[]);

      await expect(resolveProjectBySlug("frontend", HINT)).rejects.toThrow(
        ValidationError
      );
    });

    test("includes all orgs in error message", async () => {
      findProjectsBySlugSpy.mockResolvedValue([
        { slug: "frontend", orgSlug: "acme-corp", id: "1", name: "Frontend" },
        { slug: "frontend", orgSlug: "beta-inc", id: "2", name: "Frontend" },
      ] as ProjectWithOrg[]);

      try {
        await resolveProjectBySlug(
          "frontend",
          HINT,
          "sentry event view <org>/frontend event-456"
        );
        expect.unreachable("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationError);
        const message = (error as ValidationError).message;
        expect(message).toContain("exists in multiple organizations");
        expect(message).toContain("acme-corp/frontend");
        expect(message).toContain("beta-inc/frontend");
        expect(message).toContain("event-456");
      }
    });

    test("includes usage example in error message", async () => {
      findProjectsBySlugSpy.mockResolvedValue([
        { slug: "api", orgSlug: "org-1", id: "1", name: "API" },
        { slug: "api", orgSlug: "org-2", id: "2", name: "API" },
        { slug: "api", orgSlug: "org-3", id: "3", name: "API" },
      ] as ProjectWithOrg[]);

      try {
        await resolveProjectBySlug(
          "api",
          HINT,
          "sentry event view <org>/api abc123"
        );
        expect.unreachable("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationError);
        const message = (error as ValidationError).message;
        expect(message).toContain(
          "Example: sentry event view <org>/api abc123"
        );
      }
    });
  });

  describe("single project found", () => {
    test("returns resolved target for single match", async () => {
      findProjectsBySlugSpy.mockResolvedValue([
        { slug: "backend", orgSlug: "my-company", id: "42", name: "Backend" },
      ] as ProjectWithOrg[]);

      const result = await resolveProjectBySlug("backend", HINT);

      expect(result).toEqual({
        org: "my-company",
        project: "backend",
      });
    });

    test("uses orgSlug from project result", async () => {
      findProjectsBySlugSpy.mockResolvedValue([
        {
          slug: "mobile-app",
          orgSlug: "acme-industries",
          id: "100",
          name: "Mobile App",
        },
      ] as ProjectWithOrg[]);

      const result = await resolveProjectBySlug("mobile-app", HINT);

      expect(result.org).toBe("acme-industries");
    });

    test("preserves project slug in result", async () => {
      findProjectsBySlugSpy.mockResolvedValue([
        { slug: "web-frontend", orgSlug: "org", id: "1", name: "Web Frontend" },
      ] as ProjectWithOrg[]);

      const result = await resolveProjectBySlug("web-frontend", HINT);

      expect(result.project).toBe("web-frontend");
    });
  });

  describe("numeric project ID", () => {
    test("uses numeric-ID-specific error when not found", async () => {
      findProjectsBySlugSpy.mockResolvedValue([]);

      try {
        await resolveProjectBySlug("7275560680", HINT);
        expect.unreachable("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(ContextError);
        const message = (error as ContextError).message;
        expect(message).toContain('Project "7275560680"');
        expect(message).toContain("No project with this ID was found");
      }
    });

    test("writes stderr hint when numeric ID resolves to a different slug", async () => {
      findProjectsBySlugSpy.mockResolvedValue([
        {
          slug: "my-frontend",
          orgSlug: "acme",
          id: "7275560680",
          name: "Frontend",
        },
      ] as ProjectWithOrg[]);
      const stderrWrite = mock(() => true);
      const stderr = { write: stderrWrite };

      const result = await resolveProjectBySlug(
        "7275560680",
        HINT,
        undefined,
        stderr
      );

      expect(result).toEqual({ org: "acme", project: "my-frontend" });
      expect(stderrWrite).toHaveBeenCalledTimes(1);
      const hint = stderrWrite.mock.calls[0][0] as string;
      expect(hint).toContain("7275560680");
      expect(hint).toContain("acme/my-frontend");
    });

    test("does not write hint when stderr is not provided", async () => {
      findProjectsBySlugSpy.mockResolvedValue([
        {
          slug: "my-frontend",
          orgSlug: "acme",
          id: "7275560680",
          name: "Frontend",
        },
      ] as ProjectWithOrg[]);

      // Should not throw even without stderr
      const result = await resolveProjectBySlug("7275560680", HINT);
      expect(result).toEqual({ org: "acme", project: "my-frontend" });
    });
  });
});

describe("resolveEventTarget", () => {
  let resolveEventInOrgSpy: ReturnType<typeof spyOn>;
  let findEventAcrossOrgsSpy: ReturnType<typeof spyOn>;
  let resolveOrgAndProjectSpy: ReturnType<typeof spyOn>;
  let resolveProjectBySlugSpy: ReturnType<typeof spyOn>;

  const mockStderr = { write: mock(() => true) };

  beforeEach(() => {
    resolveEventInOrgSpy = spyOn(apiClient, "resolveEventInOrg");
    findEventAcrossOrgsSpy = spyOn(apiClient, "findEventAcrossOrgs");
    resolveOrgAndProjectSpy = spyOn(resolveTarget, "resolveOrgAndProject");
    resolveProjectBySlugSpy = spyOn(resolveTarget, "resolveProjectBySlug");
  });

  afterEach(() => {
    resolveEventInOrgSpy.mockRestore();
    findEventAcrossOrgsSpy.mockRestore();
    resolveOrgAndProjectSpy.mockRestore();
    resolveProjectBySlugSpy.mockRestore();
    mockStderr.write.mockClear();
  });

  test("returns explicit target directly", async () => {
    const result = await resolveEventTarget({
      parsed: {
        type: ProjectSpecificationType.Explicit,
        org: "acme",
        project: "cli",
      },
      eventId: "abc123",
      cwd: "/tmp",
      stderr: mockStderr,
    });

    expect(result).toEqual({
      org: "acme",
      project: "cli",
      orgDisplay: "acme",
      projectDisplay: "cli",
    });
  });

  test("resolves project search via resolveProjectBySlug", async () => {
    resolveProjectBySlugSpy.mockResolvedValue({
      org: "acme",
      project: "frontend",
    });

    const result = await resolveEventTarget({
      parsed: {
        type: ProjectSpecificationType.ProjectSearch,
        projectSlug: "frontend",
      },
      eventId: "abc123",
      cwd: "/tmp",
      stderr: mockStderr,
    });

    expect(result).toEqual({
      org: "acme",
      project: "frontend",
      orgDisplay: "acme",
      projectDisplay: "frontend",
    });
  });

  test("delegates OrgAll to resolveOrgAllTarget", async () => {
    resolveEventInOrgSpy.mockResolvedValue({
      org: "acme",
      project: "backend",
      event: { eventID: "abc123" },
    });

    const result = await resolveEventTarget({
      parsed: { type: ProjectSpecificationType.OrgAll, org: "acme" },
      eventId: "abc123",
      cwd: "/tmp",
      stderr: mockStderr,
    });

    expect(result?.org).toBe("acme");
    expect(result?.project).toBe("backend");
    expect(result?.prefetchedEvent).toBeDefined();
  });

  test("delegates AutoDetect to resolveAutoDetectTarget", async () => {
    resolveOrgAndProjectSpy.mockResolvedValue({
      org: "acme",
      project: "cli",
      orgDisplay: "acme",
      projectDisplay: "cli",
    });

    const result = await resolveEventTarget({
      parsed: { type: ProjectSpecificationType.AutoDetect },
      eventId: "abc123",
      cwd: "/tmp",
      stderr: mockStderr,
    });

    expect(result?.org).toBe("acme");
  });

  test("returns null for unknown parsed type", async () => {
    const result = await resolveEventTarget({
      parsed: { type: "unknown" as any },
      eventId: "abc123",
      cwd: "/tmp",
      stderr: mockStderr,
    });

    expect(result).toBeNull();
  });
});

describe("resolveOrgAllTarget", () => {
  let resolveEventInOrgSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    resolveEventInOrgSpy = spyOn(apiClient, "resolveEventInOrg");
  });

  afterEach(() => {
    resolveEventInOrgSpy.mockRestore();
  });

  test("returns resolved target when event found in org", async () => {
    resolveEventInOrgSpy.mockResolvedValue({
      org: "acme",
      project: "frontend",
      event: { eventID: "abc123" },
    });

    const result = await resolveOrgAllTarget("acme", "abc123", "/tmp");

    expect(result).not.toBeNull();
    expect(result?.org).toBe("acme");
    expect(result?.project).toBe("frontend");
    expect(result?.prefetchedEvent?.eventID).toBe("abc123");
  });

  test("throws ContextError when event not found in explicit org", async () => {
    resolveEventInOrgSpy.mockResolvedValue(null);

    await expect(
      resolveOrgAllTarget("acme", "notfound", "/tmp")
    ).rejects.toBeInstanceOf(ContextError);
  });

  test("propagates errors from resolveEventInOrg", async () => {
    const err = new Error("Auth failed");
    resolveEventInOrgSpy.mockRejectedValue(err);

    await expect(resolveOrgAllTarget("acme", "abc123", "/tmp")).rejects.toBe(
      err
    );
  });
});

describe("resolveAutoDetectTarget", () => {
  let findEventAcrossOrgsSpy: ReturnType<typeof spyOn>;
  let resolveOrgAndProjectSpy: ReturnType<typeof spyOn>;

  const mockStderr = { write: mock(() => true) };

  beforeEach(() => {
    findEventAcrossOrgsSpy = spyOn(apiClient, "findEventAcrossOrgs");
    resolveOrgAndProjectSpy = spyOn(resolveTarget, "resolveOrgAndProject");
  });

  afterEach(() => {
    findEventAcrossOrgsSpy.mockRestore();
    resolveOrgAndProjectSpy.mockRestore();
    mockStderr.write.mockClear();
  });

  test("returns auto-detect target when it resolves", async () => {
    resolveOrgAndProjectSpy.mockResolvedValue({
      org: "acme",
      project: "cli",
      orgDisplay: "acme",
      projectDisplay: "cli",
    });

    const result = await resolveAutoDetectTarget("abc123", "/tmp", mockStderr);

    expect(result?.org).toBe("acme");
    expect(result?.project).toBe("cli");
    expect(findEventAcrossOrgsSpy).not.toHaveBeenCalled();
  });

  test("falls back to findEventAcrossOrgs when auto-detect returns null", async () => {
    resolveOrgAndProjectSpy.mockResolvedValue(null);
    findEventAcrossOrgsSpy.mockResolvedValue({
      org: "other-org",
      project: "backend",
      event: { eventID: "abc123" },
    });

    const result = await resolveAutoDetectTarget("abc123", "/tmp", mockStderr);

    expect(result?.org).toBe("other-org");
    expect(result?.project).toBe("backend");
    expect(result?.prefetchedEvent?.eventID).toBe("abc123");
    expect(findEventAcrossOrgsSpy).toHaveBeenCalledWith("abc123");
  });

  test("writes stderr tip when event found via cross-project search", async () => {
    resolveOrgAndProjectSpy.mockResolvedValue(null);
    findEventAcrossOrgsSpy.mockResolvedValue({
      org: "acme",
      project: "frontend",
      event: { eventID: "abc123" },
    });

    await resolveAutoDetectTarget("abc123", "/tmp", mockStderr);

    expect(mockStderr.write).toHaveBeenCalledTimes(1);
    const hint = mockStderr.write.mock.calls[0][0] as string;
    expect(hint).toContain("acme/frontend");
    expect(hint).toContain("SENTRY_ORG=acme");
  });

  test("returns null when both auto-detect and cross-project fail", async () => {
    resolveOrgAndProjectSpy.mockResolvedValue(null);
    findEventAcrossOrgsSpy.mockResolvedValue(null);

    const result = await resolveAutoDetectTarget("abc123", "/tmp", mockStderr);

    expect(result).toBeNull();
  });
});
