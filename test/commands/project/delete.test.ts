/**
 * Project Delete Command Tests
 *
 * Tests for the project delete command in src/commands/project/delete.ts.
 * Uses spyOn to mock api-client and resolve-target to test
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
import { deleteCommand } from "../../../src/commands/project/delete.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as apiClient from "../../../src/lib/api-client.js";
import { ApiError, ContextError } from "../../../src/lib/errors.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as resolveTarget from "../../../src/lib/resolve-target.js";
import type { SentryProject } from "../../../src/types/index.js";

const sampleProject: SentryProject = {
  id: "999",
  slug: "my-app",
  name: "My App",
  platform: "python",
  dateCreated: "2026-02-12T10:00:00Z",
};

function createMockContext() {
  const stdoutWrite = mock(() => true);
  const stderrWrite = mock(() => true);
  return {
    context: {
      stdout: { write: stdoutWrite },
      stderr: { write: stderrWrite },
      cwd: "/tmp",
      setContext: mock(() => {
        // no-op for test
      }),
    },
    stdoutWrite,
    stderrWrite,
  };
}

describe("project delete", () => {
  let getProjectSpy: ReturnType<typeof spyOn>;
  let deleteProjectSpy: ReturnType<typeof spyOn>;
  let resolveProjectBySlugSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    getProjectSpy = spyOn(apiClient, "getProject");
    deleteProjectSpy = spyOn(apiClient, "deleteProject");
    resolveProjectBySlugSpy = spyOn(resolveTarget, "resolveProjectBySlug");

    // Default mocks
    getProjectSpy.mockResolvedValue(sampleProject);
    deleteProjectSpy.mockResolvedValue(undefined);
    resolveProjectBySlugSpy.mockResolvedValue({
      org: "acme-corp",
      project: "my-app",
    });
  });

  afterEach(() => {
    getProjectSpy.mockRestore();
    deleteProjectSpy.mockRestore();
    resolveProjectBySlugSpy.mockRestore();
  });

  test("deletes project with explicit org/project and --yes", async () => {
    const { context, stdoutWrite } = createMockContext();
    const func = await deleteCommand.loader();
    await func.call(context, { yes: true, json: false }, "acme-corp/my-app");

    expect(getProjectSpy).toHaveBeenCalledWith("acme-corp", "my-app");
    expect(deleteProjectSpy).toHaveBeenCalledWith("acme-corp", "my-app");

    const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("Deleted project 'My App'");
    expect(output).toContain("acme-corp/my-app");
  });

  test("deletes project with bare slug and --yes", async () => {
    const { context } = createMockContext();
    const func = await deleteCommand.loader();
    await func.call(context, { yes: true, json: false }, "my-app");

    expect(resolveProjectBySlugSpy).toHaveBeenCalledWith(
      "my-app",
      "sentry project delete <org>/<project>",
      "sentry project delete <org>/my-app"
    );
    expect(deleteProjectSpy).toHaveBeenCalledWith("acme-corp", "my-app");
  });

  test("errors when only org is provided (org-all)", async () => {
    const { context } = createMockContext();
    const func = await deleteCommand.loader();

    await expect(
      func.call(context, { yes: true, json: false }, "acme-corp/")
    ).rejects.toThrow(ContextError);

    expect(deleteProjectSpy).not.toHaveBeenCalled();
  });

  test("errors in non-interactive mode without --yes", async () => {
    const { context } = createMockContext();
    const func = await deleteCommand.loader();

    // isatty(0) returns false in test environments (non-TTY)
    await expect(
      func.call(context, { yes: false, json: false }, "acme-corp/my-app")
    ).rejects.toThrow("non-interactive mode");

    expect(deleteProjectSpy).not.toHaveBeenCalled();
  });

  test("outputs JSON when --json flag is set", async () => {
    const { context, stdoutWrite } = createMockContext();
    const func = await deleteCommand.loader();
    await func.call(context, { yes: true, json: true }, "acme-corp/my-app");

    const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
    const parsed = JSON.parse(output.trim());
    expect(parsed).toEqual({
      deleted: true,
      org: "acme-corp",
      project: "my-app",
    });
  });

  test("propagates 404 from getProject", async () => {
    getProjectSpy.mockRejectedValue(
      new ApiError("Not found", 404, "Project not found")
    );

    const { context } = createMockContext();
    const func = await deleteCommand.loader();

    await expect(
      func.call(context, { yes: true, json: false }, "acme-corp/my-app")
    ).rejects.toThrow(ApiError);

    expect(deleteProjectSpy).not.toHaveBeenCalled();
  });

  test("shows actionable message on 403 from deleteProject", async () => {
    deleteProjectSpy.mockRejectedValue(
      new ApiError("Forbidden", 403, "You do not have permission")
    );

    const { context } = createMockContext();
    const func = await deleteCommand.loader();

    await expect(
      func.call(context, { yes: true, json: false }, "acme-corp/my-app")
    ).rejects.toThrow("project:admin");
  });

  test("verifies project exists before attempting delete", async () => {
    const { context } = createMockContext();
    const func = await deleteCommand.loader();
    await func.call(context, { yes: true, json: false }, "acme-corp/my-app");

    // getProject must be called before deleteProject
    const getProjectOrder = getProjectSpy.mock.invocationCallOrder[0];
    const deleteProjectOrder = deleteProjectSpy.mock.invocationCallOrder[0];
    expect(getProjectOrder).toBeLessThan(deleteProjectOrder ?? 0);
  });
});
