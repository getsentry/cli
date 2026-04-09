import { afterEach, describe, expect, test } from "bun:test";

import {
  detectAgent,
  detectAgentFromProcessTree,
  ENV_VAR_AGENTS,
  getProcessInfoFromOS,
  PROCESS_NAME_AGENTS,
  setProcessInfoProvider,
} from "../../src/lib/detect-agent.js";
import { setEnv } from "../../src/lib/env.js";

function withEnv(vars: Record<string, string>) {
  setEnv(vars as NodeJS.ProcessEnv);
}

/** No-op provider typed to satisfy ProcessInfoProvider. */
function noProcessInfo(_pid: number): undefined {
  return;
}

/** Disable process tree detection so env-var tests are isolated. */
function withNoProcessTree() {
  setProcessInfoProvider(noProcessInfo);
}

describe("detectAgent", () => {
  afterEach(() => {
    setEnv(process.env);
    setProcessInfoProvider(getProcessInfoFromOS);
  });

  // ── AI_AGENT override ──────────────────────────────────────────────

  test("AI_AGENT takes highest priority", () => {
    withEnv({ AI_AGENT: "custom-agent", CLAUDE_CODE: "1", CI: "true" });
    expect(detectAgent()).toBe("custom-agent");
  });

  test("AI_AGENT empty string is ignored", () => {
    withNoProcessTree();
    withEnv({ AI_AGENT: "" });
    expect(detectAgent()).toBeUndefined();
  });

  test("AI_AGENT whitespace-only is ignored", () => {
    withNoProcessTree();
    withEnv({ AI_AGENT: "   " });
    expect(detectAgent()).toBeUndefined();
  });

  test("AI_AGENT is trimmed", () => {
    withEnv({ AI_AGENT: "  my-agent  " });
    expect(detectAgent()).toBe("my-agent");
  });

  // ── Cursor ─────────────────────────────────────────────────────────

  test("CURSOR_TRACE_ID → cursor", () => {
    withEnv({ CURSOR_TRACE_ID: "abc123" });
    expect(detectAgent()).toBe("cursor");
  });

  test("CURSOR_AGENT → cursor", () => {
    withEnv({ CURSOR_AGENT: "1" });
    expect(detectAgent()).toBe("cursor");
  });

  test("CURSOR_TRACE_ID takes priority over CURSOR_AGENT", () => {
    withEnv({ CURSOR_TRACE_ID: "abc", CURSOR_AGENT: "1" });
    expect(detectAgent()).toBe("cursor");
  });

  // ── Gemini ─────────────────────────────────────────────────────────

  test("GEMINI_CLI → gemini", () => {
    withEnv({ GEMINI_CLI: "1" });
    expect(detectAgent()).toBe("gemini");
  });

  // ── Codex ──────────────────────────────────────────────────────────

  test("CODEX_SANDBOX → codex", () => {
    withEnv({ CODEX_SANDBOX: "1" });
    expect(detectAgent()).toBe("codex");
  });

  test("CODEX_CI → codex", () => {
    withEnv({ CODEX_CI: "1" });
    expect(detectAgent()).toBe("codex");
  });

  test("CODEX_THREAD_ID → codex", () => {
    withEnv({ CODEX_THREAD_ID: "thread-123" });
    expect(detectAgent()).toBe("codex");
  });

  // ── Antigravity ────────────────────────────────────────────────────

  test("ANTIGRAVITY_AGENT → antigravity", () => {
    withEnv({ ANTIGRAVITY_AGENT: "1" });
    expect(detectAgent()).toBe("antigravity");
  });

  // ── Augment ────────────────────────────────────────────────────────

  test("AUGMENT_AGENT → augment", () => {
    withEnv({ AUGMENT_AGENT: "1" });
    expect(detectAgent()).toBe("augment");
  });

  // ── OpenCode ───────────────────────────────────────────────────────

  test("OPENCODE_CLIENT → opencode", () => {
    withEnv({ OPENCODE_CLIENT: "1" });
    expect(detectAgent()).toBe("opencode");
  });

  // ── Claude Code ────────────────────────────────────────────────────

  test("CLAUDE_CODE → claude", () => {
    withEnv({ CLAUDE_CODE: "1" });
    expect(detectAgent()).toBe("claude");
  });

  test("CLAUDECODE → claude", () => {
    withEnv({ CLAUDECODE: "1" });
    expect(detectAgent()).toBe("claude");
  });

  test("CLAUDE_CODE + CLAUDE_CODE_IS_COWORK → cowork", () => {
    withEnv({ CLAUDE_CODE: "1", CLAUDE_CODE_IS_COWORK: "1" });
    expect(detectAgent()).toBe("cowork");
  });

  test("CLAUDECODE + CLAUDE_CODE_IS_COWORK → cowork", () => {
    withEnv({ CLAUDECODE: "1", CLAUDE_CODE_IS_COWORK: "1" });
    expect(detectAgent()).toBe("cowork");
  });

  // ── Replit ─────────────────────────────────────────────────────────

  test("REPL_ID alone does not trigger detection (platform env, not agent signal)", () => {
    withNoProcessTree();
    withEnv({ REPL_ID: "abc123" });
    expect(detectAgent()).toBeUndefined();
  });

  // ── GitHub Copilot ─────────────────────────────────────────────────

  test("COPILOT_MODEL → github-copilot", () => {
    withEnv({ COPILOT_MODEL: "gpt-4" });
    expect(detectAgent()).toBe("github-copilot");
  });

  test("COPILOT_ALLOW_ALL → github-copilot", () => {
    withEnv({ COPILOT_ALLOW_ALL: "1" });
    expect(detectAgent()).toBe("github-copilot");
  });

  test("COPILOT_GITHUB_TOKEN alone does not trigger detection (false positive risk)", () => {
    withNoProcessTree();
    withEnv({ COPILOT_GITHUB_TOKEN: "ghu_xxx" });
    expect(detectAgent()).toBeUndefined();
  });

  // ── Goose ──────────────────────────────────────────────────────────

  test("GOOSE_TERMINAL → goose", () => {
    withEnv({ GOOSE_TERMINAL: "1" });
    expect(detectAgent()).toBe("goose");
  });

  // ── Amp ────────────────────────────────────────────────────────────

  test("AMP_THREAD_ID → amp", () => {
    withEnv({ AMP_THREAD_ID: "thread-456" });
    expect(detectAgent()).toBe("amp");
  });

  // ── AGENT generic fallback ─────────────────────────────────────────

  test("AGENT as generic fallback", () => {
    withNoProcessTree();
    withEnv({ AGENT: "some-new-agent" });
    expect(detectAgent()).toBe("some-new-agent");
  });

  test("AGENT is trimmed", () => {
    withNoProcessTree();
    withEnv({ AGENT: "  goose  " });
    expect(detectAgent()).toBe("goose");
  });

  test("AGENT empty string is ignored", () => {
    withNoProcessTree();
    withEnv({ AGENT: "" });
    expect(detectAgent()).toBeUndefined();
  });

  test("specific env vars take priority over AGENT", () => {
    withEnv({ AGENT: "goose", CLAUDE_CODE: "1" });
    expect(detectAgent()).toBe("claude");
  });

  // ── No agent ───────────────────────────────────────────────────────

  test("no env vars → undefined (with process tree disabled)", () => {
    withNoProcessTree();
    withEnv({});
    expect(detectAgent()).toBeUndefined();
  });

  // ── Process tree integration ───────────────────────────────────────

  test("process tree detection fires between env vars and AGENT fallback", () => {
    setProcessInfoProvider((pid) => {
      if (pid === process.ppid) {
        return { name: "cursor", ppid: 1 };
      }
    });
    withEnv({});
    expect(detectAgent()).toBe("cursor");
  });

  test("env vars take priority over process tree", () => {
    setProcessInfoProvider((pid) => {
      if (pid === process.ppid) {
        return { name: "cursor", ppid: 1 };
      }
    });
    withEnv({ GEMINI_CLI: "1" });
    expect(detectAgent()).toBe("gemini");
  });

  test("AI_AGENT takes priority over process tree", () => {
    setProcessInfoProvider((pid) => {
      if (pid === process.ppid) {
        return { name: "cursor", ppid: 1 };
      }
    });
    withEnv({ AI_AGENT: "custom" });
    expect(detectAgent()).toBe("custom");
  });
});

describe("ENV_VAR_AGENTS map structure", () => {
  test("is a Map instance", () => {
    expect(ENV_VAR_AGENTS).toBeInstanceOf(Map);
  });

  test("all values are non-empty strings", () => {
    for (const [envVar, agent] of ENV_VAR_AGENTS) {
      expect(envVar.length).toBeGreaterThan(0);
      expect(agent.length).toBeGreaterThan(0);
    }
  });

  test("env var keys are UPPER_SNAKE_CASE", () => {
    for (const envVar of ENV_VAR_AGENTS.keys()) {
      expect(envVar).toMatch(/^[A-Z][A-Z0-9_]*$/);
    }
  });

  test("agent names are lowercase with optional hyphens", () => {
    for (const agent of ENV_VAR_AGENTS.values()) {
      expect(agent).toMatch(/^[a-z][a-z0-9-]*$/);
    }
  });
});

describe("PROCESS_NAME_AGENTS map structure", () => {
  test("is a Map instance", () => {
    expect(PROCESS_NAME_AGENTS).toBeInstanceOf(Map);
  });

  test("all keys are lowercase", () => {
    for (const name of PROCESS_NAME_AGENTS.keys()) {
      expect(name).toBe(name.toLowerCase());
    }
  });

  test("agent names are lowercase with optional hyphens", () => {
    for (const agent of PROCESS_NAME_AGENTS.values()) {
      expect(agent).toMatch(/^[a-z][a-z0-9-]*$/);
    }
  });
});

describe("detectAgentFromProcessTree", () => {
  afterEach(() => {
    setProcessInfoProvider(getProcessInfoFromOS);
  });

  test("returns agent when parent matches", () => {
    setProcessInfoProvider((pid) => {
      if (pid === process.ppid) {
        return { name: "cursor", ppid: 1 };
      }
    });
    expect(detectAgentFromProcessTree()).toBe("cursor");
  });

  test("walks up to grandparent", () => {
    const shellPid = 100;
    setProcessInfoProvider((pid) => {
      // parent is bash, grandparent is cursor
      if (pid === process.ppid) {
        return { name: "bash", ppid: shellPid };
      }
      if (pid === shellPid) {
        return { name: "Cursor", ppid: 1 };
      }
    });
    expect(detectAgentFromProcessTree()).toBe("cursor");
  });

  test("case-insensitive matching", () => {
    setProcessInfoProvider((pid) => {
      if (pid === process.ppid) {
        return { name: "Claude", ppid: 1 };
      }
    });
    expect(detectAgentFromProcessTree()).toBe("claude");
  });

  test("returns undefined when no agent in tree", () => {
    setProcessInfoProvider((pid) => {
      if (pid === process.ppid) {
        return { name: "bash", ppid: 1 };
      }
    });
    expect(detectAgentFromProcessTree()).toBeUndefined();
  });

  test("stops at PID 1 (init/launchd)", () => {
    setProcessInfoProvider((pid) => {
      if (pid === process.ppid) {
        return { name: "bash", ppid: 1 };
      }
      // PID 1 should not be checked
      if (pid === 1) {
        return { name: "cursor", ppid: 0 };
      }
    });
    expect(detectAgentFromProcessTree()).toBeUndefined();
  });

  test("stops when getProcessInfo returns undefined", () => {
    setProcessInfoProvider(noProcessInfo);
    expect(detectAgentFromProcessTree()).toBeUndefined();
  });

  test("respects max depth", () => {
    // Create a chain deeper than MAX_ANCESTOR_DEPTH (5)
    let nextPid = process.ppid;
    const chain = new Map<number, { name: string; ppid: number }>();
    for (let i = 0; i < 10; i++) {
      const ppid = nextPid + 1;
      chain.set(nextPid, { name: "bash", ppid });
      nextPid = ppid;
    }
    // Put cursor at depth 8 (beyond the limit)
    chain.set(nextPid, { name: "cursor", ppid: 1 });

    setProcessInfoProvider((pid) => chain.get(pid));
    expect(detectAgentFromProcessTree()).toBeUndefined();
  });
});

describe("getProcessInfoFromOS", () => {
  test("returns info for own process", () => {
    const info = getProcessInfoFromOS(process.pid);
    expect(info).toBeDefined();
    if (info) {
      expect(info.name.length).toBeGreaterThan(0);
      expect(info.ppid).toBeGreaterThan(0);
    }
  });

  test("returns info for parent process", () => {
    const info = getProcessInfoFromOS(process.ppid);
    expect(info).toBeDefined();
    if (info) {
      expect(info.name.length).toBeGreaterThan(0);
      expect(info.ppid).toBeGreaterThanOrEqual(0);
    }
  });

  test("returns undefined for non-existent PID", () => {
    const info = getProcessInfoFromOS(99_999_999);
    expect(info).toBeUndefined();
  });

  test("returns undefined for PID 0", () => {
    const info = getProcessInfoFromOS(0);
    expect(info).toBeUndefined();
  });
});
