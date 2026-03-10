import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
// biome-ignore lint/performance/noNamespaceImport: spyOn requires object reference
import * as clack from "@clack/prompts";
import {
  checkGitStatus,
  getUncommittedOrUntrackedFiles,
  isInsideGitWorkTree,
} from "../../../src/lib/init/git.js";

const noop = () => {
  /* suppress output */
};

let spawnSyncSpy: ReturnType<typeof spyOn>;
let confirmSpy: ReturnType<typeof spyOn>;
let isCancelSpy: ReturnType<typeof spyOn>;
let logWarnSpy: ReturnType<typeof spyOn>;

beforeEach(() => {
  spawnSyncSpy = spyOn(Bun, "spawnSync");
  confirmSpy = spyOn(clack, "confirm").mockResolvedValue(true);
  isCancelSpy = spyOn(clack, "isCancel").mockImplementation(
    (v: unknown) => v === Symbol.for("cancel")
  );
  logWarnSpy = spyOn(clack.log, "warn").mockImplementation(noop);
});

afterEach(() => {
  spawnSyncSpy.mockRestore();
  confirmSpy.mockRestore();
  isCancelSpy.mockRestore();
  logWarnSpy.mockRestore();
});

describe("isInsideGitWorkTree", () => {
  test("returns true when git succeeds", () => {
    spawnSyncSpy.mockReturnValue({ exitCode: 0, success: true });

    expect(isInsideGitWorkTree({ cwd: "/tmp" })).toBe(true);
    expect(spawnSyncSpy).toHaveBeenCalledWith(
      ["git", "rev-parse", "--is-inside-work-tree"],
      expect.objectContaining({ cwd: "/tmp" })
    );
  });

  test("returns false when git fails", () => {
    spawnSyncSpy.mockReturnValue({ exitCode: 128, success: false });

    expect(isInsideGitWorkTree({ cwd: "/tmp" })).toBe(false);
  });
});

describe("getUncommittedOrUntrackedFiles", () => {
  test("parses porcelain output into file list", () => {
    spawnSyncSpy.mockReturnValue({
      stdout: Buffer.from(" M src/index.ts\n?? new-file.ts\n"),
      exitCode: 0,
      success: true,
    });

    const files = getUncommittedOrUntrackedFiles({ cwd: "/tmp" });

    expect(files).toEqual(["-  M src/index.ts", "- ?? new-file.ts"]);
  });

  test("returns empty array for clean repo", () => {
    spawnSyncSpy.mockReturnValue({
      stdout: Buffer.from(""),
      exitCode: 0,
      success: true,
    });

    expect(getUncommittedOrUntrackedFiles({ cwd: "/tmp" })).toEqual([]);
  });

  test("returns empty array on error", () => {
    spawnSyncSpy.mockReturnValue({
      stdout: Buffer.from(""),
      exitCode: 128,
      success: false,
    });

    expect(getUncommittedOrUntrackedFiles({ cwd: "/tmp" })).toEqual([]);
  });
});

describe("checkGitStatus", () => {
  test("returns true silently for clean git repo", async () => {
    spawnSyncSpy
      // isInsideGitWorkTree -> true
      .mockReturnValueOnce({ exitCode: 0, success: true })
      // getUncommittedOrUntrackedFiles -> clean
      .mockReturnValueOnce({
        stdout: Buffer.from(""),
        exitCode: 0,
        success: true,
      });

    const result = await checkGitStatus({ cwd: "/tmp", yes: false });

    expect(result).toBe(true);
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(logWarnSpy).not.toHaveBeenCalled();
  });

  test("prompts when not in git repo (interactive) and returns true on confirm", async () => {
    spawnSyncSpy.mockReturnValue({ exitCode: 128, success: false });
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
    spawnSyncSpy.mockReturnValue({ exitCode: 128, success: false });
    confirmSpy.mockResolvedValue(false);

    const result = await checkGitStatus({ cwd: "/tmp", yes: false });

    expect(result).toBe(false);
  });

  test("returns false without throwing when user cancels not-in-git-repo prompt", async () => {
    spawnSyncSpy.mockReturnValue({ exitCode: 128, success: false });
    confirmSpy.mockResolvedValue(Symbol.for("cancel"));

    const result = await checkGitStatus({ cwd: "/tmp", yes: false });

    expect(result).toBe(false);
  });

  test("warns and auto-continues when not in git repo with --yes", async () => {
    spawnSyncSpy.mockReturnValue({ exitCode: 128, success: false });

    const result = await checkGitStatus({ cwd: "/tmp", yes: true });

    expect(result).toBe(true);
    expect(logWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining("not inside a git repository")
    );
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  test("shows files and prompts for dirty tree (interactive), returns true on confirm", async () => {
    spawnSyncSpy
      // isInsideGitWorkTree -> true
      .mockReturnValueOnce({ exitCode: 0, success: true })
      // getUncommittedOrUntrackedFiles -> dirty
      .mockReturnValueOnce({
        stdout: Buffer.from(" M dirty.ts\n"),
        exitCode: 0,
        success: true,
      });
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
    spawnSyncSpy
      .mockReturnValueOnce({ exitCode: 0, success: true })
      .mockReturnValueOnce({
        stdout: Buffer.from(" M dirty.ts\n"),
        exitCode: 0,
        success: true,
      });
    confirmSpy.mockResolvedValue(false);

    const result = await checkGitStatus({ cwd: "/tmp", yes: false });

    expect(result).toBe(false);
  });

  test("returns false without throwing when user cancels dirty-tree prompt", async () => {
    spawnSyncSpy
      .mockReturnValueOnce({ exitCode: 0, success: true })
      .mockReturnValueOnce({
        stdout: Buffer.from(" M dirty.ts\n"),
        exitCode: 0,
        success: true,
      });
    confirmSpy.mockResolvedValue(Symbol.for("cancel"));

    const result = await checkGitStatus({ cwd: "/tmp", yes: false });

    expect(result).toBe(false);
  });

  test("warns with file list and auto-continues for dirty tree with --yes", async () => {
    spawnSyncSpy
      .mockReturnValueOnce({ exitCode: 0, success: true })
      .mockReturnValueOnce({
        stdout: Buffer.from(" M dirty.ts\n?? new.ts\n"),
        exitCode: 0,
        success: true,
      });

    const result = await checkGitStatus({ cwd: "/tmp", yes: true });

    expect(result).toBe(true);
    expect(logWarnSpy).toHaveBeenCalled();
    const warnMsg: string = logWarnSpy.mock.calls[0][0];
    expect(warnMsg).toContain("uncommitted");
    expect(warnMsg).toContain("M dirty.ts");
    expect(confirmSpy).not.toHaveBeenCalled();
  });
});
