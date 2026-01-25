/**
 * Skills Add Command Tests
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("skill validation", () => {
  test("validates that known skills exist", async () => {
    // Import dynamically to test module loading
    const { fetchAvailableSkills } = await import(
      "../../../src/commands/skills/list.js"
    );

    const skills = await fetchAvailableSkills();
    const names = skills.map((s) => s.name);

    // These should be valid skill names
    expect(names).toContain("commit");
    expect(names).toContain("code-review");
    expect(names).toContain("find-bugs");
  });

  test("unknown skill names are detected", async () => {
    const { fetchAvailableSkills } = await import(
      "../../../src/commands/skills/list.js"
    );

    const skills = await fetchAvailableSkills();
    const names = skills.map((s) => s.name);

    // These should NOT be valid skill names
    expect(names).not.toContain("nonexistent-skill-xyz");
    expect(names).not.toContain("fake-skill");
  });
});

describe("local skill installation", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "sentry-skill-test-"));
  });

  afterEach(async () => {
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  test("fetches SKILL.md content from GitHub", async () => {
    const skillName = "commit";
    const url = `https://raw.githubusercontent.com/getsentry/skills/main/plugins/sentry-skills/skills/${skillName}/SKILL.md`;

    const response = await fetch(url);
    expect(response.ok).toBe(true);

    const content = await response.text();

    // Verify SKILL.md structure
    expect(content).toContain("---");
    expect(content).toContain("name:");
    expect(content).toContain("description:");
  });

  test("can create skill directory structure", async () => {
    const skillName = "test-skill";
    const skillDir = join(testDir, skillName);
    const skillPath = join(skillDir, "SKILL.md");

    // Create directory
    const { mkdirSync } = await import("node:fs");
    mkdirSync(skillDir, { recursive: true });

    // Write content
    const content = `---
name: ${skillName}
description: Test skill description
---

# Test Skill

Instructions here.
`;
    await Bun.write(skillPath, content);

    // Verify
    const file = Bun.file(skillPath);
    expect(await file.exists()).toBe(true);

    const written = await file.text();
    expect(written).toContain(`name: ${skillName}`);
    expect(written).toContain("description:");
  });
});

describe("Claude CLI detection", () => {
  test("Bun.which returns null for non-existent command", () => {
    const result = Bun.which("nonexistent-command-xyz-12345");
    expect(result).toBeNull();
  });

  test("Bun.which finds common commands", () => {
    // git should exist on most systems
    const git = Bun.which("git");
    expect(git).not.toBeNull();
  });
});
