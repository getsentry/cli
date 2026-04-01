/**
 * Release Finalize Command Tests
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
import { finalizeCommand } from "../../../src/commands/release/finalize.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as apiClient from "../../../src/lib/api-client.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as resolveTarget from "../../../src/lib/resolve-target.js";
import { useTestConfigDir } from "../../helpers.js";

useTestConfigDir("release-finalize-");

const finalizedRelease: OrgReleaseResponse = {
  id: 1,
  version: "1.0.0",
  shortVersion: "1.0.0",
  status: "open",
  dateCreated: "2025-01-01T00:00:00Z",
  dateReleased: "2025-06-15T12:00:00Z",
  commitCount: 5,
  deployCount: 0,
  newGroups: 0,
  versionInfo: null,
  data: {},
  authors: [],
  projects: [],
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

describe("release finalize", () => {
  let updateReleaseSpy: ReturnType<typeof spyOn>;
  let resolveOrgSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    updateReleaseSpy = spyOn(apiClient, "updateRelease");
    resolveOrgSpy = spyOn(resolveTarget, "resolveOrg");
  });

  afterEach(() => {
    updateReleaseSpy.mockRestore();
    resolveOrgSpy.mockRestore();
  });

  test("finalizes a release", async () => {
    resolveOrgSpy.mockResolvedValue({ org: "my-org" });
    updateReleaseSpy.mockResolvedValue(finalizedRelease);

    const { context, stdoutWrite } = createMockContext();
    const func = await finalizeCommand.loader();
    await func.call(context, { json: true }, "my-org/1.0.0");

    expect(updateReleaseSpy).toHaveBeenCalledWith(
      "my-org",
      "1.0.0",
      expect.objectContaining({ dateReleased: expect.any(String) })
    );
    const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
    const parsed = JSON.parse(output);
    expect(parsed.dateReleased).toBe("2025-06-15T12:00:00Z");
  });

  test("throws when no version provided", async () => {
    const { context } = createMockContext();
    const func = await finalizeCommand.loader();

    await expect(func.call(context, { json: false })).rejects.toThrow(
      "Release version"
    );
  });

  test("throws when org cannot be resolved", async () => {
    resolveOrgSpy.mockResolvedValue(null);

    const { context } = createMockContext();
    const func = await finalizeCommand.loader();

    await expect(func.call(context, { json: false }, "1.0.0")).rejects.toThrow(
      "Organization"
    );
  });
});
