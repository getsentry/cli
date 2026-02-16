/**
 * Event View Command Tests
 *
 * Tests for positional argument parsing and project resolution
 * in src/commands/event/view.ts
 */

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { parsePositionalArgs } from "../../../src/commands/event/view.js";
import type { ProjectWithOrg } from "../../../src/lib/api-client.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as apiClient from "../../../src/lib/api-client.js";
import { ContextError, ValidationError } from "../../../src/lib/errors.js";
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

    test("event URL extracts eventId and org as target", () => {
      const result = parsePositionalArgs([
        "https://sentry.io/organizations/my-org/issues/32886/events/abc123def456/",
      ]);
      expect(result.eventId).toBe("abc123def456");
      expect(result.targetArg).toBe("my-org/");
    });

    test("self-hosted event URL extracts eventId and org", () => {
      const result = parsePositionalArgs([
        "https://sentry.example.com/organizations/acme/issues/999/events/deadbeef/",
      ]);
      expect(result.eventId).toBe("deadbeef");
      expect(result.targetArg).toBe("acme/");
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
});
