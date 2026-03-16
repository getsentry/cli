/**
 * Trace View Command Tests
 *
 * Tests for pre-processing (swap detection, issue ID detection)
 * and project resolution in src/commands/trace/view.ts.
 *
 * Note: Core trace target parsing tests are in test/lib/trace-target.test.ts.
 */

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { preProcessArgs } from "../../../src/commands/trace/view.js";
import type { ProjectWithOrg } from "../../../src/lib/api-client.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as apiClient from "../../../src/lib/api-client.js";
import { ResolutionError, ValidationError } from "../../../src/lib/errors.js";
import { resolveProjectBySlug } from "../../../src/lib/resolve-target.js";

const VALID_TRACE_ID = "aaaa1111bbbb2222cccc3333dddd4444";

describe("preProcessArgs", () => {
  test("returns args unchanged for single arg", () => {
    const result = preProcessArgs([VALID_TRACE_ID]);
    expect(result.correctedArgs).toEqual([VALID_TRACE_ID]);
    expect(result.warning).toBeUndefined();
    expect(result.suggestion).toBeUndefined();
  });

  test("returns args unchanged for normal two-arg order", () => {
    const result = preProcessArgs(["my-org/frontend", VALID_TRACE_ID]);
    expect(result.correctedArgs).toEqual(["my-org/frontend", VALID_TRACE_ID]);
    expect(result.warning).toBeUndefined();
  });

  test("detects swapped args and corrects order", () => {
    // User put trace-id first, org/project second
    const result = preProcessArgs([VALID_TRACE_ID, "my-org/frontend"]);
    expect(result.correctedArgs).toEqual(["my-org/frontend", VALID_TRACE_ID]);
    expect(result.warning).toContain("reversed");
  });

  test("detects issue short ID and suggests issue view", () => {
    const result = preProcessArgs(["CAM-82X", VALID_TRACE_ID]);
    expect(result.correctedArgs).toEqual(["CAM-82X", VALID_TRACE_ID]);
    expect(result.suggestion).toContain("sentry issue view CAM-82X");
  });

  test("returns empty args unchanged", () => {
    const result = preProcessArgs([]);
    expect(result.correctedArgs).toEqual([]);
  });
});

describe("resolveProjectBySlug", () => {
  const HINT = "sentry trace view [<org>/<project>/]<trace-id>";
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
          {
            slug: "frontend",
            orgSlug: "acme-corp",
            id: "1",
            name: "Frontend",
          },
          {
            slug: "frontend",
            orgSlug: "beta-inc",
            id: "2",
            name: "Frontend",
          },
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
          {
            slug: "backend",
            orgSlug: "my-company",
            id: "42",
            name: "Backend",
          },
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
