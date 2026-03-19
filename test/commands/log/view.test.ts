/**
 * Log View Command Tests
 *
 * Tests for positional argument parsing, project resolution,
 * and viewCommand func() body in src/commands/log/view.ts
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
  viewCommand,
} from "../../../src/commands/log/view.js";
import type { ProjectWithOrg } from "../../../src/lib/api-client.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as apiClient from "../../../src/lib/api-client.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as browser from "../../../src/lib/browser.js";
import { DEFAULT_SENTRY_URL } from "../../../src/lib/constants.js";
import { setOrgRegion } from "../../../src/lib/db/regions.js";
import {
  ContextError,
  ResolutionError,
  ValidationError,
} from "../../../src/lib/errors.js";
import { resolveProjectBySlug } from "../../../src/lib/resolve-target.js";
import type { DetailedSentryLog } from "../../../src/types/index.js";

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

  describe("suggestions and error handling", () => {
    test("swapped args (hex ID first, org/project second) throws ValidationError", () => {
      // Non-hex second arg fails validateHexId — user gets a clear error.
      expect(() =>
        parsePositionalArgs([
          "968c763c740cfda8b6728f27fb9e9b01",
          "my-org/my-project",
        ])
      ).toThrow(ValidationError);
    });

    test("returns suggestion when first arg looks like issue short ID", () => {
      const result = parsePositionalArgs([
        "CAM-82X",
        "968c763c740cfda8b6728f27fb9e9b01",
      ]);
      expect(result.suggestion).toBe("Did you mean: sentry issue view CAM-82X");
    });

    test("no suggestion for normal target + logId", () => {
      const result = parsePositionalArgs([
        "my-org",
        "968c763c740cfda8b6728f27fb9e9b01",
      ]);
      expect(result.suggestion).toBeUndefined();
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
});

// ============================================================================
// viewCommand.func() — coverage for warning, normalized, and project-search paths
// ============================================================================

describe("viewCommand.func", () => {
  let getLogsSpy: ReturnType<typeof spyOn>;
  let findProjectsBySlugSpy: ReturnType<typeof spyOn>;
  let openInBrowserSpy: ReturnType<typeof spyOn>;

  const sampleLog: DetailedSentryLog = {
    id: "968c763c740cfda8b6728f27fb9e9b01",
    severity: "error",
    severity_number: 17,
    timestamp: "2024-01-30T12:00:00Z",
    "project.id": 1,
    trace: "abc123",
    message: "Test log message",
    attributes: {},
  } as unknown as DetailedSentryLog;

  function createMockContext() {
    const stdoutWrite = mock(() => true);
    return {
      context: {
        stdout: { write: stdoutWrite },
        stderr: { write: mock(() => true) },
        cwd: "/tmp",
        setContext: mock(() => {
          // no-op for test
        }),
      },
      stdoutWrite,
    };
  }

  beforeEach(async () => {
    getLogsSpy = spyOn(apiClient, "getLogs");
    findProjectsBySlugSpy = spyOn(apiClient, "findProjectsBySlug");
    openInBrowserSpy = spyOn(browser, "openInBrowser");
    await setOrgRegion("test-org", DEFAULT_SENTRY_URL);
  });

  afterEach(() => {
    getLogsSpy.mockRestore();
    findProjectsBySlugSpy.mockRestore();
    openInBrowserSpy.mockRestore();
  });

  test("swapped args throw ValidationError since non-hex ID fails validation", async () => {
    const { context } = createMockContext();
    const func = await viewCommand.loader();
    // With hex validation, "test-org/test-proj" in log ID position throws
    // ValidationError before swap detection runs.
    await expect(
      func.call(
        context,
        { json: true, web: false },
        "968c763c740cfda8b6728f27fb9e9b01",
        "test-org/test-proj"
      )
    ).rejects.toThrow(ValidationError);
  });

  test("logs normalized slug warning when underscores present", async () => {
    getLogsSpy.mockResolvedValue([sampleLog]);
    await setOrgRegion("test-org", DEFAULT_SENTRY_URL);

    const { context } = createMockContext();
    const func = await viewCommand.loader();
    // Underscores in the slug trigger normalized warning (line 161-163)
    await func.call(
      context,
      { json: true, web: false },
      "test_org/test_proj",
      "968c763c740cfda8b6728f27fb9e9b01"
    );

    expect(getLogsSpy).toHaveBeenCalled();
  });

  test("resolves project-search target via resolveProjectBySlug", async () => {
    findProjectsBySlugSpy.mockResolvedValue({
      projects: [
        { slug: "frontend", orgSlug: "acme", id: "1", name: "Frontend" },
      ],
      orgs: [],
    });
    getLogsSpy.mockResolvedValue([sampleLog]);
    await setOrgRegion("acme", DEFAULT_SENTRY_URL);

    const { context } = createMockContext();
    const func = await viewCommand.loader();
    // "frontend" (no slash) → project-search → resolveProjectBySlug (line 176-180)
    await func.call(
      context,
      { json: true, web: false },
      "frontend",
      "968c763c740cfda8b6728f27fb9e9b01"
    );

    expect(findProjectsBySlugSpy).toHaveBeenCalledWith("frontend");
    expect(getLogsSpy).toHaveBeenCalled();
  });

  test("logs suggestion when first arg looks like issue short ID", async () => {
    // "CAM-82X" as first arg matches issue short ID pattern.
    // parseOrgProjectArg("CAM-82X") → project-search, so we mock findProjectsBySlug.
    findProjectsBySlugSpy.mockResolvedValue({
      projects: [{ slug: "cam-82x", orgSlug: "cam-org", id: "1", name: "Cam" }],
      orgs: [],
    });
    getLogsSpy.mockResolvedValue([sampleLog]);
    await setOrgRegion("cam-org", DEFAULT_SENTRY_URL);

    const { context } = createMockContext();
    const func = await viewCommand.loader();
    await func.call(
      context,
      { json: true, web: false },
      "CAM-82X",
      "968c763c740cfda8b6728f27fb9e9b01"
    );

    // The suggestion path fires (looksLikeIssueShortId("CAM-82X") → true)
    // normalized slug → findProjectsBySlug("cam-82x")
    expect(findProjectsBySlugSpy).toHaveBeenCalledWith("CAM-82X");
    expect(getLogsSpy).toHaveBeenCalled();
  });
});
