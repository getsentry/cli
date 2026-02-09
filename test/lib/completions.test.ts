/**
 * Completion Utilities Tests
 *
 * Unit tests for completion dispatch logic, path resolution, and file
 * installation. Command tree invariants, cross-shell consistency, and
 * bash simulation are in completions.property.test.ts.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  getCompletionPath,
  getCompletionScript,
  installCompletions,
} from "../../src/lib/completions.js";

describe("completions", () => {
  describe("getCompletionScript", () => {
    test("returns bash script for bash", () => {
      const script = getCompletionScript("bash");
      expect(script).toContain("_sentry_completions");
    });

    test("returns zsh script for zsh", () => {
      const script = getCompletionScript("zsh");
      expect(script).toContain("#compdef sentry");
    });

    test("returns fish script for fish", () => {
      const script = getCompletionScript("fish");
      expect(script).toContain("complete -c sentry");
    });

    test("returns null for unsupported shells", () => {
      expect(getCompletionScript("sh")).toBeNull();
      expect(getCompletionScript("ash")).toBeNull();
      expect(getCompletionScript("unknown")).toBeNull();
    });
  });

  describe("getCompletionPath", () => {
    const homeDir = "/home/user";

    test("returns bash completion path", () => {
      const path = getCompletionPath("bash", homeDir);
      expect(path).toBe(
        "/home/user/.local/share/bash-completion/completions/sentry"
      );
    });

    test("returns zsh completion path", () => {
      const path = getCompletionPath("zsh", homeDir);
      expect(path).toBe("/home/user/.local/share/zsh/site-functions/_sentry");
    });

    test("returns fish completion path", () => {
      const path = getCompletionPath("fish", homeDir);
      expect(path).toBe("/home/user/.config/fish/completions/sentry.fish");
    });

    test("uses custom XDG_DATA_HOME", () => {
      const path = getCompletionPath("bash", homeDir, "/custom/data");
      expect(path).toBe("/custom/data/bash-completion/completions/sentry");
    });

    test("returns null for unsupported shells", () => {
      expect(getCompletionPath("sh", homeDir)).toBeNull();
      expect(getCompletionPath("unknown", homeDir)).toBeNull();
    });
  });

  describe("installCompletions", () => {
    let testDir: string;

    beforeEach(() => {
      testDir = join(
        "/tmp",
        `completions-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
      );
      mkdirSync(testDir, { recursive: true });
    });

    afterEach(() => {
      rmSync(testDir, { recursive: true, force: true });
    });

    test("installs bash completions", async () => {
      const result = await installCompletions("bash", testDir);

      expect(result).not.toBeNull();
      expect(result!.created).toBe(true);
      expect(result!.path).toContain("bash-completion");
      expect(existsSync(result!.path)).toBe(true);

      const content = await Bun.file(result!.path).text();
      expect(content).toContain("_sentry_completions");
    });

    test("installs zsh completions", async () => {
      const result = await installCompletions("zsh", testDir);

      expect(result).not.toBeNull();
      expect(result!.path).toContain("_sentry");
      expect(existsSync(result!.path)).toBe(true);
    });

    test("installs fish completions", async () => {
      const fishDir = join(testDir, ".config", "fish", "completions");
      mkdirSync(fishDir, { recursive: true });

      const result = await installCompletions("fish", testDir);

      expect(result).not.toBeNull();
      expect(result!.path).toContain("sentry.fish");
    });

    test("returns null for unsupported shells", async () => {
      const result = await installCompletions("sh", testDir);
      expect(result).toBeNull();
    });

    test("reports update when file already exists", async () => {
      const first = await installCompletions("bash", testDir);
      expect(first!.created).toBe(true);

      const second = await installCompletions("bash", testDir);
      expect(second!.created).toBe(false);
      expect(second!.path).toBe(first!.path);
    });
  });
});
