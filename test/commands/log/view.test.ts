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
import {
  ContextError,
  ResolutionError,
  ValidationError,
} from "../../../src/lib/errors.js";
import { resolveProjectBySlug } from "../../../src/lib/resolve-target.js";

/** A valid 32-char hex log ID for tests */
const ID1 = "968c763c740cfda8b6728f27fb9e9b01";
const ID2 = "aaaa1111bbbb2222cccc3333dddd4444";
const ID3 = "1234567890abcdef1234567890abcdef";

describe("parsePositionalArgs", () => {
  describe("single argument (log ID only)", () => {
    test("parses single 32-char hex log ID", () => {
      const result = parsePositionalArgs([ID1]);
      expect(result.logIds).toEqual([ID1]);
      expect(result.targetArg).toBeUndefined();
    });
  });

  describe("two arguments (target + log ID)", () => {
    test("parses org/project target and log ID", () => {
      const result = parsePositionalArgs(["my-org/frontend", ID1]);
      expect(result.targetArg).toBe("my-org/frontend");
      expect(result.logIds).toEqual([ID1]);
    });

    test("parses project-only target and log ID", () => {
      const result = parsePositionalArgs(["frontend", ID1]);
      expect(result.targetArg).toBe("frontend");
      expect(result.logIds).toEqual([ID1]);
    });

    test("parses org/ target (all projects) and log ID", () => {
      const result = parsePositionalArgs(["my-org/", ID1]);
      expect(result.targetArg).toBe("my-org/");
      expect(result.logIds).toEqual([ID1]);
    });
  });

  describe("multiple log IDs", () => {
    test("parses multiple space-separated log IDs", () => {
      const result = parsePositionalArgs(["my-org/frontend", ID1, ID2, ID3]);
      expect(result.targetArg).toBe("my-org/frontend");
      expect(result.logIds).toEqual([ID1, ID2, ID3]);
    });

    test("splits newline-separated IDs in a single argument", () => {
      const combined = `${ID1}\n${ID2}\n${ID3}`;
      const result = parsePositionalArgs(["my-org/frontend", combined]);
      expect(result.targetArg).toBe("my-org/frontend");
      expect(result.logIds).toEqual([ID1, ID2, ID3]);
    });

    test("splits newline-separated IDs in single-arg mode", () => {
      const combined = `${ID1}\n${ID2}`;
      const result = parsePositionalArgs([combined]);
      expect(result.logIds).toEqual([ID1, ID2]);
      expect(result.targetArg).toBeUndefined();
    });

    test("trims whitespace around newline-separated IDs", () => {
      const combined = `  ${ID1}  \n  ${ID2}  `;
      const result = parsePositionalArgs(["my-org/frontend", combined]);
      expect(result.logIds).toEqual([ID1, ID2]);
    });

    test("ignores empty lines in newline-separated IDs", () => {
      const combined = `${ID1}\n\n${ID2}\n`;
      const result = parsePositionalArgs(["my-org/frontend", combined]);
      expect(result.logIds).toEqual([ID1, ID2]);
    });

    test("handles mix of space-separated and newline-separated args", () => {
      const combined = `${ID2}\n${ID3}`;
      const result = parsePositionalArgs(["my-org/frontend", ID1, combined]);
      expect(result.logIds).toEqual([ID1, ID2, ID3]);
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

    test("throws ValidationError for non-hex log ID", () => {
      expect(() => parsePositionalArgs(["not-a-hex-id"])).toThrow(
        ValidationError
      );
    });

    test("throws ValidationError for short log ID", () => {
      expect(() => parsePositionalArgs(["abc123"])).toThrow(ValidationError);
    });

    test("throws ValidationError for log ID with invalid chars", () => {
      expect(() =>
        parsePositionalArgs(["gggg1111bbbb2222cccc3333dddd4444"])
      ).toThrow(ValidationError);
    });

    test("ValidationError includes 'log ID' in message", () => {
      try {
        parsePositionalArgs(["bad"]);
        expect.unreachable("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationError);
        expect((error as ValidationError).message).toContain("log ID");
      }
    });

    test("throws ValidationError when one of multiple IDs is invalid", () => {
      expect(() =>
        parsePositionalArgs(["my-org/frontend", ID1, "not-valid"])
      ).toThrow(ValidationError);
    });

    test("throws ContextError for empty log ID after target", () => {
      expect(() => parsePositionalArgs(["my-org/frontend", ""])).toThrow(
        ContextError
      );
    });
  });

  describe("slash-separated org/project/logId (single arg)", () => {
    test("parses org/project/logId as target + log ID", () => {
      const result = parsePositionalArgs([`sentry/cli/${ID1}`]);
      expect(result.targetArg).toBe("sentry/cli");
      expect(result.logIds).toEqual([ID1]);
    });

    test("handles hyphenated org and project slugs", () => {
      const result = parsePositionalArgs([`my-org/my-project/${ID1}`]);
      expect(result.targetArg).toBe("my-org/my-project");
      expect(result.logIds).toEqual([ID1]);
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

  describe("the exact CLI-BC scenario", () => {
    test("newline-delimited log IDs as a single arg with target", () => {
      const ids = [
        "019c6d2ca9ec7cc5bd02f9190d77debe",
        "019c71e55b817bccb2a842fe6252caed",
        "019c71e92c887cdfb4367790907032f7",
      ];
      const combined = ids.join("\n");
      const result = parsePositionalArgs(["brandai/brandai", combined]);
      expect(result.targetArg).toBe("brandai/brandai");
      expect(result.logIds).toEqual(ids);
    });
  });
});

describe("resolveProjectBySlug", () => {
  const HINT = "sentry log view <org>/<project> <log-id> [<log-id>...]";
  let findProjectsBySlugSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    findProjectsBySlugSpy = spyOn(apiClient, "findProjectsBySlug");
  });

  afterEach(() => {
    findProjectsBySlugSpy.mockRestore();
  });

  describe("no projects found", () => {
    test("throws ResolutionError when project not found", async () => {
      findProjectsBySlugSpy.mockResolvedValue([]);

      await expect(resolveProjectBySlug("my-project", HINT)).rejects.toThrow(
        ResolutionError
      );
    });

    test("includes project name in error message", async () => {
      findProjectsBySlugSpy.mockResolvedValue([]);

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
