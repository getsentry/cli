/**
 * Git Safety Checks Unit Tests
 *
 * Tests for isInsideGitWorkTree, getUncommittedOrUntrackedFiles,
 * and checkGitStatus using spyOn on namespace imports.
 */

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
// biome-ignore lint/performance/noNamespaceImport: spyOn requires object reference
import * as cp from "node:child_process";
// biome-ignore lint/performance/noNamespaceImport: spyOn requires object reference
import * as clack from "@clack/prompts";
import {
  checkGitStatus,
  getUncommittedOrUntrackedFiles,
  isInsideGitWorkTree,
} from "../../../src/lib/init/git.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

const noop = () => {
  /* suppress output */
};

// ── Spy declarations ────────────────────────────────────────────────────────

let execFileSyncSpy: ReturnType<typeof spyOn>;
let confirmSpy: ReturnType<typeof spyOn>;
let logWarnSpy: ReturnType<typeof spyOn>;

// ── Setup / Teardown ────────────────────────────────────────────────────────

beforeEach(() => {
  execFileSyncSpy = spyOn(cp, "execFileSync");
  confirmSpy = spyOn(clack, "confirm").mockResolvedValue(true);
  logWarnSpy = spyOn(clack.log, "warn").mockImplementation(noop);
});

afterEach(() => {
  execFileSyncSpy.mockRestore();
  confirmSpy.mockRestore();
  logWarnSpy.mockRestore();
});

// ── Tests ───────────────────────────────────────────────────────────────────

describe("isInsideGitWorkTree", () => {
  test("returns true when git succeeds", () => {
    execFileSyncSpy.mockReturnValue(Buffer.from("true\n"));

    expect(isInsideGitWorkTree({ cwd: "/tmp" })).toBe(true);
    expect(execFileSyncSpy).toHaveBeenCalledWith(
      "git",
      ["rev-parse", "--is-inside-work-tree"],
      expect.objectContaining({ cwd: "/tmp" })
    );
  });

  test("returns false when git fails", () => {
    execFileSyncSpy.mockImplementation(() => {
      throw new Error("not a git repository");
    });

    expect(isInsideGitWorkTree({ cwd: "/tmp" })).toBe(false);
  });
});

describe("getUncommittedOrUntrackedFiles", () => {
  test("parses porcelain output into file list", () => {
    execFileSyncSpy.mockReturnValue(
      Buffer.from(" M src/index.ts\n?? new-file.ts\n")
    );

    const files = getUncommittedOrUntrackedFiles({ cwd: "/tmp" });

    expect(files).toEqual(["- M src/index.ts", "- ?? new-file.ts"]);
  });

  test("returns empty array for clean repo", () => {
    execFileSyncSpy.mockReturnValue(Buffer.from(""));

    expect(getUncommittedOrUntrackedFiles({ cwd: "/tmp" })).toEqual([]);
  });

  test("returns empty array on error", () => {
    execFileSyncSpy.mockImplementation(() => {
      throw new Error("git failed");
    });

    expect(getUncommittedOrUntrackedFiles({ cwd: "/tmp" })).toEqual([]);
  });
});

describe("checkGitStatus", () => {
  test("returns true silently for clean git repo", async () => {
    // isInsideGitWorkTree -> true
    execFileSyncSpy
      .mockReturnValueOnce(Buffer.from("true\n"))
      // getUncommittedOrUntrackedFiles -> clean
      .mockReturnValueOnce(Buffer.from(""));

    const result = await checkGitStatus({ cwd: "/tmp", yes: false });

    expect(result).toBe(true);
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(logWarnSpy).not.toHaveBeenCalled();
  });

  test("prompts when not in git repo (interactive) and returns true on confirm", async () => {
    execFileSyncSpy.mockImplementation(() => {
      throw new Error("not a git repo");
    });
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
    execFileSyncSpy.mockImplementation(() => {
      throw new Error("not a git repo");
    });
    confirmSpy.mockResolvedValue(false);

    const result = await checkGitStatus({ cwd: "/tmp", yes: false });

    expect(result).toBe(false);
  });

  test("warns and auto-continues when not in git repo with --yes", async () => {
    execFileSyncSpy.mockImplementation(() => {
      throw new Error("not a git repo");
    });

    const result = await checkGitStatus({ cwd: "/tmp", yes: true });

    expect(result).toBe(true);
    expect(logWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining("not inside a git repository")
    );
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  test("shows files and prompts for dirty tree (interactive), returns true on confirm", async () => {
    // isInsideGitWorkTree -> true
    execFileSyncSpy
      .mockReturnValueOnce(Buffer.from("true\n"))
      // getUncommittedOrUntrackedFiles -> dirty
      .mockReturnValueOnce(Buffer.from(" M dirty.ts\n"));
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
    execFileSyncSpy
      .mockReturnValueOnce(Buffer.from("true\n"))
      .mockReturnValueOnce(Buffer.from(" M dirty.ts\n"));
    confirmSpy.mockResolvedValue(false);

    const result = await checkGitStatus({ cwd: "/tmp", yes: false });

    expect(result).toBe(false);
  });

  test("warns with file list and auto-continues for dirty tree with --yes", async () => {
    execFileSyncSpy
      .mockReturnValueOnce(Buffer.from("true\n"))
      .mockReturnValueOnce(Buffer.from(" M dirty.ts\n?? new.ts\n"));

    const result = await checkGitStatus({ cwd: "/tmp", yes: true });

    expect(result).toBe(true);
    expect(logWarnSpy).toHaveBeenCalled();
    const warnMsg: string = logWarnSpy.mock.calls[0][0];
    expect(warnMsg).toContain("uncommitted");
    expect(warnMsg).toContain("M dirty.ts");
    expect(confirmSpy).not.toHaveBeenCalled();
  });
});
