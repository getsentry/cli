/**
 * Log View Command Tests
 *
 * Tests for positional argument parsing and project resolution
 * in src/commands/log/view.ts
 */

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { parsePositionalArgs } from "../../../src/commands/log/view.js";
import type { ProjectWithOrg } from "../../../src/lib/api-client.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as apiClient from "../../../src/lib/api-client.js";
import { ContextError, ValidationError } from "../../../src/lib/errors.js";
import { resolveProjectBySlug } from "../../../src/lib/resolve-target.js";

describe("parsePositionalArgs", () => {
  describe("single argument (log ID only)", () => {
    test("parses single arg as log ID", () => {
      const result = parsePositionalArgs(["abc123def456"]);
      expect(result.logId).toBe("abc123def456");
      expect(result.targetArg).toBeUndefined();
    });

    test("parses 32-char hex log ID", () => {
      const result = parsePositionalArgs(["968c763c740cfda8b6728f27fb9e9b01"]);
      expect(result.logId).toBe("968c763c740cfda8b6728f27fb9e9b01");
      expect(result.targetArg).toBeUndefined();
    });

    test("parses short log ID", () => {
      const result = parsePositionalArgs(["abc"]);
      expect(result.logId).toBe("abc");
      expect(result.targetArg).toBeUndefined();
    });
  });

  describe("two arguments (target + log ID)", () => {
    test("parses org/project target and log ID", () => {
      const result = parsePositionalArgs(["my-org/frontend", "abc123def456"]);
      expect(result.targetArg).toBe("my-org/frontend");
      expect(result.logId).toBe("abc123def456");
    });

    test("parses project-only target and log ID", () => {
      const result = parsePositionalArgs(["frontend", "abc123def456"]);
      expect(result.targetArg).toBe("frontend");
      expect(result.logId).toBe("abc123def456");
    });

    test("parses org/ target (all projects) and log ID", () => {
      const result = parsePositionalArgs(["my-org/", "abc123def456"]);
      expect(result.targetArg).toBe("my-org/");
      expect(result.logId).toBe("abc123def456");
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
        expect((error as ContextError).message).toContain("Log ID");
      }
    });
  });

  describe("slash-separated org/project/logId (single arg)", () => {
    test("parses org/project/logId as target + log ID", () => {
      const result = parsePositionalArgs([
        "sentry/cli/968c763c740cfda8b6728f27fb9e9b01",
      ]);
      expect(result.targetArg).toBe("sentry/cli");
      expect(result.logId).toBe("968c763c740cfda8b6728f27fb9e9b01");
    });

    test("handles hyphenated org and project slugs", () => {
      const result = parsePositionalArgs([
        "my-org/my-project/deadbeef12345678",
      ]);
      expect(result.targetArg).toBe("my-org/my-project");
      expect(result.logId).toBe("deadbeef12345678");
    });

    test("one slash (org/project, missing log ID) throws ContextError", () => {
      expect(() => parsePositionalArgs(["sentry/cli"])).toThrow(ContextError);
    });

    test("trailing slash (org/project/) throws ContextError", () => {
      expect(() => parsePositionalArgs(["sentry/cli/"])).toThrow(ContextError);
    });

    test("one-slash ContextError mentions Log ID", () => {
      try {
        parsePositionalArgs(["sentry/cli"]);
        expect.unreachable("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(ContextError);
        expect((error as ContextError).message).toContain("Log ID");
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
      expect(result.logId).toBe("abc123");
    });

    test("handles empty string log ID in two-arg case", () => {
      const result = parsePositionalArgs(["my-org/frontend", ""]);
      expect(result.targetArg).toBe("my-org/frontend");
      expect(result.logId).toBe("");
    });
  });
});

describe("resolveProjectBySlug", () => {
  const HINT = "sentry log view <org>/<project> <log-id>";
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
          "sentry log view <org>/frontend log-456"
        );
        expect.unreachable("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationError);
        const message = (error as ValidationError).message;
        expect(message).toContain("exists in multiple organizations");
        expect(message).toContain("acme-corp/frontend");
        expect(message).toContain("beta-inc/frontend");
        expect(message).toContain("log-456");
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
          "sentry log view <org>/api abc123"
        );
        expect.unreachable("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationError);
        const message = (error as ValidationError).message;
        expect(message).toContain("Example: sentry log view <org>/api abc123");
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
