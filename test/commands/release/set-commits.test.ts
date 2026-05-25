/**
 * Release Set-Commits Command Tests
 *
 * Tests the --commit flag parsing (single SHA, ranges, validation)
 * and mode mutual exclusivity.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { setCommitsCommand } from "../../../src/commands/release/set-commits.js";

vi.mock("../../../src/lib/api-client.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../src/lib/api-client.js")>();
  return Object.fromEntries(
    Object.entries(actual).map(([k, v]) => [
      k,
      typeof v === "function" ? vi.fn(v) : v,
    ])
  );
});

// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as apiClient from "../../../src/lib/api-client.js";
import { ApiError, ValidationError } from "../../../src/lib/errors.js";

vi.mock("../../../src/lib/resolve-target.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../src/lib/resolve-target.js")>();
  return Object.fromEntries(
    Object.entries(actual).map(([k, v]) => [
      k,
      typeof v === "function" ? vi.fn(v) : v,
    ])
  );
});

// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as resolveTarget from "../../../src/lib/resolve-target.js";
import type { SentryRelease } from "../../../src/types/index.js";
import { useTestConfigDir } from "../../helpers.js";

useTestConfigDir("release-set-commits-");

const sampleRelease: SentryRelease = {
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
  const stdoutWrite = vi.fn(() => true);
  const stderrWrite = vi.fn(() => true);
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
    setCommitsWithRefsSpy = vi.spyOn(apiClient, "setCommitsWithRefs");
    resolveOrgSpy = vi.spyOn(resolveTarget, "resolveOrg");
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

describe("release set-commits --auto", () => {
  let setCommitsAutoSpy: ReturnType<typeof spyOn>;
  let resolveOrgSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    setCommitsAutoSpy = vi.spyOn(apiClient, "setCommitsAuto");
    resolveOrgSpy = vi.spyOn(resolveTarget, "resolveOrg");
  });

  afterEach(() => {
    setCommitsAutoSpy.mockRestore();
    resolveOrgSpy.mockRestore();
  });

  test("passes cwd to setCommitsAuto", async () => {
    resolveOrgSpy.mockResolvedValue({ org: "my-org" });
    setCommitsAutoSpy.mockResolvedValue(sampleRelease);

    const { context } = createMockContext("/my/project");
    const func = await setCommitsCommand.loader();
    await func.call(
      context,
      {
        auto: true,
        local: false,
        clear: false,
        commit: undefined,
        "initial-depth": 20,
        json: true,
      },
      "1.0.0"
    );

    expect(setCommitsAutoSpy).toHaveBeenCalledWith(
      "my-org",
      "1.0.0",
      "/my/project"
    );
  });
});

describe("release set-commits (default mode)", () => {
  let setCommitsAutoSpy: ReturnType<typeof spyOn>;
  let setCommitsLocalSpy: ReturnType<typeof spyOn>;
  let resolveOrgSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    setCommitsAutoSpy = vi.spyOn(apiClient, "setCommitsAuto");
    setCommitsLocalSpy = vi.spyOn(apiClient, "setCommitsLocal");
    resolveOrgSpy = vi.spyOn(resolveTarget, "resolveOrg");
  });

  afterEach(() => {
    setCommitsAutoSpy.mockRestore();
    setCommitsLocalSpy.mockRestore();
    resolveOrgSpy.mockRestore();
  });

  test("propagates unrelated 400 errors from setCommitsAuto", async () => {
    resolveOrgSpy.mockResolvedValue({ org: "my-org" });
    setCommitsAutoSpy.mockRejectedValue(
      new ApiError("Invalid commit SHA.", 400, undefined, "releases/1.0.0/")
    );

    const repoRoot = new URL("../../..", import.meta.url).pathname.replace(
      /\/$/,
      ""
    );
    const { context } = createMockContext(repoRoot);
    const func = await setCommitsCommand.loader();
    await expect(
      func.call(
        context,
        {
          auto: false,
          local: false,
          clear: false,
          commit: undefined,
          "initial-depth": 20,
          json: true,
        },
        "1.0.0"
      )
    ).rejects.toThrow("Invalid commit SHA.");

    expect(setCommitsAutoSpy).toHaveBeenCalled();
    expect(setCommitsLocalSpy).not.toHaveBeenCalled();
  });

  test("falls back to local only on 'No repository integrations' 400", async () => {
    resolveOrgSpy.mockResolvedValue({ org: "my-org" });
    setCommitsAutoSpy.mockRejectedValue(
      new ApiError(
        "No repository integrations configured for this organization.",
        400,
        undefined,
        "releases/1.0.0/"
      )
    );
    setCommitsLocalSpy.mockResolvedValue(sampleRelease);

    const repoRoot = new URL("../../..", import.meta.url).pathname.replace(
      /\/$/,
      ""
    );
    const { context } = createMockContext(repoRoot);
    const func = await setCommitsCommand.loader();
    await func.call(
      context,
      {
        auto: false,
        local: false,
        clear: false,
        commit: undefined,
        "initial-depth": 20,
        json: true,
      },
      "1.0.0"
    );

    expect(setCommitsAutoSpy).toHaveBeenCalled();
    expect(setCommitsLocalSpy).toHaveBeenCalled();
  });

  test("falls back to local on ValidationError from auto", async () => {
    resolveOrgSpy.mockResolvedValue({ org: "my-org" });
    setCommitsAutoSpy.mockRejectedValue(
      new ValidationError(
        "No Sentry repository matching 'foo/bar'.",
        "repository"
      )
    );
    setCommitsLocalSpy.mockResolvedValue(sampleRelease);

    // Use the actual repo root as cwd so getCommitLog can read git history
    const repoRoot = new URL("../../..", import.meta.url).pathname.replace(
      /\/$/,
      ""
    );
    const { context } = createMockContext(repoRoot);
    const func = await setCommitsCommand.loader();
    await func.call(
      context,
      {
        auto: false,
        local: false,
        clear: false,
        commit: undefined,
        "initial-depth": 20,
        json: true,
      },
      "1.0.0"
    );

    expect(setCommitsAutoSpy).toHaveBeenCalled();
    expect(setCommitsLocalSpy).toHaveBeenCalled();
  });
});
