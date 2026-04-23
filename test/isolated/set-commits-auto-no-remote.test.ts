/**
 * Isolated test for setCommitsAuto when no git remote is available.
 *
 * Separate from set-commits-auto.test.ts because mock.module()
 * sets getRepositoryName to return null (different mock).
 */

import { describe, expect, mock, test } from "bun:test";
import { useTestConfigDir } from "../helpers.js";

useTestConfigDir("set-commits-auto-no-remote-");

mock.module("../../src/lib/git.js", () => ({
  getRepositoryName: () => null,
  getHeadCommit: () => "0000000000000000000000000000000000000000",
  isInsideGitWorkTree: () => false,
  isShallowRepository: () => false,
  getCommitLog: () => [],
  getUncommittedFiles: () => [],
  parseRemoteUrl: (url: string) => url,
}));

const { setCommitsAuto } = await import("../../src/lib/api/releases.js");

describe("setCommitsAuto (no git remote)", () => {
  test("throws ValidationError when local git remote is not available", async () => {
    await expect(setCommitsAuto("test-org", "1.0.0", "/tmp")).rejects.toThrow(
      /Could not determine repository name/
    );
  });
});
