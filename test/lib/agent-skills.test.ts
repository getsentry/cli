/**
 * Agent Skills Tests
 *
 * Unit tests for Claude Code detection, shared path construction, and
 * embedded skill installation across detected agent roots.
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
    test("defaults to the Claude Code path", () => {
      const path = getSkillInstallPath("/home/user");
      expect(path).toBe("/home/user/.claude/skills/sentry-cli/SKILL.md");
    });

    test("returns correct path under ~/.agents/skills", () => {
      const path = getSkillInstallPath("/home/user", ".agents");
      expect(path).toBe("/home/user/.agents/skills/sentry-cli/SKILL.md");
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
      for (const dir of [
        testDir,
        join(testDir, ".agents"),
        join(testDir, ".claude"),
      ]) {
        try {
          if (existsSync(dir)) {
            chmodSync(dir, 0o755);
          }
        } catch {
          // Ignore cleanup races for directories that never existed.
        }
      }
      rmSync(testDir, { recursive: true, force: true });
    });

    test("returns null when no supported agent root is detected", async () => {
      const result = await installAgentSkills(testDir);
      expect(result).toBeNull();
    });

    test("installs to ~/.agents/ when the shared agent root exists", async () => {
      mkdirSync(join(testDir, ".agents"), { recursive: true });

      const result = await installAgentSkills(testDir);

      expect(result).not.toBeNull();
      expect(result!.created).toBe(true);
      expect(result!.path).toBe(
        join(testDir, ".agents", "skills", "sentry-cli", "SKILL.md")
      );
      expect(existsSync(result!.path)).toBe(true);

      const content = await Bun.file(result!.path).text();
      expect(content).toContain("sentry-cli");

      expect(result!.referenceCount).toBeGreaterThan(0);
      const refsDir = join(
        testDir,
        ".agents",
        "skills",
        "sentry-cli",
        "references"
      );
      expect(existsSync(refsDir)).toBe(true);
      expect(existsSync(join(refsDir, "issue.md"))).toBe(true);

      expect(
        existsSync(join(testDir, ".claude", "skills", "sentry-cli", "SKILL.md"))
      ).toBe(false);
    });

    test("installs to both ~/.agents/ and ~/.claude/ when both roots exist", async () => {
      mkdirSync(join(testDir, ".agents"), { recursive: true });
      mkdirSync(join(testDir, ".claude"), { recursive: true });

      const result = await installAgentSkills(testDir);

      expect(result).not.toBeNull();
      expect(result!.path).toBe(
        join(testDir, ".agents", "skills", "sentry-cli", "SKILL.md")
      );
      expect(
        existsSync(join(testDir, ".agents", "skills", "sentry-cli", "SKILL.md"))
      ).toBe(true);
      expect(
        existsSync(join(testDir, ".claude", "skills", "sentry-cli", "SKILL.md"))
      ).toBe(true);
      expect(
        existsSync(
          join(
            testDir,
            ".agents",
            "skills",
            "sentry-cli",
            "references",
            "issue.md"
          )
        )
      ).toBe(true);
      expect(
        existsSync(
          join(
            testDir,
            ".claude",
            "skills",
            "sentry-cli",
            "references",
            "issue.md"
          )
        )
      ).toBe(true);
    });

    test("reports created: false when updating existing file", async () => {
      mkdirSync(join(testDir, ".agents"), { recursive: true });

      const first = await installAgentSkills(testDir);
      expect(first!.created).toBe(true);

      const second = await installAgentSkills(testDir);
      expect(second!.created).toBe(false);
      expect(second!.path).toBe(first!.path);
    });

    test("reports the fresh claude path when shared skills already exist", async () => {
      mkdirSync(join(testDir, ".agents"), { recursive: true });

      const first = await installAgentSkills(testDir);
      expect(first!.created).toBe(true);
      expect(first!.path).toBe(
        join(testDir, ".agents", "skills", "sentry-cli", "SKILL.md")
      );

      mkdirSync(join(testDir, ".claude"), { recursive: true });

      const second = await installAgentSkills(testDir);
      expect(second).not.toBeNull();
      expect(second!.created).toBe(true);
      expect(second!.path).toBe(
        join(testDir, ".claude", "skills", "sentry-cli", "SKILL.md")
      );
    });

    test("claude install succeeds even if ~/.agents is not writable", async () => {
      mkdirSync(join(testDir, ".agents"), { recursive: true });
      chmodSync(join(testDir, ".agents"), 0o444);
      mkdirSync(join(testDir, ".claude"), { recursive: true });

      const result = await installAgentSkills(testDir);
      expect(result).not.toBeNull();
      expect(result!.path).toBe(
        join(testDir, ".claude", "skills", "sentry-cli", "SKILL.md")
      );
      expect(existsSync(result!.path)).toBe(true);
      expect(
        existsSync(join(testDir, ".agents", "skills", "sentry-cli", "SKILL.md"))
      ).toBe(false);
    });

    test("agents install succeeds even if ~/.claude is not writable", async () => {
      mkdirSync(join(testDir, ".agents"), { recursive: true });
      mkdirSync(join(testDir, ".claude"), { recursive: true });
      chmodSync(join(testDir, ".claude"), 0o444);

      const result = await installAgentSkills(testDir);
      expect(result).not.toBeNull();
      expect(result!.path).toBe(
        join(testDir, ".agents", "skills", "sentry-cli", "SKILL.md")
      );
      expect(existsSync(result!.path)).toBe(true);
      expect(
        existsSync(join(testDir, ".claude", "skills", "sentry-cli", "SKILL.md"))
      ).toBe(false);
    });

    test("returns null when all detected targets are not writable", async () => {
      mkdirSync(join(testDir, ".agents"), { recursive: true });
      mkdirSync(join(testDir, ".claude"), { recursive: true });
      chmodSync(join(testDir, ".agents"), 0o444);
      chmodSync(join(testDir, ".claude"), 0o444);

      const result = await installAgentSkills(testDir);
      expect(result).toBeNull();
    });
  });
});
