/** Tests that the generated SKILL.md steers agents away from manual org/project discovery. */

import { readFile } from "node:fs/promises";
import { describe, expect, test } from "vitest";

const SKILL_PATH = "plugins/sentry-cli/skills/sentry-cli/SKILL.md";

describe("SKILL.md agent steering", () => {
  test("surfaces the core 'just run the command' rule before the Agent Guidance section", async () => {
    const skill = await readFile(SKILL_PATH, "utf8");

    const ruleIndex = skill.indexOf(
      "Core rule for agents: just run the command"
    );
    const guidanceIndex = skill.indexOf("## Agent Guidance");

    expect(ruleIndex).toBeGreaterThan(-1);
    expect(guidanceIndex).toBeGreaterThan(-1);
    // The rule must land before the Agent Guidance section so it steers first.
    expect(ruleIndex).toBeLessThan(guidanceIndex);
  });

  test("explicitly warns against listing orgs then projects to identify the checkout", async () => {
    const skill = await readFile(SKILL_PATH, "utf8");

    expect(skill).toContain("do not");
    expect(skill).toMatch(/list organizations and then list their projects/i);
  });

  test("keeps the auto-detect guidance that names the anti-pattern", async () => {
    const skill = await readFile(SKILL_PATH, "utf8");

    expect(skill).toContain(
      "The CLI auto-detects org/project — don't discover it yourself"
    );
    expect(skill).toContain(
      "Manually discovering the project before running a command"
    );
  });
});
