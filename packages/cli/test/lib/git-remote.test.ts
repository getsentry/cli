import { afterEach, describe, expect, test, vi } from "vitest";

// Mock node:child_process so the remote helpers never shell out to a real git.
const execFileSyncMock = vi.fn(() => "");
vi.mock("node:child_process", () => ({
  execFileSync: (...args: unknown[]) => execFileSyncMock(...args),
}));

import {
  getRemoteDefaultBranch,
  getRemoteUrl,
  getRepositoryName,
  getVcsRemote,
} from "../../src/lib/git.js";
import { useEnvSandbox } from "../helpers.js";

/** Extract the argv passed to the mocked git invocation. */
function lastGitArgs(): string[] {
  const call = execFileSyncMock.mock.calls.at(-1);
  // execFileSync(file, args, options)
  return (call?.[1] ?? []) as string[];
}

describe("getVcsRemote", () => {
  useEnvSandbox(["SENTRY_VCS_REMOTE"]);

  test("defaults to origin", () => {
    expect(getVcsRemote()).toBe("origin");
  });

  test("honors SENTRY_VCS_REMOTE", () => {
    process.env.SENTRY_VCS_REMOTE = "upstream";
    expect(getVcsRemote()).toBe("upstream");
  });

  test("trims whitespace and ignores empty values", () => {
    process.env.SENTRY_VCS_REMOTE = "  upstream  ";
    expect(getVcsRemote()).toBe("upstream");

    process.env.SENTRY_VCS_REMOTE = "   ";
    expect(getVcsRemote()).toBe("origin");
  });

  test("ignores option-like names so git cannot parse them as flags", () => {
    process.env.SENTRY_VCS_REMOTE = "--verbose";
    expect(getVcsRemote()).toBe("origin");
  });
});

describe("remote helpers use the configured remote", () => {
  useEnvSandbox(["SENTRY_VCS_REMOTE"]);

  afterEach(() => {
    execFileSyncMock.mockClear();
    execFileSyncMock.mockReturnValue("");
  });

  test("getRepositoryName reads origin by default", () => {
    execFileSyncMock.mockReturnValue("git@github.com:acme/app.git");

    expect(getRepositoryName("/repo")).toBe("acme/app");
    expect(lastGitArgs()).toEqual(["remote", "get-url", "origin"]);
  });

  test("getRepositoryName reads SENTRY_VCS_REMOTE", () => {
    process.env.SENTRY_VCS_REMOTE = "upstream";
    execFileSyncMock.mockReturnValue("https://github.com/acme/app.git");

    expect(getRepositoryName("/repo")).toBe("acme/app");
    expect(lastGitArgs()).toEqual(["remote", "get-url", "upstream"]);
  });

  test("getRemoteUrl reads SENTRY_VCS_REMOTE", () => {
    process.env.SENTRY_VCS_REMOTE = "upstream";
    execFileSyncMock.mockReturnValue("https://github.com/acme/app.git");

    expect(getRemoteUrl("/repo")).toBe("https://github.com/acme/app.git");
    expect(lastGitArgs()).toEqual(["remote", "get-url", "upstream"]);
  });

  test("getRemoteDefaultBranch resolves the configured remote's HEAD", () => {
    process.env.SENTRY_VCS_REMOTE = "upstream";
    execFileSyncMock.mockReturnValue("refs/remotes/upstream/main");

    expect(getRemoteDefaultBranch("/repo")).toBe("main");
    expect(lastGitArgs()).toEqual([
      "symbolic-ref",
      "refs/remotes/upstream/HEAD",
    ]);
  });
});
