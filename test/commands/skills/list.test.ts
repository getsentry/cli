/**
 * Skills List Command Tests
 */

import { describe, expect, test } from "bun:test";
import { fetchAvailableSkills } from "../../../src/commands/skills/list.js";

describe("fetchAvailableSkills", () => {
  test("returns skill info with name and description", async () => {
    // This test makes actual network requests to GitHub API
    // In a real test suite, you'd mock fetch, but for integration testing
    // we verify the actual API works
    const skills = await fetchAvailableSkills();

    expect(Array.isArray(skills)).toBe(true);
    expect(skills.length).toBeGreaterThan(0);

    // Check structure of first skill
    const firstSkill = skills[0];
    expect(firstSkill).toHaveProperty("name");
    expect(firstSkill).toHaveProperty("description");
    expect(typeof firstSkill.name).toBe("string");
    expect(typeof firstSkill.description).toBe("string");
    expect(firstSkill.name.length).toBeGreaterThan(0);
  });

  test("skills are sorted alphabetically", async () => {
    const skills = await fetchAvailableSkills();

    const names = skills.map((s) => s.name);
    const sortedNames = [...names].sort((a, b) => a.localeCompare(b));

    expect(names).toEqual(sortedNames);
  });

  test("contains expected well-known skills", async () => {
    const skills = await fetchAvailableSkills();
    const names = skills.map((s) => s.name);

    // These skills should exist in getsentry/skills
    expect(names).toContain("commit");
    expect(names).toContain("code-review");
  });
});

describe("parseDescriptionFromFrontmatter", () => {
  // Test the parsing logic by checking actual fetched skills
  test("descriptions are properly extracted", async () => {
    const skills = await fetchAvailableSkills();

    // Find a known skill and verify description is meaningful
    const commitSkill = skills.find((s) => s.name === "commit");
    expect(commitSkill).toBeDefined();
    expect(commitSkill?.description).not.toBe("No description available");
    expect(commitSkill?.description.length).toBeGreaterThan(10);
  });
});
