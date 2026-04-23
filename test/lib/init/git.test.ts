import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
// biome-ignore lint/performance/noNamespaceImport: spyOn requires object reference
import * as clack from "@clack/prompts";
// biome-ignore lint/performance/noNamespaceImport: spyOn requires object reference
import * as gitLib from "../../../src/lib/git.js";
import {
  checkGitStatus,
  getUncommittedOrUntrackedFiles,
  isInsideGitWorkTree,
} from "../../../src/lib/init/git.js";

const noop = () => {
  /* suppress output */
};

let isInsideWorkTreeSpy: ReturnType<typeof spyOn>;
let getUncommittedFilesSpy: ReturnType<typeof spyOn>;
let confirmSpy: ReturnType<typeof spyOn>;
let isCancelSpy: ReturnType<typeof spyOn>;
let logWarnSpy: ReturnType<typeof spyOn>;

beforeEach(() => {
  isInsideWorkTreeSpy = spyOn(gitLib, "isInsideGitWorkTree");
  getUncommittedFilesSpy = spyOn(gitLib, "getUncommittedFiles");
  confirmSpy = spyOn(clack, "confirm").mockResolvedValue(true);
  isCancelSpy = spyOn(clack, "isCancel").mockImplementation(
    (v: unknown) => v === Symbol.for("cancel")
  );
  logWarnSpy = spyOn(clack.log, "warn").mockImplementation(noop);
});

afterEach(() => {
  isInsideWorkTreeSpy.mockRestore();
  getUncommittedFilesSpy.mockRestore();
  confirmSpy.mockRestore();
  isCancelSpy.mockRestore();
  logWarnSpy.mockRestore();
});

describe("isInsideGitWorkTree", () => {
  test("returns true when inside git work tree", () => {
    isInsideWorkTreeSpy.mockReturnValue(true);

    expect(isInsideGitWorkTree({ cwd: "/tmp" })).toBe(true);
    expect(isInsideWorkTreeSpy).toHaveBeenCalledWith("/tmp");
  });

  test("returns false when not in git repo", () => {
    isInsideWorkTreeSpy.mockReturnValue(false);

    expect(isInsideGitWorkTree({ cwd: "/tmp" })).toBe(false);
  });
});

describe("getUncommittedOrUntrackedFiles", () => {
  test("returns formatted file list from lib/git", () => {
    getUncommittedFilesSpy.mockReturnValue([
      "-  M src/index.ts",
      "- ?? new-file.ts",
    ]);

    const files = getUncommittedOrUntrackedFiles({ cwd: "/tmp" });

    expect(files).toEqual(["-  M src/index.ts", "- ?? new-file.ts"]);
    expect(getUncommittedFilesSpy).toHaveBeenCalledWith("/tmp");
  });

  test("returns empty array for clean repo", () => {
    getUncommittedFilesSpy.mockReturnValue([]);

    expect(getUncommittedOrUntrackedFiles({ cwd: "/tmp" })).toEqual([]);
  });
});

describe("checkGitStatus", () => {
  test("returns true silently for clean git repo", async () => {
    isInsideWorkTreeSpy.mockReturnValue(true);
    getUncommittedFilesSpy.mockReturnValue([]);

    const result = await checkGitStatus({ cwd: "/tmp", yes: false });

    expect(result).toBe(true);
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(logWarnSpy).not.toHaveBeenCalled();
  });

  test("prompts when not in git repo (interactive) and returns true on confirm", async () => {
    isInsideWorkTreeSpy.mockReturnValue(false);
    confirmSpy.mockResolvedValue(true);

    const result = await checkGitStatus({ cwd: "/tmp", yes: false });

    expect(result).toBe(true);
    expect(confirmSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("not inside a git repository"),
      })
    );
  });

  test("prompts when not in git repo (interactive) and returns false on decline", async () => {
    isInsideWorkTreeSpy.mockReturnValue(false);
    confirmSpy.mockResolvedValue(false);

    const result = await checkGitStatus({ cwd: "/tmp", yes: false });

    expect(result).toBe(false);
  });

  test("returns false without throwing when user cancels not-in-git-repo prompt", async () => {
    isInsideWorkTreeSpy.mockReturnValue(false);
    confirmSpy.mockResolvedValue(Symbol.for("cancel"));

    const result = await checkGitStatus({ cwd: "/tmp", yes: false });

    expect(result).toBe(false);
  });

  test("warns and auto-continues when not in git repo with --yes", async () => {
    isInsideWorkTreeSpy.mockReturnValue(false);

    const result = await checkGitStatus({ cwd: "/tmp", yes: true });

    expect(result).toBe(true);
    expect(logWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining("not inside a git repository")
    );
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  test("shows files and prompts for dirty tree (interactive), returns true on confirm", async () => {
    isInsideWorkTreeSpy.mockReturnValue(true);
    getUncommittedFilesSpy.mockReturnValue(["-  M dirty.ts"]);
    confirmSpy.mockResolvedValue(true);

    const result = await checkGitStatus({ cwd: "/tmp", yes: false });

    expect(result).toBe(true);
    expect(logWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining("uncommitted")
    );
    expect(confirmSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("uncommitted changes"),
      })
    );
  });

  test("shows files and prompts for dirty tree (interactive), returns false on decline", async () => {
    isInsideWorkTreeSpy.mockReturnValue(true);
    getUncommittedFilesSpy.mockReturnValue(["-  M dirty.ts"]);
    confirmSpy.mockResolvedValue(false);

    const result = await checkGitStatus({ cwd: "/tmp", yes: false });

    expect(result).toBe(false);
  });

  test("returns false without throwing when user cancels dirty-tree prompt", async () => {
    isInsideWorkTreeSpy.mockReturnValue(true);
    getUncommittedFilesSpy.mockReturnValue(["-  M dirty.ts"]);
    confirmSpy.mockResolvedValue(Symbol.for("cancel"));

    const result = await checkGitStatus({ cwd: "/tmp", yes: false });

    expect(result).toBe(false);
  });

  test("warns with file list and auto-continues for dirty tree with --yes", async () => {
    isInsideWorkTreeSpy.mockReturnValue(true);
    getUncommittedFilesSpy.mockReturnValue(["-  M dirty.ts", "- ?? new.ts"]);

    const result = await checkGitStatus({ cwd: "/tmp", yes: true });

    expect(result).toBe(true);
    expect(logWarnSpy).toHaveBeenCalled();
    const warnMsg: string = logWarnSpy.mock.calls[0][0];
    expect(warnMsg).toContain("uncommitted");
    expect(warnMsg).toContain("M dirty.ts");
    expect(confirmSpy).not.toHaveBeenCalled();
  });
});
