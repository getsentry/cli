/**
 * Project View Command Func Tests
 *
 * Tests for the viewCommand func() body in src/commands/project/view.ts.
 * Uses spyOn to mock api-client, resolve-target, and browser to test
 * the func() body without real HTTP calls or database access.
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
import { viewCommand } from "../../../src/commands/project/view.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as apiClient from "../../../src/lib/api-client.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as browser from "../../../src/lib/browser.js";
import { AuthError, ContextError } from "../../../src/lib/errors.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as resolveTarget from "../../../src/lib/resolve-target.js";
import type { ProjectKey, SentryProject } from "../../../src/types/sentry.js";

const sampleProject: SentryProject = {
  id: "42",
  slug: "test-project",
  name: "Test Project",
  platform: "javascript",
  dateCreated: "2025-01-01T00:00:00.000Z",
  status: "active",
};

const sampleKeys: ProjectKey[] = [
  {
    id: "key-1",
    name: "Default",
    dsn: { public: "https://abc123@o1.ingest.sentry.io/42" },
    isActive: true,
  },
];

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

describe("viewCommand.func", () => {
  let getProjectSpy: ReturnType<typeof spyOn>;
  let getProjectKeysSpy: ReturnType<typeof spyOn>;
  let resolveAllTargetsSpy: ReturnType<typeof spyOn>;
  let resolveProjectBySlugSpy: ReturnType<typeof spyOn>;
  let openInBrowserSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    getProjectSpy = spyOn(apiClient, "getProject");
    getProjectKeysSpy = spyOn(apiClient, "getProjectKeys");
    resolveAllTargetsSpy = spyOn(resolveTarget, "resolveAllTargets");
    resolveProjectBySlugSpy = spyOn(resolveTarget, "resolveProjectBySlug");
    openInBrowserSpy = spyOn(browser, "openInBrowser");
  });

  afterEach(() => {
    getProjectSpy.mockRestore();
    getProjectKeysSpy.mockRestore();
    resolveAllTargetsSpy.mockRestore();
    resolveProjectBySlugSpy.mockRestore();
    openInBrowserSpy.mockRestore();
  });

  test("explicit org/project outputs JSON with DSN", async () => {
    getProjectSpy.mockResolvedValue(sampleProject);
    getProjectKeysSpy.mockResolvedValue(sampleKeys);

    const { context, stdoutWrite } = createMockContext();
    const func = await viewCommand.loader();
    await func.call(context, { json: true, web: false }, "my-org/test-project");

    const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
    const parsed = JSON.parse(output);
    expect(parsed.slug).toBe("test-project");
    expect(parsed.dsn).toBe("https://abc123@o1.ingest.sentry.io/42");
  });

  test("explicit org/project outputs human-readable details", async () => {
    getProjectSpy.mockResolvedValue(sampleProject);
    getProjectKeysSpy.mockResolvedValue(sampleKeys);

    const { context, stdoutWrite } = createMockContext();
    const func = await viewCommand.loader();
    await func.call(
      context,
      { json: false, web: false },
      "my-org/test-project"
    );

    const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("test-project");
    expect(output).toContain("Slug");
  });

  test("explicit org/project with --web opens browser", async () => {
    openInBrowserSpy.mockResolvedValue(undefined);

    const { context } = createMockContext();
    const func = await viewCommand.loader();
    await func.call(context, { json: false, web: true }, "my-org/test-project");

    expect(openInBrowserSpy).toHaveBeenCalled();
    // Should NOT fetch project details when using --web
    expect(getProjectSpy).not.toHaveBeenCalled();
  });

  test("--web with multiple auto-detected targets throws ContextError", async () => {
    resolveAllTargetsSpy.mockResolvedValue({
      targets: [
        {
          org: "org-a",
          project: "proj-1",
          orgDisplay: "org-a",
          projectDisplay: "proj-1",
        },
        {
          org: "org-b",
          project: "proj-2",
          orgDisplay: "org-b",
          projectDisplay: "proj-2",
        },
      ],
    });

    const { context } = createMockContext();
    const func = await viewCommand.loader();

    try {
      // No target arg triggers AutoDetect
      await func.call(context, { json: false, web: true });
      expect.unreachable("Should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ContextError);
      expect((error as ContextError).message).toContain("Single project");
    }
  });

  test("project search resolves and fetches project", async () => {
    resolveProjectBySlugSpy.mockResolvedValue({
      org: "acme",
      project: "frontend",
    });
    getProjectSpy.mockResolvedValue({ ...sampleProject, slug: "frontend" });
    getProjectKeysSpy.mockResolvedValue(sampleKeys);

    const { context, stdoutWrite } = createMockContext();
    const func = await viewCommand.loader();
    await func.call(context, { json: true, web: false }, "frontend");

    expect(resolveProjectBySlugSpy).toHaveBeenCalledWith(
      "frontend",
      "sentry project view <org>/<project>",
      "sentry project view <org>/frontend",
      context.stderr
    );
    const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
    const parsed = JSON.parse(output);
    expect(parsed.slug).toBe("frontend");
  });

  test("org-only target (org/) throws ContextError", async () => {
    const { context } = createMockContext();
    const func = await viewCommand.loader();

    try {
      await func.call(context, { json: false, web: false }, "my-org/");
      expect.unreachable("Should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ContextError);
      expect((error as ContextError).message).toContain("Specific project");
      expect((error as ContextError).message).toContain(
        "not just the organization"
      );
    }
  });

  test("auto-detect uses resolveAllTargets and writes footer", async () => {
    resolveAllTargetsSpy.mockResolvedValue({
      targets: [
        {
          org: "my-org",
          project: "backend",
          orgDisplay: "my-org",
          projectDisplay: "backend",
          detectedFrom: ".env",
        },
      ],
      footer: "Detected 1 project from .env",
    });
    getProjectSpy.mockResolvedValue({ ...sampleProject, slug: "backend" });
    getProjectKeysSpy.mockResolvedValue(sampleKeys);

    const { context, stdoutWrite } = createMockContext();
    const func = await viewCommand.loader();
    // No target arg triggers AutoDetect
    await func.call(context, { json: false, web: false });

    expect(resolveAllTargetsSpy).toHaveBeenCalled();
    const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("backend");
    expect(output).toContain("Detected 1 project from .env");
  });

  test("auto-detect with 0 targets throws ContextError", async () => {
    resolveAllTargetsSpy.mockResolvedValue({ targets: [] });

    const { context } = createMockContext();
    const func = await viewCommand.loader();

    await expect(
      func.call(context, { json: false, web: false })
    ).rejects.toThrow(ContextError);
  });

  test("auto-detect with skippedSelfHosted includes DSN hint in error", async () => {
    resolveAllTargetsSpy.mockResolvedValue({
      targets: [],
      skippedSelfHosted: 3,
    });

    const { context } = createMockContext();
    const func = await viewCommand.loader();

    try {
      await func.call(context, { json: false, web: false });
      expect.unreachable("Should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ContextError);
      const msg = (error as ContextError).message;
      expect(msg).toContain("3 DSN(s)");
      expect(msg).toContain("could not be resolved");
    }
  });

  test("non-auth API error is skipped silently", async () => {
    getProjectSpy.mockRejectedValue(new Error("404 Not Found"));
    getProjectKeysSpy.mockResolvedValue(sampleKeys);

    const { context } = createMockContext();
    const func = await viewCommand.loader();

    // The project fetch fails with a non-auth error, so it's filtered out.
    // With no successful results, buildContextError is thrown.
    await expect(
      func.call(context, { json: false, web: false }, "my-org/bad-project")
    ).rejects.toThrow(ContextError);

    // getProject was called (it just failed)
    expect(getProjectSpy).toHaveBeenCalledWith("my-org", "bad-project");
  });

  test("auth error from API is rethrown", async () => {
    getProjectSpy.mockRejectedValue(new AuthError("not_authenticated"));
    getProjectKeysSpy.mockResolvedValue(sampleKeys);

    const { context } = createMockContext();
    const func = await viewCommand.loader();

    await expect(
      func.call(context, { json: false, web: false }, "my-org/test-project")
    ).rejects.toThrow(AuthError);
  });
});
