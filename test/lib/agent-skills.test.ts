/**
 * Agent Skills Tests
 *
 * Unit tests for Claude Code detection, skill path construction,
 * and embedded skill file installation.
 *
 * Note: URL construction and network fetching tests were removed when
 * skill content was embedded at build time (no more network fetch).
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  detectClaudeCode,
  getSkillInstallPath,
  installAgentSkills,
} from "../../src/lib/agent-skills.js";

describe("agent-skills", () => {
  describe("detectClaudeCode", () => {
    let testDir: string;

    beforeEach(() => {
      testDir = join(
        "/tmp",
        `agent-skills-detect-${Date.now()}-${Math.random().toString(36).slice(2)}`
      );
      mkdirSync(testDir, { recursive: true });
    });

    afterEach(() => {
      rmSync(testDir, { recursive: true, force: true });
    });

    test("returns true when ~/.claude directory exists", () => {
      mkdirSync(join(testDir, ".claude"), { recursive: true });
      expect(detectClaudeCode(testDir)).toBe(true);
    });

    test("returns false when ~/.claude directory does not exist", () => {
      expect(detectClaudeCode(testDir)).toBe(false);
    });
  });

  describe("getSkillInstallPath", () => {
    test("returns correct path under ~/.claude/skills", () => {
      const path = getSkillInstallPath("/home/user");
      expect(path).toBe("/home/user/.claude/skills/sentry-cli/SKILL.md");
    });
  });

  describe("installAgentSkills", () => {
    let testDir: string;

    beforeEach(() => {
      testDir = join(
        "/tmp",
        `agent-skills-install-${Date.now()}-${Math.random().toString(36).slice(2)}`
      );
      mkdirSync(testDir, { recursive: true });
    });

    afterEach(() => {
      rmSync(testDir, { recursive: true, force: true });
    });

    test("returns null when Claude Code is not detected", async () => {
      const result = await installAgentSkills(testDir);
      expect(result).toBeNull();
    });

    test("installs embedded skill files when Claude Code is detected", async () => {
      mkdirSync(join(testDir, ".claude"), { recursive: true });

      const result = await installAgentSkills(testDir);

      expect(result).not.toBeNull();
      expect(result!.created).toBe(true);
      expect(result!.path).toBe(
        join(testDir, ".claude", "skills", "sentry-cli", "SKILL.md")
      );
      expect(existsSync(result!.path)).toBe(true);

      const content = await Bun.file(result!.path).text();
      expect(content).toContain("sentry-cli");

      // Check reference files were created
      expect(result!.referenceCount).toBeGreaterThan(0);
      const refsDir = join(
        testDir,
        ".claude",
        "skills",
        "sentry-cli",
        "references"
      );
      expect(existsSync(refsDir)).toBe(true);
      expect(existsSync(join(refsDir, "issues.md"))).toBe(true);
    });

    test("creates intermediate directories", async () => {
      mkdirSync(join(testDir, ".claude"), { recursive: true });

      const result = await installAgentSkills(testDir);

      expect(result).not.toBeNull();
      expect(existsSync(result!.path)).toBe(true);
    });

    test("reports created: false when updating existing file", async () => {
      mkdirSync(join(testDir, ".claude"), { recursive: true });

      const first = await installAgentSkills(testDir);
      expect(first!.created).toBe(true);

      const second = await installAgentSkills(testDir);
      expect(second!.created).toBe(false);
      expect(second!.path).toBe(first!.path);
    });

    test("returns null on filesystem error without throwing", async () => {
      // Create .claude as a read-only directory so mkdirSync for the
      // skills subdirectory fails with EACCES
      mkdirSync(join(testDir, ".claude"), { recursive: true, mode: 0o444 });

      const result = await installAgentSkills(testDir);
      expect(result).toBeNull();

      // Restore write permission so afterEach cleanup can remove it
      chmodSync(join(testDir, ".claude"), 0o755);
    });
  });
});
