/**
 * Property-Based Tests for Shell Completions
 *
 * Verifies invariants of the completion generation system:
 * - Cross-shell consistency (every command appears in all three scripts)
 * - Binary name parametrization
 * - Structural invariants of the command tree
 *
 * Also includes integration tests using Stricli's proposeCompletions API
 * and a real bash simulation of the generated completion script.
 */

import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { proposeCompletions } from "@stricli/core";
import { constantFrom, assert as fcAssert, property } from "fast-check";
import { app } from "../../src/app.js";
import {
  extractCommandTree,
  generateBashCompletion,
  generateFishCompletion,
  generateZshCompletion,
} from "../../src/lib/completions.js";
import { DEFAULT_NUM_RUNS } from "../model-based/helpers.js";

// -- Arbitraries --

/** Generate valid binary names (lowercase alphanumeric + hyphens) */
const binaryNameArb = constantFrom(
  "sentry",
  "my-cli",
  "test-tool",
  "acme",
  "dev-helper",
  "s"
);

// -- Helpers --

/** Minimal context for proposeCompletions */
const completionContext = {
  process: {
    stdout: {
      write: () => true,
    },
    stderr: {
      write: () => true,
    },
    stdin: process.stdin,
  },
  forCommand: () => ({}),
};

// -- Tests --

describe("property: extractCommandTree invariants", () => {
  const tree = extractCommandTree();

  test("every group has at least one subcommand", () => {
    for (const group of tree.groups) {
      expect(group.subcommands.length).toBeGreaterThan(0);
    }
  });

  test("no duplicate group names", () => {
    const names = tree.groups.map((g) => g.name);
    expect(new Set(names).size).toBe(names.length);
  });

  test("no duplicate subcommand names within a group", () => {
    for (const group of tree.groups) {
      const names = group.subcommands.map((s) => s.name);
      expect(new Set(names).size).toBe(names.length);
    }
  });

  test("all names are non-empty strings", () => {
    for (const group of tree.groups) {
      expect(group.name.length).toBeGreaterThan(0);
      expect(group.brief.length).toBeGreaterThan(0);
      for (const sub of group.subcommands) {
        expect(sub.name.length).toBeGreaterThan(0);
        expect(sub.brief.length).toBeGreaterThan(0);
      }
    }
    for (const cmd of tree.standalone) {
      expect(cmd.name.length).toBeGreaterThan(0);
      expect(cmd.brief.length).toBeGreaterThan(0);
    }
  });
});

describe("property: cross-shell consistency", () => {
  const tree = extractCommandTree();

  test("every group name appears in all three shell scripts", () => {
    fcAssert(
      property(binaryNameArb, (name) => {
        const bash = generateBashCompletion(name);
        const zsh = generateZshCompletion(name);
        const fish = generateFishCompletion(name);

        for (const group of tree.groups) {
          expect(bash).toContain(group.name);
          expect(zsh).toContain(group.name);
          expect(fish).toContain(group.name);
        }
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("every subcommand name appears in all three shell scripts", () => {
    fcAssert(
      property(binaryNameArb, (name) => {
        const bash = generateBashCompletion(name);
        const zsh = generateZshCompletion(name);
        const fish = generateFishCompletion(name);

        for (const group of tree.groups) {
          for (const sub of group.subcommands) {
            expect(bash).toContain(sub.name);
            expect(zsh).toContain(sub.name);
            expect(fish).toContain(sub.name);
          }
        }
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("every standalone command appears in all three shell scripts", () => {
    fcAssert(
      property(binaryNameArb, (name) => {
        const bash = generateBashCompletion(name);
        const zsh = generateZshCompletion(name);
        const fish = generateFishCompletion(name);

        for (const cmd of tree.standalone) {
          expect(bash).toContain(cmd.name);
          expect(zsh).toContain(cmd.name);
          expect(fish).toContain(cmd.name);
        }
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });
});

describe("property: binary name parametrization", () => {
  test("generated scripts reference the given binary name", () => {
    fcAssert(
      property(binaryNameArb, (name) => {
        const bash = generateBashCompletion(name);
        const zsh = generateZshCompletion(name);
        const fish = generateFishCompletion(name);

        // Each script should reference the binary name
        expect(bash).toContain(`_${name}_completions`);
        expect(zsh).toContain(`_${name}()`);
        expect(fish).toContain(`complete -c ${name}`);
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });
});

describe("proposeCompletions: Stricli integration", () => {
  const tree = extractCommandTree();

  test("subcommands match extractCommandTree for each group", async () => {
    for (const group of tree.groups) {
      const completions = await proposeCompletions(
        app,
        [group.name, ""],
        completionContext
      );
      const actual = completions.map((c) => c.completion).sort();
      const expected = group.subcommands.map((s) => s.name).sort();
      expect(actual).toEqual(expected);
    }
  });

  test("partial prefix filters subcommands correctly", async () => {
    for (const group of tree.groups) {
      if (group.subcommands.length === 0) {
        continue;
      }
      // Pick the first subcommand's first character as prefix
      const prefix = group.subcommands[0].name[0];
      const completions = await proposeCompletions(
        app,
        [group.name, prefix],
        completionContext
      );

      // Every returned completion should start with the prefix
      for (const c of completions) {
        expect(c.completion.startsWith(prefix)).toBe(true);
      }

      // Every expected subcommand starting with the prefix should be returned
      const expected = group.subcommands
        .filter((s) => s.name.startsWith(prefix))
        .map((s) => s.name)
        .sort();
      const actual = completions.map((c) => c.completion).sort();
      expect(actual).toEqual(expected);
    }
  });
});

describe("bash completion: real shell simulation", () => {
  test("top-level completion returns all known commands", async () => {
    const tree = extractCommandTree();
    const script = generateBashCompletion("sentry");

    const tmpScript = join("/tmp", `completion-test-${Date.now()}.bash`);
    await Bun.write(tmpScript, script);

    const result = Bun.spawnSync({
      cmd: [
        "bash",
        "-c",
        `
# Stub _init_completion (not available outside bash-completion package)
_init_completion() {
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"
  return 0
}
source "${tmpScript}"

COMP_WORDS=(sentry "")
COMP_CWORD=1
_sentry_completions
echo "\${COMPREPLY[*]}"
`,
      ],
    });
    const output = result.stdout.toString().trim();
    const completions = output.split(/\s+/);

    // Verify all groups and standalone commands appear
    for (const group of tree.groups) {
      expect(completions).toContain(group.name);
    }
    for (const cmd of tree.standalone) {
      expect(completions).toContain(cmd.name);
    }
  });

  test("subcommand completion returns correct subcommands", async () => {
    const tree = extractCommandTree();
    const script = generateBashCompletion("sentry");

    const tmpScript = join("/tmp", `completion-test-${Date.now()}.bash`);
    await Bun.write(tmpScript, script);

    // Test a few representative groups
    for (const group of tree.groups) {
      const result = Bun.spawnSync({
        cmd: [
          "bash",
          "-c",
          `
_init_completion() {
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"
  return 0
}
source "${tmpScript}"

COMP_WORDS=(sentry "${group.name}" "")
COMP_CWORD=2
_sentry_completions
echo "\${COMPREPLY[*]}"
`,
        ],
      });
      const output = result.stdout.toString().trim();
      const completions = output.split(/\s+/);

      const expected = group.subcommands.map((s) => s.name).sort();
      expect(completions.sort()).toEqual(expected);
    }
  });
});
