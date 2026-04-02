/**
 * Release View Command Tests
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
import { viewCommand } from "../../../src/commands/release/view.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as apiClient from "../../../src/lib/api-client.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as resolveTarget from "../../../src/lib/resolve-target.js";
import { useTestConfigDir } from "../../helpers.js";

useTestConfigDir("release-view-");

const sampleRelease: OrgReleaseResponse = {
  id: 1,
  version: "1.0.0",
  shortVersion: "1.0.0",
  status: "open",
  dateCreated: "2025-01-01T00:00:00Z",
  dateReleased: null,
  commitCount: 5,
  deployCount: 1,
  newGroups: 0,
  ref: "main",
  url: null,
  versionInfo: null,
  data: {},
  authors: [],
  projects: [
    {
      id: 1,
      slug: "my-project",
      name: "My Project",
      platform: null,
      platforms: null,
      hasHealthData: false,
      newGroups: 0,
    },
  ],
};

function createMockContext(cwd = "/tmp") {
  const stdoutWrite = mock(() => true);
  const stderrWrite = mock(() => true);
  return {
    context: {
      stdout: { write: stdoutWrite },
      stderr: { write: stderrWrite },
      cwd,
    },
    stdoutWrite,
    stderrWrite,
  };
}

describe("release view", () => {
  let getReleaseSpy: ReturnType<typeof spyOn>;
  let resolveOrgSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    getReleaseSpy = spyOn(apiClient, "getRelease");
    resolveOrgSpy = spyOn(resolveTarget, "resolveOrg");
  });

  afterEach(() => {
    getReleaseSpy.mockRestore();
    resolveOrgSpy.mockRestore();
  });

  test("displays release details in JSON mode", async () => {
    resolveOrgSpy.mockResolvedValue({ org: "my-org" });
    getReleaseSpy.mockResolvedValue(sampleRelease);

    const { context, stdoutWrite } = createMockContext();
    const func = await viewCommand.loader();
    await func.call(context, { fresh: false, json: true }, "my-org/1.0.0");

    const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
    const parsed = JSON.parse(output);
    expect(parsed.version).toBe("1.0.0");
    expect(parsed.commitCount).toBe(5);
  });

  test("displays release details in human mode", async () => {
    resolveOrgSpy.mockResolvedValue({ org: "my-org" });
    getReleaseSpy.mockResolvedValue(sampleRelease);

    const { context, stdoutWrite } = createMockContext();
    const func = await viewCommand.loader();
    await func.call(context, { fresh: false, json: false }, "1.0.0");

    const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("1.0.0");
    expect(output).toContain("Commits");
  });

  test("resolves org from explicit prefix", async () => {
    resolveOrgSpy.mockResolvedValue({ org: "my-org" });
    getReleaseSpy.mockResolvedValue(sampleRelease);

    const { context } = createMockContext();
    const func = await viewCommand.loader();
    await func.call(context, { fresh: false, json: true }, "my-org/1.0.0");

    expect(resolveOrgSpy).toHaveBeenCalledWith({ org: "my-org", cwd: "/tmp" });
    expect(getReleaseSpy).toHaveBeenCalledWith("my-org", "1.0.0");
  });

  test("throws when no version provided", async () => {
    const { context } = createMockContext();
    const func = await viewCommand.loader();

    await expect(
      func.call(context, { fresh: false, json: false })
    ).rejects.toThrow("Release version");
  });

  test("throws when org cannot be resolved", async () => {
    resolveOrgSpy.mockResolvedValue(null);

    const { context } = createMockContext();
    const func = await viewCommand.loader();

    await expect(
      func.call(context, { fresh: false, json: false }, "1.0.0")
    ).rejects.toThrow("Organization");
  });
});
