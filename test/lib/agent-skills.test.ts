/**
 * Agent Skills Tests
 *
 * Unit tests for Claude Code detection, version-pinned URL construction,
 * multi-file skill content fetching, and file installation.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  detectClaudeCode,
  fetchSkillContent,
  getSkillInstallPath,
  getSkillUrl,
  installAgentSkills,
} from "../../src/lib/agent-skills.js";

/** Store original fetch for restoration */
let originalFetch: typeof globalThis.fetch;

/** Helper to mock fetch without TypeScript errors about missing Bun-specific properties */
function mockFetch(
  fn: (url: string | URL | Request, init?: RequestInit) => Promise<Response>
): void {
  globalThis.fetch = fn as typeof globalThis.fetch;
}

/** Sample index.json for multi-file tests */
const SAMPLE_INDEX_JSON = JSON.stringify({
  skills: [
    {
      name: "sentry-cli",
      files: ["SKILL.md", "references/auth.md", "references/issue.md"],
    },
  ],
});

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

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

  describe("getSkillUrl", () => {
    test("returns versioned GitHub URL for release versions", () => {
      const url = getSkillUrl("0.8.0");
      expect(url).toBe(
        "https://raw.githubusercontent.com/getsentry/cli/0.8.0/plugins/sentry-cli/skills/sentry-cli"
      );
    });

    test("returns versioned GitHub URL for patch versions", () => {
      const url = getSkillUrl("1.2.3");
      expect(url).toContain("/1.2.3/");
    });

    test("returns fallback URL for dev versions", () => {
      const url = getSkillUrl("0.9.0-dev.0");
      expect(url).toBe(
        "https://cli.sentry.dev/.well-known/skills/sentry-cli"
      );
    });

    test("returns fallback URL for 0.0.0", () => {
      const url = getSkillUrl("0.0.0");
      expect(url).toBe(
        "https://cli.sentry.dev/.well-known/skills/sentry-cli"
      );
    });

    test("returns fallback URL for 0.0.0-dev", () => {
      const url = getSkillUrl("0.0.0-dev");
      expect(url).toBe(
        "https://cli.sentry.dev/.well-known/skills/sentry-cli"
      );
    });
  });

  describe("fetchSkillContent", () => {
    test("returns map with all files on successful fetch", async () => {
      mockFetch(async (url) => {
        const urlStr = typeof url === "string" ? url : url.toString();
        if (urlStr.endsWith("index.json")) {
          return new Response(SAMPLE_INDEX_JSON, { status: 200 });
        }
        if (urlStr.endsWith("SKILL.md")) {
          return new Response("# Index", { status: 200 });
        }
        if (urlStr.endsWith("auth.md")) {
          return new Response("# Auth", { status: 200 });
        }
        if (urlStr.endsWith("issue.md")) {
          return new Response("# Issue", { status: 200 });
        }
        return new Response("Not found", { status: 404 });
      });

      const files = await fetchSkillContent("0.8.0");
      expect(files).not.toBeNull();
      expect(files!.size).toBe(3);
      expect(files!.get("SKILL.md")).toBe("# Index");
      expect(files!.get("references/auth.md")).toBe("# Auth");
      expect(files!.get("references/issue.md")).toBe("# Issue");
    });

    test("falls back to cli.sentry.dev when versioned URL returns 404", async () => {
      const fetchedUrls: string[] = [];
      mockFetch(async (url) => {
        const urlStr = typeof url === "string" ? url : url.toString();
        fetchedUrls.push(urlStr);
        if (urlStr.includes("raw.githubusercontent.com")) {
          return new Response("Not found", { status: 404 });
        }
        if (urlStr.endsWith("index.json")) {
          return new Response(
            JSON.stringify({
              skills: [{ name: "sentry-cli", files: ["SKILL.md"] }],
            }),
            { status: 200 }
          );
        }
        return new Response("# Fallback Content", { status: 200 });
      });

      const files = await fetchSkillContent("99.99.99");
      expect(files).not.toBeNull();
      expect(files!.get("SKILL.md")).toBe("# Fallback Content");
      expect(fetchedUrls.some((u) => u.includes("cli.sentry.dev"))).toBe(true);
    });

    test("does not double-fetch fallback URL for dev versions", async () => {
      const fetchedUrls: string[] = [];
      mockFetch(async (url) => {
        const urlStr = typeof url === "string" ? url : url.toString();
        fetchedUrls.push(urlStr);
        if (urlStr.endsWith("index.json")) {
          return new Response(
            JSON.stringify({
              skills: [{ name: "sentry-cli", files: ["SKILL.md"] }],
            }),
            { status: 200 }
          );
        }
        return new Response("# Dev Content", { status: 200 });
      });

      const files = await fetchSkillContent("0.0.0-dev");
      expect(files).not.toBeNull();
      expect(files!.get("SKILL.md")).toBe("# Dev Content");
      // Should only hit cli.sentry.dev (fallback), never raw.githubusercontent.com
      expect(
        fetchedUrls.every((u) => u.includes("cli.sentry.dev"))
      ).toBe(true);
    });

    test("returns null when all fetches fail", async () => {
      mockFetch(async () => new Response("Error", { status: 500 }));

      const files = await fetchSkillContent("0.8.0");
      expect(files).toBeNull();
    });

    test("returns null on network error", async () => {
      mockFetch(async () => {
        throw new Error("Network error");
      });

      const files = await fetchSkillContent("0.8.0");
      expect(files).toBeNull();
    });

    test("still returns SKILL.md when some reference files fail", async () => {
      mockFetch(async (url) => {
        const urlStr = typeof url === "string" ? url : url.toString();
        if (urlStr.endsWith("index.json")) {
          return new Response(SAMPLE_INDEX_JSON, { status: 200 });
        }
        if (urlStr.endsWith("SKILL.md")) {
          return new Response("# Index", { status: 200 });
        }
        // All reference files fail
        return new Response("Not found", { status: 404 });
      });

      const files = await fetchSkillContent("0.8.0");
      expect(files).not.toBeNull();
      expect(files!.size).toBe(1);
      expect(files!.get("SKILL.md")).toBe("# Index");
    });

    test("falls back to just SKILL.md when index.json is unavailable", async () => {
      mockFetch(async (url) => {
        const urlStr = typeof url === "string" ? url : url.toString();
        if (urlStr.endsWith("index.json")) {
          return new Response("Not found", { status: 404 });
        }
        if (urlStr.endsWith("SKILL.md")) {
          return new Response("# Skill Content", { status: 200 });
        }
        return new Response("Not found", { status: 404 });
      });

      const files = await fetchSkillContent("0.8.0");
      expect(files).not.toBeNull();
      expect(files!.size).toBe(1);
      expect(files!.get("SKILL.md")).toBe("# Skill Content");
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

      mockFetch(async (url) => {
        const urlStr = typeof url === "string" ? url : url.toString();
        if (urlStr.endsWith("index.json")) {
          return new Response(SAMPLE_INDEX_JSON, { status: 200 });
        }
        if (urlStr.endsWith("SKILL.md")) {
          return new Response("# Sentry CLI Skill\nTest content", {
            status: 200,
          });
        }
        if (urlStr.endsWith("auth.md")) {
          return new Response("# Auth Commands\nAuth content", {
            status: 200,
          });
        }
        if (urlStr.endsWith("issue.md")) {
          return new Response("# Issue Commands\nIssue content", {
            status: 200,
          });
        }
        return new Response("Not found", { status: 404 });
      });
    });

    afterEach(() => {
      rmSync(testDir, { recursive: true, force: true });
    });

    test("returns null when Claude Code is not detected", async () => {
      const result = await installAgentSkills(testDir, "0.8.0");
      expect(result).toBeNull();
    });

    test("installs skill files when Claude Code is detected", async () => {
      mkdirSync(join(testDir, ".claude"), { recursive: true });

      const result = await installAgentSkills(testDir, "0.8.0");

      expect(result).not.toBeNull();
      expect(result!.created).toBe(true);
      expect(result!.path).toBe(
        join(testDir, ".claude", "skills", "sentry-cli", "SKILL.md")
      );
      expect(existsSync(result!.path)).toBe(true);

      const content = await Bun.file(result!.path).text();
      expect(content).toContain("# Sentry CLI Skill");
    });

    test("creates references directory and writes reference files", async () => {
      mkdirSync(join(testDir, ".claude"), { recursive: true });

      const result = await installAgentSkills(testDir, "0.8.0");

      expect(result).not.toBeNull();

      // Verify reference files were written
      const refsDir = join(
        testDir,
        ".claude",
        "skills",
        "sentry-cli",
        "references"
      );
      expect(existsSync(refsDir)).toBe(true);

      const authPath = join(refsDir, "auth.md");
      expect(existsSync(authPath)).toBe(true);
      const authContent = await Bun.file(authPath).text();
      expect(authContent).toContain("# Auth Commands");

      const issuePath = join(refsDir, "issue.md");
      expect(existsSync(issuePath)).toBe(true);
      const issueContent = await Bun.file(issuePath).text();
      expect(issueContent).toContain("# Issue Commands");
    });

    test("creates intermediate directories", async () => {
      mkdirSync(join(testDir, ".claude"), { recursive: true });

      const result = await installAgentSkills(testDir, "0.8.0");

      expect(result).not.toBeNull();
      expect(existsSync(result!.path)).toBe(true);
    });

    test("reports created: false when updating existing file", async () => {
      mkdirSync(join(testDir, ".claude"), { recursive: true });

      const first = await installAgentSkills(testDir, "0.8.0");
      expect(first!.created).toBe(true);

      const second = await installAgentSkills(testDir, "0.8.0");
      expect(second!.created).toBe(false);
      expect(second!.path).toBe(first!.path);
    });

    test("returns null on fetch failure without throwing", async () => {
      mkdirSync(join(testDir, ".claude"), { recursive: true });

      mockFetch(async () => {
        throw new Error("Network error");
      });

      const result = await installAgentSkills(testDir, "0.8.0");
      expect(result).toBeNull();
    });

    test("returns null on filesystem error without throwing", async () => {
      // Create .claude as a read-only directory so mkdirSync for the
      // skills subdirectory fails with EACCES
      mkdirSync(join(testDir, ".claude"), { recursive: true, mode: 0o444 });

      const result = await installAgentSkills(testDir, "0.8.0");
      expect(result).toBeNull();

      // Restore write permission so afterEach cleanup can remove it
      chmodSync(join(testDir, ".claude"), 0o755);
    });
  });
});
