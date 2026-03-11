/**
 * Trace View Command Tests
 *
 * Tests for positional argument parsing and project resolution
 * in src/commands/trace/view.ts
 */

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { parsePositionalArgs } from "../../../src/commands/trace/view.js";
import type { ProjectWithOrg } from "../../../src/lib/api-client.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as apiClient from "../../../src/lib/api-client.js";
import {
  ContextError,
  ResolutionError,
  ValidationError,
} from "../../../src/lib/errors.js";
import { resolveProjectBySlug } from "../../../src/lib/resolve-target.js";

const VALID_TRACE_ID = "aaaa1111bbbb2222cccc3333dddd4444";
const VALID_TRACE_ID_2 = "deadbeef12345678deadbeef12345678";
const VALID_UUID = "ed29abc8-71c4-475b-9675-4655ef1a02d0";
const VALID_UUID_STRIPPED = "ed29abc871c4475b96754655ef1a02d0";

describe("parsePositionalArgs", () => {
  describe("single argument (trace ID only)", () => {
    test("parses single arg as trace ID", () => {
      const result = parsePositionalArgs([VALID_TRACE_ID]);
      expect(result.traceId).toBe(VALID_TRACE_ID);
      expect(result.targetArg).toBeUndefined();
    });

    test("parses 32-char hex trace ID", () => {
      const result = parsePositionalArgs([VALID_TRACE_ID]);
      expect(result.traceId).toBe(VALID_TRACE_ID);
      expect(result.targetArg).toBeUndefined();
    });

    test("normalizes uppercase trace ID to lowercase", () => {
      const result = parsePositionalArgs(["AAAA1111BBBB2222CCCC3333DDDD4444"]);
      expect(result.traceId).toBe(VALID_TRACE_ID);
    });
  });

  describe("two arguments (target + trace ID)", () => {
    test("parses org/project target and trace ID", () => {
      const result = parsePositionalArgs(["my-org/frontend", VALID_TRACE_ID]);
      expect(result.targetArg).toBe("my-org/frontend");
      expect(result.traceId).toBe(VALID_TRACE_ID);
    });

    test("parses project-only target and trace ID", () => {
      const result = parsePositionalArgs(["frontend", VALID_TRACE_ID]);
      expect(result.targetArg).toBe("frontend");
      expect(result.traceId).toBe(VALID_TRACE_ID);
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

    test("throws ValidationError for invalid trace ID", () => {
      expect(() => parsePositionalArgs(["not-a-valid-trace-id"])).toThrow(
        ValidationError
      );
    });

    test("throws ValidationError for short hex", () => {
      expect(() => parsePositionalArgs(["abc123"])).toThrow(ValidationError);
    });

    test("throws ValidationError for empty trace ID in two-arg case", () => {
      expect(() => parsePositionalArgs(["my-org/frontend", ""])).toThrow(
        ValidationError
      );
    });
  });

  describe("slash-separated org/project/traceId (single arg)", () => {
    test("parses org/project/traceId as target + trace ID", () => {
      const result = parsePositionalArgs([`sentry/cli/${VALID_TRACE_ID}`]);
      expect(result.targetArg).toBe("sentry/cli");
      expect(result.traceId).toBe(VALID_TRACE_ID);
    });

    test("handles hyphenated org and project slugs", () => {
      const result = parsePositionalArgs([
        `my-org/my-project/${VALID_TRACE_ID_2}`,
      ]);
      expect(result.targetArg).toBe("my-org/my-project");
      expect(result.traceId).toBe(VALID_TRACE_ID_2);
    });

    test("one slash (org/project, missing trace ID) throws ContextError", () => {
      expect(() => parsePositionalArgs(["sentry/cli"])).toThrow(ContextError);
    });

    test("trailing slash (org/project/) throws ContextError", () => {
      expect(() => parsePositionalArgs(["sentry/cli/"])).toThrow(ContextError);
    });

    test("one-slash ContextError mentions Trace ID", () => {
      try {
        parsePositionalArgs(["sentry/cli"]);
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
        VALID_TRACE_ID,
        "extra-arg",
      ]);
      expect(result.targetArg).toBe("my-org/frontend");
      expect(result.traceId).toBe(VALID_TRACE_ID);
    });
  });

  describe("UUID auto-correction", () => {
    test("strips dashes from UUID trace ID (single arg)", () => {
      const result = parsePositionalArgs([VALID_UUID]);
      expect(result.traceId).toBe(VALID_UUID_STRIPPED);
      expect(result.targetArg).toBeUndefined();
    });

    test("strips dashes from UUID trace ID (two-arg case)", () => {
      const result = parsePositionalArgs(["my-org/frontend", VALID_UUID]);
      expect(result.traceId).toBe(VALID_UUID_STRIPPED);
      expect(result.targetArg).toBe("my-org/frontend");
    });

    test("strips dashes from UUID in slash-separated form", () => {
      const result = parsePositionalArgs([`sentry/cli/${VALID_UUID}`]);
      expect(result.traceId).toBe(VALID_UUID_STRIPPED);
      expect(result.targetArg).toBe("sentry/cli");
    });

    test("handles real user input from CLI-7Z", () => {
      const result = parsePositionalArgs([
        "ed29abc8-71c4-475b-9675-4655ef1a02d0",
      ]);
      expect(result.traceId).toBe("ed29abc871c4475b96754655ef1a02d0");
    });
  });
});

describe("resolveProjectBySlug", () => {
  const HINT = "sentry trace view <org>/<project> <trace-id>";
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

    test("includes all orgs and trace ID in error message", async () => {
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
          "sentry trace view <org>/frontend trace-456"
        );
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
      findProjectsBySlugSpy.mockResolvedValue({
        projects: [
          { slug: "backend", orgSlug: "my-company", id: "42", name: "Backend" },
        ] as ProjectWithOrg[],
        orgs: [],
      });

      const result = await resolveProjectBySlug("backend", HINT);

      expect(result).toEqual({
        org: "my-company",
        project: "backend",
      });
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
      expect(result.project).toBe("mobile-app");
    });
  });
});
