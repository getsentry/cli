/**
 * Release Set-Commits Command Tests
 *
 * Tests the --commit flag parsing (single SHA, ranges, validation)
 * and mode mutual exclusivity.
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
import type { OrgReleaseResponse } from "@sentry/api";
import { setCommitsCommand } from "../../../src/commands/release/set-commits.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as apiClient from "../../../src/lib/api-client.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as resolveTarget from "../../../src/lib/resolve-target.js";
import { useTestConfigDir } from "../../helpers.js";

useTestConfigDir("release-set-commits-");

const sampleRelease: OrgReleaseResponse = {
  id: 1,
  version: "1.0.0",
  shortVersion: "1.0.0",
  status: "open",
  dateCreated: "2025-01-01T00:00:00Z",
  dateReleased: null,
  commitCount: 3,
  deployCount: 0,
  newGroups: 0,
  authors: [],
  projects: [],
  data: {},
  versionInfo: null,
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

describe("release set-commits --commit", () => {
  let setCommitsWithRefsSpy: ReturnType<typeof spyOn>;
  let resolveOrgSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    setCommitsWithRefsSpy = spyOn(apiClient, "setCommitsWithRefs");
    resolveOrgSpy = spyOn(resolveTarget, "resolveOrg");
  });

  afterEach(() => {
    setCommitsWithRefsSpy.mockRestore();
    resolveOrgSpy.mockRestore();
  });

  test("parses single REPO@SHA", async () => {
    resolveOrgSpy.mockResolvedValue({ org: "my-org" });
    setCommitsWithRefsSpy.mockResolvedValue(sampleRelease);

    const { context } = createMockContext();
    const func = await setCommitsCommand.loader();
    await func.call(
      context,
      {
        auto: false,
        local: false,
        clear: false,
        commit: "owner/repo@abc123",
        "initial-depth": 20,
        json: true,
      },
      "1.0.0"
    );

    expect(setCommitsWithRefsSpy).toHaveBeenCalledWith("my-org", "1.0.0", [
      { repository: "owner/repo", commit: "abc123" },
    ]);
  });

  test("parses REPO@PREV..SHA range", async () => {
    resolveOrgSpy.mockResolvedValue({ org: "my-org" });
    setCommitsWithRefsSpy.mockResolvedValue(sampleRelease);

    const { context } = createMockContext();
    const func = await setCommitsCommand.loader();
    await func.call(
      context,
      {
        auto: false,
        local: false,
        clear: false,
        commit: "owner/repo@abc123..def456",
        "initial-depth": 20,
        json: true,
      },
      "1.0.0"
    );

    expect(setCommitsWithRefsSpy).toHaveBeenCalledWith("my-org", "1.0.0", [
      {
        repository: "owner/repo",
        commit: "def456",
        previousCommit: "abc123",
      },
    ]);
  });

  test("parses comma-separated refs", async () => {
    resolveOrgSpy.mockResolvedValue({ org: "my-org" });
    setCommitsWithRefsSpy.mockResolvedValue(sampleRelease);

    const { context } = createMockContext();
    const func = await setCommitsCommand.loader();
    await func.call(
      context,
      {
        auto: false,
        local: false,
        clear: false,
        commit: "repo-a@sha1,repo-b@prev..sha2",
        "initial-depth": 20,
        json: true,
      },
      "1.0.0"
    );

    expect(setCommitsWithRefsSpy).toHaveBeenCalledWith("my-org", "1.0.0", [
      { repository: "repo-a", commit: "sha1" },
      { repository: "repo-b", commit: "sha2", previousCommit: "prev" },
    ]);
  });

  test("throws on invalid format (no @)", async () => {
    resolveOrgSpy.mockResolvedValue({ org: "my-org" });

    const { context } = createMockContext();
    const func = await setCommitsCommand.loader();

    await expect(
      func.call(
        context,
        {
          auto: false,
          local: false,
          clear: false,
          commit: "invalid-no-at-sign",
          "initial-depth": 20,
          json: false,
        },
        "1.0.0"
      )
    ).rejects.toThrow("Invalid commit format");
  });

  test("throws when --commit used with --auto", async () => {
    resolveOrgSpy.mockResolvedValue({ org: "my-org" });

    const { context } = createMockContext();
    const func = await setCommitsCommand.loader();

    await expect(
      func.call(
        context,
        {
          auto: true,
          local: false,
          clear: false,
          commit: "repo@sha",
          "initial-depth": 20,
          json: false,
        },
        "1.0.0"
      )
    ).rejects.toThrow("Only one of --auto, --local, or --commit");
  });
});
