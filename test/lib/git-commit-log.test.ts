import { afterEach, describe, expect, test, vi } from "vitest";

// Mock node:child_process so getCommitLog never shells out to a real git.
const execFileSyncMock = vi.fn(() => "");
vi.mock("node:child_process", () => ({
  execFileSync: (...args: unknown[]) => execFileSyncMock(...args),
}));

import { getCommitLog } from "../../src/lib/git.js";

/** Extract the argv passed to the mocked git invocation. */
function lastGitArgs(): string[] {
  const call = execFileSyncMock.mock.calls.at(-1);
  // execFileSync(file, args, options)
  return (call?.[1] ?? []) as string[];
}

describe("getCommitLog pathspec argv", () => {
  afterEach(() => {
    execFileSyncMock.mockClear();
    execFileSyncMock.mockReturnValue("");
  });

  test("appends `--` and paths when paths provided", () => {
    getCommitLog("/repo", { paths: ["apps/mobile", "packages/shared"] });

    const args = lastGitArgs();
    expect(args).toContain("--");
    const sep = args.indexOf("--");
    expect(args.slice(sep + 1)).toEqual(["apps/mobile", "packages/shared"]);
  });

  test("omits `--` when no paths provided", () => {
    getCommitLog("/repo", {});
    expect(lastGitArgs()).not.toContain("--");
  });

  test("omits `--` for empty paths array", () => {
    getCommitLog("/repo", { paths: [] });
    expect(lastGitArgs()).not.toContain("--");
  });

  test("pathspec follows the commit range", () => {
    getCommitLog("/repo", { from: "abc123", paths: ["src"] });

    const args = lastGitArgs();
    const rangeIdx = args.indexOf("abc123..HEAD");
    const sepIdx = args.indexOf("--");
    expect(rangeIdx).toBeGreaterThanOrEqual(0);
    expect(sepIdx).toBeGreaterThan(rangeIdx);
  });

  test("parses NUL-delimited git output into commits", () => {
    execFileSyncMock.mockReturnValue(
      "abc\x00subject\x00Jane\x00jane@example.com\x002026-01-01T00:00:00Z"
    );

    const commits = getCommitLog("/repo", { paths: ["src"] });
    expect(commits).toEqual([
      {
        id: "abc",
        message: "subject",
        author_name: "Jane",
        author_email: "jane@example.com",
        timestamp: "2026-01-01T00:00:00Z",
      },
    ]);
  });
});
