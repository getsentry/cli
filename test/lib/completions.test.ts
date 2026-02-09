import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  extractCommandTree,
  generateBashCompletion,
  generateFishCompletion,
  generateZshCompletion,
  getCompletionPath,
  getCompletionScript,
  installCompletions,
} from "../../src/lib/completions.js";

describe("completions", () => {
  describe("extractCommandTree", () => {
    test("returns groups and standalone commands", () => {
      const tree = extractCommandTree();

      expect(tree.groups.length).toBeGreaterThan(0);
      expect(tree.standalone.length).toBeGreaterThan(0);
    });

    test("includes all known command groups", () => {
      const tree = extractCommandTree();
      const groupNames = tree.groups.map((g) => g.name);

      expect(groupNames).toContain("auth");
      expect(groupNames).toContain("cli");
      expect(groupNames).toContain("org");
      expect(groupNames).toContain("project");
      expect(groupNames).toContain("issue");
      expect(groupNames).toContain("event");
      expect(groupNames).toContain("log");
    });

    test("includes all auth subcommands including token", () => {
      const tree = extractCommandTree();
      const auth = tree.groups.find((g) => g.name === "auth");
      const subNames = auth!.subcommands.map((s) => s.name);

      expect(subNames).toContain("login");
      expect(subNames).toContain("logout");
      expect(subNames).toContain("status");
      expect(subNames).toContain("refresh");
      expect(subNames).toContain("token");
    });

    test("includes log subcommands", () => {
      const tree = extractCommandTree();
      const log = tree.groups.find((g) => g.name === "log");
      const subNames = log!.subcommands.map((s) => s.name);

      expect(subNames).toContain("list");
    });

    test("includes shortcut aliases as standalone commands", () => {
      const tree = extractCommandTree();
      const standaloneNames = tree.standalone.map((s) => s.name);

      expect(standaloneNames).toContain("issues");
      expect(standaloneNames).toContain("orgs");
      expect(standaloneNames).toContain("projects");
      expect(standaloneNames).toContain("logs");
    });

    test("includes api and help as standalone", () => {
      const tree = extractCommandTree();
      const standaloneNames = tree.standalone.map((s) => s.name);

      expect(standaloneNames).toContain("api");
      expect(standaloneNames).toContain("help");
    });

    test("every group has a non-empty brief", () => {
      const tree = extractCommandTree();

      for (const group of tree.groups) {
        expect(group.brief.length).toBeGreaterThan(0);
      }
    });

    test("every subcommand has a non-empty brief", () => {
      const tree = extractCommandTree();

      for (const group of tree.groups) {
        for (const sub of group.subcommands) {
          expect(sub.brief.length).toBeGreaterThan(0);
        }
      }
    });
  });

  describe("generateBashCompletion", () => {
    test("generates valid bash completion script", () => {
      const script = generateBashCompletion("sentry");

      expect(script).toContain("_sentry_completions()");
      expect(script).toContain("complete -F _sentry_completions sentry");
      expect(script).toContain("auth");
      expect(script).toContain("issue");
      expect(script).toContain("cli");
      expect(script).toContain("log");
    });

    test("uses custom binary name", () => {
      const script = generateBashCompletion("my-cli");

      expect(script).toContain("_my-cli_completions()");
      expect(script).toContain("complete -F _my-cli_completions my-cli");
    });

    test("includes all subcommands in case branches", () => {
      const script = generateBashCompletion("sentry");

      // Verify case branches exist for each group
      expect(script).toContain("auth)");
      expect(script).toContain("cli)");
      expect(script).toContain("issue)");
      expect(script).toContain("org)");
      expect(script).toContain("project)");
      expect(script).toContain("event)");
      expect(script).toContain("log)");
    });
  });

  describe("generateZshCompletion", () => {
    test("generates valid zsh completion script", () => {
      const script = generateZshCompletion("sentry");

      expect(script).toContain("#compdef sentry");
      expect(script).toContain("_sentry()");
      expect(script).toContain("'auth:Authenticate with Sentry'");
      expect(script).toContain("'issue:Manage Sentry issues'");
      expect(script).toContain("'log:View Sentry logs'");
    });

    test("includes token subcommand in auth", () => {
      const script = generateZshCompletion("sentry");

      expect(script).toContain("'token:Print the stored authentication token'");
    });
  });

  describe("generateFishCompletion", () => {
    test("generates valid fish completion script", () => {
      const script = generateFishCompletion("sentry");

      expect(script).toContain("complete -c sentry");
      expect(script).toContain('__fish_use_subcommand" -a "auth"');
      expect(script).toContain('__fish_seen_subcommand_from auth" -a "login"');
    });

    test("includes log group and subcommands", () => {
      const script = generateFishCompletion("sentry");

      expect(script).toContain('__fish_use_subcommand" -a "log"');
      expect(script).toContain('__fish_seen_subcommand_from log" -a "list"');
    });

    test("includes aliases as top-level commands", () => {
      const script = generateFishCompletion("sentry");

      expect(script).toContain('__fish_use_subcommand" -a "issues"');
      expect(script).toContain('__fish_use_subcommand" -a "orgs"');
      expect(script).toContain('__fish_use_subcommand" -a "projects"');
      expect(script).toContain('__fish_use_subcommand" -a "logs"');
    });
  });

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
      // Fish uses ~/.config/fish, so we need to create the structure
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
      // Install once
      const first = await installCompletions("bash", testDir);
      expect(first!.created).toBe(true);

      // Install again
      const second = await installCompletions("bash", testDir);
      expect(second!.created).toBe(false);
      expect(second!.path).toBe(first!.path);
    });
  });
});
