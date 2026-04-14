/**
 * Event View Command Tests
 *
 * Tests for positional argument parsing, project resolution,
 * and viewCommand func() body in src/commands/event/view.ts
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
  fetchEventWithContext,
  parsePositionalArgs,
  resolveAutoDetectTarget,
  resolveEventTarget,
  resolveOrgAllTarget,
  viewCommand,
} from "../../../src/commands/event/view.js";
import type { ProjectWithOrg } from "../../../src/lib/api-client.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as apiClient from "../../../src/lib/api-client.js";
import { ProjectSpecificationType } from "../../../src/lib/arg-parsing.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as browser from "../../../src/lib/browser.js";
import { DEFAULT_SENTRY_URL } from "../../../src/lib/constants.js";
import { setOrgRegion } from "../../../src/lib/db/regions.js";
import {
  ApiError,
  AuthError,
  ContextError,
  ResolutionError,
  ValidationError,
} from "../../../src/lib/errors.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as resolveTarget from "../../../src/lib/resolve-target.js";
import { resolveProjectBySlug } from "../../../src/lib/resolve-target.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as spanTree from "../../../src/lib/span-tree.js";
import type { SentryEvent } from "../../../src/types/index.js";

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

    test("detects issue short ID and sets issueShortId", () => {
      const result = parsePositionalArgs(["BRUNCHIE-APP-29"]);
      expect(result.eventId).toBe("@latest");
      expect(result.targetArg).toBeUndefined();
      expect(result.issueShortId).toBe("BRUNCHIE-APP-29");
    });

    test("detects short issue ID like CLI-G", () => {
      const result = parsePositionalArgs(["CLI-G"]);
      expect(result.eventId).toBe("@latest");
      expect(result.issueShortId).toBe("CLI-G");
    });

    test("does not detect lowercase slug as issue short ID", () => {
      const result = parsePositionalArgs(["my-project"]);
      expect(result.eventId).toBe("my-project");
      expect(result.issueShortId).toBeUndefined();
    });

    test("detects org/ISSUE-SHORT-ID pattern (CLI-9K)", () => {
      const result = parsePositionalArgs(["figma/FULLSCREEN-2RN"]);
      expect(result.eventId).toBe("@latest");
      // Trailing slash signals OrgAll mode so downstream resolves org correctly
      expect(result.targetArg).toBe("figma/");
      expect(result.issueShortId).toBe("FULLSCREEN-2RN");
    });

    test("detects org/CLI-G pattern", () => {
      const result = parsePositionalArgs(["sentry/CLI-G"]);
      expect(result.eventId).toBe("@latest");
      expect(result.targetArg).toBe("sentry/");
      expect(result.issueShortId).toBe("CLI-G");
    });

    test("detects SHORT-ID/EVENT-ID pattern (CLI-HV)", () => {
      const result = parsePositionalArgs([
        "CLI-G5/abc123def456abc123def456abc123de",
      ]);
      expect(result.eventId).toBe("abc123def456abc123def456abc123de");
      expect(result.targetArg).toBeUndefined();
      expect(result.issueShortId).toBe("CLI-G5");
    });

    test("detects multi-dash SHORT-ID/EVENT-ID pattern", () => {
      const result = parsePositionalArgs([
        "PHP-SYMFONY-HY/7388f6a62b7d436ab77bb5365f97a1ac",
      ]);
      expect(result.eventId).toBe("7388f6a62b7d436ab77bb5365f97a1ac");
      expect(result.targetArg).toBeUndefined();
      expect(result.issueShortId).toBe("PHP-SYMFONY-HY");
    });

    test("normalizes UUID-format event ID in SHORT-ID/EVENT-ID", () => {
      const result = parsePositionalArgs([
        "CLI-G5/7388f6a6-2b7d-436a-b77b-b5365f97a1ac",
      ]);
      expect(result.eventId).toBe("7388f6a62b7d436ab77bb5365f97a1ac");
      expect(result.issueShortId).toBe("CLI-G5");
    });

    test("org/SHORT-ID takes precedence over SHORT-ID/EVENT-ID", () => {
      // "figma/FULLSCREEN-2RN" → org + issue, not issue + event
      const result = parsePositionalArgs(["figma/FULLSCREEN-2RN"]);
      expect(result.eventId).toBe("@latest");
      expect(result.targetArg).toBe("figma/");
      expect(result.issueShortId).toBe("FULLSCREEN-2RN");
    });

    test("does not detect org/lowercase-slug as issue short ID", () => {
      // "my-org/my-project" is a normal org/project target, not an issue short ID.
      // parseSlashSeparatedArg will throw ContextError as expected.
      expect(() => parsePositionalArgs(["my-org/my-project"])).toThrow(
        "Event ID"
      );
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

    test("auto-redirects issue short ID in first arg to issueShortId (CLI-MP)", () => {
      // "JAVASCRIPT-NUXT-52" matches looksLikeIssueShortId → redirect to issue's
      // latest event instead of treating it as a project slug (which would fail).
      const result = parsePositionalArgs([
        "JAVASCRIPT-NUXT-52",
        "abc123def456",
      ]);
      expect(result.issueShortId).toBe("JAVASCRIPT-NUXT-52");
      expect(result.eventId).toBe("@latest");
      expect(result.targetArg).toBeUndefined();
      expect(result.warning).toContain("issue short ID");
    });

    test("auto-redirects simple issue short ID like CAM-82X", () => {
      const result = parsePositionalArgs(["CAM-82X", "95fd7f5a"]);
      expect(result.issueShortId).toBe("CAM-82X");
      expect(result.eventId).toBe("@latest");
      expect(result.targetArg).toBeUndefined();
      expect(result.warning).toContain("issue short ID");
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

  // URL integration tests — applySentryUrlContext may set SENTRY_HOST/SENTRY_URL as a side effect
  describe("Sentry URL inputs", () => {
    let savedSentryUrl: string | undefined;
    let savedSentryHost: string | undefined;

    beforeEach(() => {
      savedSentryUrl = process.env.SENTRY_URL;
      savedSentryHost = process.env.SENTRY_HOST;
      delete process.env.SENTRY_URL;
      delete process.env.SENTRY_HOST;
    });

    afterEach(() => {
      if (savedSentryUrl !== undefined) {
        process.env.SENTRY_URL = savedSentryUrl;
      } else {
        delete process.env.SENTRY_URL;
      }
      if (savedSentryHost !== undefined) {
        process.env.SENTRY_HOST = savedSentryHost;
      } else {
        delete process.env.SENTRY_HOST;
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

    test("issue URL without event ID returns issueId for latest event fetch", () => {
      const result = parsePositionalArgs([
        "https://sentry.io/organizations/my-org/issues/32886/",
      ]);
      expect(result.issueId).toBe("32886");
      expect(result.eventId).toBe("@latest");
      expect(result.targetArg).toBe("my-org/");
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
    test("throws ResolutionError when project not found", async () => {
      findProjectsBySlugSpy.mockResolvedValue({ projects: [], orgs: [] });

      await expect(resolveProjectBySlug("my-project", HINT)).rejects.toThrow(
        ResolutionError
      );
    });

    test("includes project name in error message", async () => {
      findProjectsBySlugSpy.mockResolvedValue({ projects: [], orgs: [] });

      try {
        await resolveProjectBySlug("frontend", HINT);
        expect.unreachable("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(ResolutionError);
        expect((error as ResolutionError).message).toContain(
          'Project "frontend"'
        );
        expect((error as ResolutionError).message).toContain(
          "Check that you have access"
        );
        // Message says "not found", not "is required"
        expect((error as ResolutionError).message).toContain("not found");
      }
    });
  });

  test("throws ResolutionError with org hint when slug matches an organization", async () => {
    findProjectsBySlugSpy.mockResolvedValue({
      projects: [],
      orgs: [{ slug: "acme-corp", name: "Acme Corp" }],
    });

    try {
      await resolveProjectBySlug("acme-corp", HINT);
      expect.unreachable("Should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ResolutionError);
      const msg = (error as ResolutionError).message;
      expect(msg).toContain("is an organization, not a project");
      expect(msg).toContain("acme-corp/<project>");
    }
  });

  test("org hint replaces <org>/<project> placeholder, not slug in command name", async () => {
    findProjectsBySlugSpy.mockResolvedValue({
      projects: [],
      orgs: [{ slug: "sentry", name: "Sentry" }],
    });

    try {
      await resolveProjectBySlug("sentry", HINT);
      expect.unreachable("Should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ResolutionError);
      const msg = (error as ResolutionError).message;
      // Should substitute the <org>/<project> placeholder, not the "sentry" in the command name
      expect(msg).toContain("sentry event view sentry/<project>");
      // "sentry" command prefix should still be intact
      expect(msg).not.toContain("sentry/<project> event view");
    }
  });

  describe("multiple projects found", () => {
    test("throws ValidationError when project exists in multiple orgs", async () => {
      findProjectsBySlugSpy.mockResolvedValue({
        projects: [
          { slug: "frontend", orgSlug: "org-a", id: "1", name: "Frontend" },
          { slug: "frontend", orgSlug: "org-b", id: "2", name: "Frontend" },
        ] as ProjectWithOrg[],
        orgs: [],
      });

      await expect(resolveProjectBySlug("frontend", HINT)).rejects.toThrow(
        ValidationError
      );
    });

    test("includes all orgs in error message", async () => {
      findProjectsBySlugSpy.mockResolvedValue({
        projects: [
          { slug: "frontend", orgSlug: "acme-corp", id: "1", name: "Frontend" },
          { slug: "frontend", orgSlug: "beta-inc", id: "2", name: "Frontend" },
        ] as ProjectWithOrg[],
        orgs: [],
      });

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
      findProjectsBySlugSpy.mockResolvedValue({
        projects: [
          { slug: "api", orgSlug: "org-1", id: "1", name: "API" },
          { slug: "api", orgSlug: "org-2", id: "2", name: "API" },
          { slug: "api", orgSlug: "org-3", id: "3", name: "API" },
        ] as ProjectWithOrg[],
        orgs: [],
      });

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
      findProjectsBySlugSpy.mockResolvedValue({
        projects: [
          { slug: "backend", orgSlug: "my-company", id: "42", name: "Backend" },
        ] as ProjectWithOrg[],
        orgs: [],
      });

      const result = await resolveProjectBySlug("backend", HINT);

      expect(result).toMatchObject({
        org: "my-company",
        project: "backend",
      });
      expect(result.projectData).toBeDefined();
    });

    test("uses orgSlug from project result", async () => {
      findProjectsBySlugSpy.mockResolvedValue({
        projects: [
          {
            slug: "mobile-app",
            orgSlug: "acme-industries",
            id: "100",
            name: "Mobile App",
          },
        ] as ProjectWithOrg[],
        orgs: [],
      });

      const result = await resolveProjectBySlug("mobile-app", HINT);

      expect(result.org).toBe("acme-industries");
    });

    test("preserves project slug in result", async () => {
      findProjectsBySlugSpy.mockResolvedValue({
        projects: [
          {
            slug: "web-frontend",
            orgSlug: "org",
            id: "1",
            name: "Web Frontend",
          },
        ] as ProjectWithOrg[],
        orgs: [],
      });

      const result = await resolveProjectBySlug("web-frontend", HINT);

      expect(result.project).toBe("web-frontend");
    });
  });

  describe("numeric project ID", () => {
    test("uses numeric-ID-specific error when not found", async () => {
      findProjectsBySlugSpy.mockResolvedValue({ projects: [], orgs: [] });

      try {
        await resolveProjectBySlug("7275560680", HINT);
        expect.unreachable("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(ResolutionError);
        const message = (error as ResolutionError).message;
        expect(message).toContain('Project "7275560680"');
        expect(message).toContain("No project with this ID was found");
        // Message says "not found", not "is required"
        expect(message).toContain("not found");
      }
    });

    test("resolves numeric ID to correct slug", async () => {
      findProjectsBySlugSpy.mockResolvedValue({
        projects: [
          {
            slug: "my-frontend",
            orgSlug: "acme",
            id: "7275560680",
            name: "Frontend",
          },
        ] as ProjectWithOrg[],
        orgs: [],
      });

      const result = await resolveProjectBySlug("7275560680", HINT);
      expect(result).toMatchObject({ org: "acme", project: "my-frontend" });
      expect(result.projectData).toBeDefined();
    });
  });
});

describe("resolveEventTarget", () => {
  let resolveEventInOrgSpy: ReturnType<typeof spyOn>;
  let findEventAcrossOrgsSpy: ReturnType<typeof spyOn>;
  let resolveOrgAndProjectSpy: ReturnType<typeof spyOn>;
  let resolveProjectBySlugSpy: ReturnType<typeof spyOn>;

  beforeEach(async () => {
    resolveEventInOrgSpy = spyOn(apiClient, "resolveEventInOrg");
    findEventAcrossOrgsSpy = spyOn(apiClient, "findEventAcrossOrgs");
    resolveOrgAndProjectSpy = spyOn(resolveTarget, "resolveOrgAndProject");
    resolveProjectBySlugSpy = spyOn(resolveTarget, "resolveProjectBySlug");
    setOrgRegion("acme", DEFAULT_SENTRY_URL);
  });

  afterEach(() => {
    resolveEventInOrgSpy.mockRestore();
    findEventAcrossOrgsSpy.mockRestore();
    resolveOrgAndProjectSpy.mockRestore();
    resolveProjectBySlugSpy.mockRestore();
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
    });

    expect(result?.org).toBe("acme");
  });

  test("returns null for unknown parsed type", async () => {
    const result = await resolveEventTarget({
      parsed: { type: "unknown" as any },
      eventId: "abc123",
      cwd: "/tmp",
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

  test("throws ResolutionError when event not found in explicit org", async () => {
    resolveEventInOrgSpy.mockResolvedValue(null);

    await expect(
      resolveOrgAllTarget("acme", "notfound", "/tmp")
    ).rejects.toBeInstanceOf(ResolutionError);
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

  beforeEach(() => {
    findEventAcrossOrgsSpy = spyOn(apiClient, "findEventAcrossOrgs");
    resolveOrgAndProjectSpy = spyOn(resolveTarget, "resolveOrgAndProject");
  });

  afterEach(() => {
    findEventAcrossOrgsSpy.mockRestore();
    resolveOrgAndProjectSpy.mockRestore();
  });

  test("returns auto-detect target when it resolves", async () => {
    resolveOrgAndProjectSpy.mockResolvedValue({
      org: "acme",
      project: "cli",
      orgDisplay: "acme",
      projectDisplay: "cli",
    });

    const result = await resolveAutoDetectTarget("abc123", "/tmp");

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

    const result = await resolveAutoDetectTarget("abc123", "/tmp");

    expect(result?.org).toBe("other-org");
    expect(result?.project).toBe("backend");
    expect(result?.prefetchedEvent?.eventID).toBe("abc123");
    expect(findEventAcrossOrgsSpy).toHaveBeenCalledWith("abc123");
  });

  test("returns resolved target when event found via cross-project search", async () => {
    resolveOrgAndProjectSpy.mockResolvedValue(null);
    findEventAcrossOrgsSpy.mockResolvedValue({
      org: "acme",
      project: "frontend",
      event: { eventID: "abc123" },
    });

    const result = await resolveAutoDetectTarget("abc123", "/tmp");

    expect(result?.org).toBe("acme");
    expect(result?.project).toBe("frontend");
    expect(result?.prefetchedEvent?.eventID).toBe("abc123");
  });

  test("returns null when both auto-detect and cross-project fail", async () => {
    resolveOrgAndProjectSpy.mockResolvedValue(null);
    findEventAcrossOrgsSpy.mockResolvedValue(null);

    const result = await resolveAutoDetectTarget("abc123", "/tmp");

    expect(result).toBeNull();
  });
});

// ============================================================================
// viewCommand.func() — coverage for warning and normalized paths
// ============================================================================

describe("viewCommand.func", () => {
  let getEventSpy: ReturnType<typeof spyOn>;
  let getSpanTreeLinesSpy: ReturnType<typeof spyOn>;
  let openInBrowserSpy: ReturnType<typeof spyOn>;
  let resolveProjectBySlugSpy: ReturnType<typeof spyOn>;

  const VALID_EVENT_ID = "abc123def456abc123def456abc123de";
  const sampleEvent: SentryEvent = {
    eventID: VALID_EVENT_ID,
    title: "Error: test",
    metadata: {},
    contexts: {},
  } as unknown as SentryEvent;

  function createMockContext() {
    const stdoutWrite = mock(() => true);
    return {
      context: {
        stdout: { write: stdoutWrite },
        stderr: { write: mock(() => true) },
        cwd: "/tmp",
      },
      stdoutWrite,
    };
  }

  beforeEach(async () => {
    getEventSpy = spyOn(apiClient, "getEvent");
    getSpanTreeLinesSpy = spyOn(spanTree, "getSpanTreeLines");
    openInBrowserSpy = spyOn(browser, "openInBrowser");
    resolveProjectBySlugSpy = spyOn(resolveTarget, "resolveProjectBySlug");
    setOrgRegion("test-org", DEFAULT_SENTRY_URL);
  });

  afterEach(() => {
    getEventSpy.mockRestore();
    getSpanTreeLinesSpy.mockRestore();
    openInBrowserSpy.mockRestore();
    resolveProjectBySlugSpy.mockRestore();
  });

  test("logs warning when args appear swapped", async () => {
    // Swapped args: event ID first, then org/project target
    getEventSpy.mockResolvedValue(sampleEvent);
    getSpanTreeLinesSpy.mockResolvedValue({
      lines: [],
      spans: null,
      traceId: null,
      success: false,
    });

    const { context } = createMockContext();
    const func = await viewCommand.loader();
    // Valid 32-char hex has no slash, "test-org/test-proj" has slash → swap detected
    await func.call(
      context,
      { json: true, web: false, spans: 0 },
      VALID_EVENT_ID,
      "test-org/test-proj"
    );

    // Command should complete without error (warning goes to consola, not stdout)
    expect(getEventSpy).toHaveBeenCalled();
  });

  test("auto-redirects issue short ID in two-arg form via issueShortId path", async () => {
    // "CAM-82X" as first arg matches looksLikeIssueShortId → sets issueShortId,
    // NOT targetArg. The resolveIssueShortcut path fetches the latest event.
    const resolveOrgSpy = spyOn(resolveTarget, "resolveOrg").mockResolvedValue({
      org: "cam-org",
    });
    const getIssueByShortIdSpy = spyOn(
      apiClient,
      "getIssueByShortId"
    ).mockResolvedValue({ id: "999", shortId: "CAM-82X" } as never);
    const getLatestEventSpy = spyOn(
      apiClient,
      "getLatestEvent"
    ).mockResolvedValue(sampleEvent);
    getSpanTreeLinesSpy.mockResolvedValue({
      lines: [],
      spans: null,
      traceId: null,
      success: false,
    });

    const { context } = createMockContext();
    const func = await viewCommand.loader();
    // First arg "CAM-82X" is an issue short ID, second arg "95fd7f5a" is ignored
    await func.call(
      context,
      { json: true, web: false, spans: 0 },
      "CAM-82X",
      "95fd7f5a"
    );

    // Should NOT go through resolveProjectBySlug (the old buggy path)
    expect(resolveProjectBySlugSpy).not.toHaveBeenCalled();
    // Should resolve via issue short ID path
    expect(getIssueByShortIdSpy).toHaveBeenCalledWith("cam-org", "CAM-82X");
    expect(getLatestEventSpy).toHaveBeenCalled();

    resolveOrgSpy.mockRestore();
    getIssueByShortIdSpy.mockRestore();
    getLatestEventSpy.mockRestore();
  });

  test("logs normalized slug warning when underscores present", async () => {
    getEventSpy.mockResolvedValue(sampleEvent);
    getSpanTreeLinesSpy.mockResolvedValue({
      lines: [],
      spans: null,
      traceId: null,
      success: false,
    });
    setOrgRegion("test-org", DEFAULT_SENTRY_URL);

    const { context } = createMockContext();
    const func = await viewCommand.loader();
    // Underscores in the slug trigger normalized warning
    await func.call(
      context,
      { json: true, web: false, spans: 0 },
      "test_org/test_proj",
      VALID_EVENT_ID
    );

    // parseOrgProjectArg normalizes "test_org/test_proj" → "test-org/test-proj"
    // and sets normalized=true, triggering the warning path (line 343-345)
    expect(getEventSpy).toHaveBeenCalled();
  });

  test("throws ValidationError for flag-like event ID (--h)", async () => {
    const { context } = createMockContext();
    const func = await viewCommand.loader();

    try {
      await func.call(context, { json: false, web: false, spans: 0 }, "--h");
      expect.unreachable("Should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      const msg = (error as ValidationError).message;
      expect(msg).toContain("event ID");
      expect(msg).toContain("looks like a help flag");
    }
  });

  test("throws ValidationError for non-hex event ID", async () => {
    const { context } = createMockContext();
    const func = await viewCommand.loader();

    try {
      await func.call(
        context,
        { json: false, web: false, spans: 0 },
        "not-a-hex-id"
      );
      expect.unreachable("Should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).message).toContain("event ID");
    }
  });
});

describe("fetchEventWithContext", () => {
  const mockEvent: SentryEvent = {
    eventID: "abc123def456abc123def456abc123de",
    id: "abc123def456abc123def456abc123de",
    groupID: "123",
    context: {},
    contexts: {},
    entries: [],
    tags: [],
    dateCreated: "2026-01-01T00:00:00Z",
    dateReceived: "2026-01-01T00:00:00Z",
  } as unknown as SentryEvent;

  afterEach(() => {
    mock.restore();
  });

  test("returns prefetched event without making API calls", async () => {
    const getEventSpy = spyOn(apiClient, "getEvent");
    const result = await fetchEventWithContext(
      mockEvent,
      "my-org",
      "my-project",
      "abc123"
    );
    expect(result).toBe(mockEvent);
    expect(getEventSpy).not.toHaveBeenCalled();
  });

  test("fetches event from project-scoped endpoint", async () => {
    const getEventSpy = spyOn(apiClient, "getEvent").mockResolvedValue(
      mockEvent
    );
    const result = await fetchEventWithContext(
      null,
      "my-org",
      "my-project",
      "abc123"
    );
    expect(result).toBe(mockEvent);
    expect(getEventSpy).toHaveBeenCalledWith("my-org", "my-project", "abc123");
  });

  test("falls back to org-wide search on 404 and finds event", async () => {
    spyOn(apiClient, "getEvent").mockRejectedValue(
      new ApiError("Not found", 404)
    );
    const resolvedEvent = {
      ...mockEvent,
      eventID: "found-in-other-project",
    } as unknown as SentryEvent;
    spyOn(apiClient, "resolveEventInOrg").mockResolvedValue({
      org: "my-org",
      project: "other-project",
      event: resolvedEvent,
    });

    const result = await fetchEventWithContext(
      null,
      "my-org",
      "my-project",
      "abc123"
    );
    expect(result).toBe(resolvedEvent);
  });

  test("throws ResolutionError when project-scoped, org-wide, and cross-org all fail", async () => {
    spyOn(apiClient, "getEvent").mockRejectedValue(
      new ApiError("Not found", 404)
    );
    spyOn(apiClient, "resolveEventInOrg").mockResolvedValue(null);
    spyOn(apiClient, "findEventAcrossOrgs").mockResolvedValue(null);

    await expect(
      fetchEventWithContext(null, "my-org", "my-project", "abc123")
    ).rejects.toThrow(ResolutionError);
  });

  test("falls back to cross-org search when org-wide returns null", async () => {
    spyOn(apiClient, "getEvent").mockRejectedValue(
      new ApiError("Not found", 404)
    );
    spyOn(apiClient, "resolveEventInOrg").mockResolvedValue(null);
    const crossOrgEvent = {
      ...mockEvent,
      eventID: "found-in-other-org",
    } as unknown as SentryEvent;
    spyOn(apiClient, "findEventAcrossOrgs").mockResolvedValue({
      org: "other-org",
      project: "other-project",
      event: crossOrgEvent,
    });

    const result = await fetchEventWithContext(
      null,
      "my-org",
      "my-project",
      "abc123"
    );
    expect(result).toBe(crossOrgEvent);
  });

  test("cross-org fallback passes excludeOrgs when same-org search succeeded", async () => {
    spyOn(apiClient, "getEvent").mockRejectedValue(
      new ApiError("Not found", 404)
    );
    // Same-org search completed successfully (returned null = definitive "not found")
    spyOn(apiClient, "resolveEventInOrg").mockResolvedValue(null);
    const findSpy = spyOn(apiClient, "findEventAcrossOrgs").mockResolvedValue(
      null
    );

    await expect(
      fetchEventWithContext(null, "my-org", "my-project", "abc123")
    ).rejects.toThrow(ResolutionError);

    expect(findSpy).toHaveBeenCalledWith("abc123", {
      excludeOrgs: ["my-org"],
    });
  });

  test("cross-org does not exclude org when same-org search threw", async () => {
    spyOn(apiClient, "getEvent").mockRejectedValue(
      new ApiError("Not found", 404)
    );
    // Same-org search threw a transient error — org was NOT definitively searched
    spyOn(apiClient, "resolveEventInOrg").mockRejectedValue(
      new Error("500 Internal Server Error")
    );
    const findSpy = spyOn(apiClient, "findEventAcrossOrgs").mockResolvedValue(
      null
    );

    await expect(
      fetchEventWithContext(null, "my-org", "my-project", "abc123")
    ).rejects.toThrow(ResolutionError);

    // excludeOrgs should be undefined so cross-org retries the same org
    expect(findSpy).toHaveBeenCalledWith("abc123", {
      excludeOrgs: undefined,
    });
  });

  test("swallows non-auth cross-org errors and throws ResolutionError", async () => {
    spyOn(apiClient, "getEvent").mockRejectedValue(
      new ApiError("Not found", 404)
    );
    spyOn(apiClient, "resolveEventInOrg").mockResolvedValue(null);
    spyOn(apiClient, "findEventAcrossOrgs").mockRejectedValue(
      new Error("Network timeout")
    );

    await expect(
      fetchEventWithContext(null, "my-org", "my-project", "abc123")
    ).rejects.toThrow(ResolutionError);
  });

  test("propagates AuthError from cross-org fallback", async () => {
    spyOn(apiClient, "getEvent").mockRejectedValue(
      new ApiError("Not found", 404)
    );
    spyOn(apiClient, "resolveEventInOrg").mockResolvedValue(null);
    spyOn(apiClient, "findEventAcrossOrgs").mockRejectedValue(
      new AuthError("expired", "Token expired")
    );

    await expect(
      fetchEventWithContext(null, "my-org", "my-project", "abc123")
    ).rejects.toThrow(AuthError);
  });

  test("propagates AuthError from same-org fallback", async () => {
    spyOn(apiClient, "getEvent").mockRejectedValue(
      new ApiError("Not found", 404)
    );
    spyOn(apiClient, "resolveEventInOrg").mockRejectedValue(
      new AuthError("expired", "Token expired")
    );
    const findSpy = spyOn(apiClient, "findEventAcrossOrgs");

    await expect(
      fetchEventWithContext(null, "my-org", "my-project", "abc123")
    ).rejects.toThrow(AuthError);
    // Cross-org should never be attempted when auth is broken
    expect(findSpy).not.toHaveBeenCalled();
  });

  test("tries cross-org fallback even when org-wide search throws", async () => {
    spyOn(apiClient, "getEvent").mockRejectedValue(
      new ApiError("Not found", 404)
    );
    spyOn(apiClient, "resolveEventInOrg").mockRejectedValue(
      new Error("500 Internal Server Error")
    );
    const crossOrgEvent = {
      ...mockEvent,
      eventID: "found-cross-org",
    } as unknown as SentryEvent;
    const findSpy = spyOn(apiClient, "findEventAcrossOrgs").mockResolvedValue({
      org: "other-org",
      project: "other-project",
      event: crossOrgEvent,
    });

    const result = await fetchEventWithContext(
      null,
      "my-org",
      "my-project",
      "abc123"
    );
    expect(result).toBe(crossOrgEvent);
    expect(findSpy).toHaveBeenCalled();
  });

  test("propagates non-404 errors without fallback", async () => {
    spyOn(apiClient, "getEvent").mockRejectedValue(
      new ApiError("Server error", 500)
    );
    const resolveEventSpy = spyOn(apiClient, "resolveEventInOrg");

    await expect(
      fetchEventWithContext(null, "my-org", "my-project", "abc123")
    ).rejects.toThrow("Server error");
    expect(resolveEventSpy).not.toHaveBeenCalled();
  });
});
