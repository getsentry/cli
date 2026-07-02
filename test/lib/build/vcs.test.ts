/**
 * Tests for VCS metadata collection.
 *
 * `git.js` is mocked so collection is deterministic (no dependency on the
 * checkout's real branch/remote). Covers flag precedence, GitHub Actions env
 * inference, the base==head skip, and the flattened body mapping.
 */

import { describe, expect, test, vi } from "vitest";

const gitMock = vi.hoisted(() => ({
  getHeadCommit: vi.fn(() => "a".repeat(40)),
  getRemoteUrl: vi.fn(() => "https://github.com/acme/app.git"),
  getRepositoryName: vi.fn(() => "acme/app"),
  getCurrentBranch: vi.fn(() => "feature/x"),
  getMergeBase: vi.fn(() => "b".repeat(40)),
}));

vi.mock("../../../src/lib/git.js", () => gitMock);

import {
  collectVcsMetadata,
  isCi,
  vcsInfoToBody,
} from "../../../src/lib/build/vcs.js";

describe("isCi", () => {
  test("true when a CI variable is set", () => {
    expect(isCi({ GITHUB_ACTIONS: "true" })).toBe(true);
    expect(isCi({ CI: "1" })).toBe(true);
  });

  test("false with no CI variables (and ignores empty values)", () => {
    expect(isCi({})).toBe(false);
    expect(isCi({ CI: "" })).toBe(false);
  });
});

describe("vcsInfoToBody", () => {
  test("flattens to snake_case and renames provider", () => {
    expect(
      vcsInfoToBody({
        headSha: "h",
        vcsProvider: "github",
        headRepoName: "o/r",
        prNumber: 5,
      })
    ).toEqual({
      head_sha: "h",
      provider: "github",
      head_repo_name: "o/r",
      pr_number: 5,
    });
  });

  test("omits empty fields", () => {
    expect(vcsInfoToBody({})).toEqual({});
  });

  test("keeps pr_number 0", () => {
    expect(vcsInfoToBody({ prNumber: 0 })).toEqual({ pr_number: 0 });
  });
});

describe("collectVcsMetadata", () => {
  test("uses explicit flags and skips git introspection when autoCollect is false", () => {
    const vcs = collectVcsMetadata(
      { "head-sha": "DEAD", "head-ref": "main", "pr-number": 7 },
      "/repo",
      {},
      false
    );

    expect(vcs.headSha).toBe("dead"); // normalized to lowercase
    expect(vcs.headRef).toBe("main");
    expect(vcs.prNumber).toBe(7);
    expect(gitMock.getHeadCommit).not.toHaveBeenCalled();
    expect(gitMock.getRemoteUrl).not.toHaveBeenCalled();
  });

  test("infers metadata from a GitHub Actions pull_request run", () => {
    const env: NodeJS.ProcessEnv = {
      GITHUB_EVENT_NAME: "pull_request",
      GITHUB_HEAD_REF: "feature/x",
      GITHUB_BASE_REF: "main",
      GITHUB_REPOSITORY: "acme/app",
      GITHUB_REF: "refs/pull/42/merge",
    };

    const vcs = collectVcsMetadata({}, "/repo", env, true);

    expect(vcs.headRef).toBe("feature/x");
    expect(vcs.baseRef).toBe("main");
    expect(vcs.headRepoName).toBe("acme/app");
    expect(vcs.prNumber).toBe(42);
    expect(vcs.vcsProvider).toBe("github");
    expect(vcs.headSha).toBe("a".repeat(40));
    expect(vcs.baseSha).toBe("b".repeat(40));
  });

  test("drops base_sha/base_ref when base equals head and both were auto-inferred", () => {
    gitMock.getHeadCommit.mockReturnValueOnce("c".repeat(40));
    gitMock.getMergeBase.mockReturnValueOnce("c".repeat(40));

    const vcs = collectVcsMetadata(
      {},
      "/repo",
      { GITHUB_EVENT_NAME: "pull_request", GITHUB_BASE_REF: "main" },
      true
    );

    expect(vcs.headSha).toBe("c".repeat(40));
    expect(vcs.baseSha).toBeUndefined();
    expect(vcs.baseRef).toBeUndefined();
  });
});
