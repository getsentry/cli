/**
 * Trace View Command Tests
 *
 * Tests for positional argument parsing and project resolution
 * in src/commands/trace/view.ts
 */

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import {
  parsePositionalArgs,
  resolveFromProjectSearch,
} from "../../../src/commands/trace/view.js";
import type { ProjectWithOrg } from "../../../src/lib/api-client.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as apiClient from "../../../src/lib/api-client.js";
import { ContextError, ValidationError } from "../../../src/lib/errors.js";

describe("parsePositionalArgs", () => {
  describe("single argument (trace ID only)", () => {
    test("parses single arg as trace ID", () => {
      const result = parsePositionalArgs(["abc123def456"]);
      expect(result.traceId).toBe("abc123def456");
      expect(result.targetArg).toBeUndefined();
    });

    test("parses 32-char hex trace ID", () => {
      const result = parsePositionalArgs(["aaaa1111bbbb2222cccc3333dddd4444"]);
      expect(result.traceId).toBe("aaaa1111bbbb2222cccc3333dddd4444");
      expect(result.targetArg).toBeUndefined();
    });
  });

  describe("two arguments (target + trace ID)", () => {
    test("parses org/project target and trace ID", () => {
      const result = parsePositionalArgs(["my-org/frontend", "abc123def456"]);
      expect(result.targetArg).toBe("my-org/frontend");
      expect(result.traceId).toBe("abc123def456");
    });

    test("parses project-only target and trace ID", () => {
      const result = parsePositionalArgs(["frontend", "abc123def456"]);
      expect(result.targetArg).toBe("frontend");
      expect(result.traceId).toBe("abc123def456");
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
        expect((error as ContextError).message).toContain("Trace ID");
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
      expect(result.traceId).toBe("abc123");
    });

    test("handles empty string trace ID in two-arg case", () => {
      const result = parsePositionalArgs(["my-org/frontend", ""]);
      expect(result.targetArg).toBe("my-org/frontend");
      expect(result.traceId).toBe("");
    });
  });
});

describe("resolveFromProjectSearch", () => {
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

      await expect(
        resolveFromProjectSearch("my-project", "trace-123")
      ).rejects.toThrow(ContextError);
    });

    test("includes project name in error message", async () => {
      findProjectsBySlugSpy.mockResolvedValue([]);

      try {
        await resolveFromProjectSearch("frontend", "trace-123");
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

      await expect(
        resolveFromProjectSearch("frontend", "trace-123")
      ).rejects.toThrow(ValidationError);
    });

    test("includes all orgs and trace ID in error message", async () => {
      findProjectsBySlugSpy.mockResolvedValue([
        { slug: "frontend", orgSlug: "acme-corp", id: "1", name: "Frontend" },
        { slug: "frontend", orgSlug: "beta-inc", id: "2", name: "Frontend" },
      ] as ProjectWithOrg[]);

      try {
        await resolveFromProjectSearch("frontend", "trace-456");
        expect.unreachable("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationError);
        const message = (error as ValidationError).message;
        expect(message).toContain("exists in multiple organizations");
        expect(message).toContain("acme-corp/frontend");
        expect(message).toContain("beta-inc/frontend");
        expect(message).toContain("trace-456");
      }
    });
  });

  describe("single project found", () => {
    test("returns resolved target for single match", async () => {
      findProjectsBySlugSpy.mockResolvedValue([
        { slug: "backend", orgSlug: "my-company", id: "42", name: "Backend" },
      ] as ProjectWithOrg[]);

      const result = await resolveFromProjectSearch("backend", "trace-xyz");

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

      const result = await resolveFromProjectSearch("mobile-app", "trace-001");

      expect(result.org).toBe("acme-industries");
      expect(result.project).toBe("mobile-app");
    });
  });
});
