import { afterEach, describe, expect, test } from "bun:test";
import { detectAgent } from "../../src/lib/detect-agent.js";
import { setEnv } from "../../src/lib/env.js";

function withEnv(vars: Record<string, string>) {
  setEnv(vars as NodeJS.ProcessEnv);
}

describe("detectAgent", () => {
  afterEach(() => {
    setEnv(process.env);
  });

  // ── AI_AGENT override ──────────────────────────────────────────────

  test("AI_AGENT takes highest priority", () => {
    withEnv({ AI_AGENT: "custom-agent", CLAUDE_CODE: "1", CI: "true" });
    expect(detectAgent()).toBe("custom-agent");
  });

  test("AI_AGENT empty string is ignored", () => {
    withEnv({ AI_AGENT: "" });
    expect(detectAgent()).toBeUndefined();
  });

  test("AI_AGENT whitespace-only is ignored", () => {
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

  test("REPL_ID → replit", () => {
    withEnv({ REPL_ID: "abc123" });
    expect(detectAgent()).toBe("replit");
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

  test("COPILOT_GITHUB_TOKEN → github-copilot", () => {
    withEnv({ COPILOT_GITHUB_TOKEN: "ghu_xxx" });
    expect(detectAgent()).toBe("github-copilot");
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
    withEnv({ AGENT: "some-new-agent" });
    expect(detectAgent()).toBe("some-new-agent");
  });

  test("AGENT is trimmed", () => {
    withEnv({ AGENT: "  goose  " });
    expect(detectAgent()).toBe("goose");
  });

  test("AGENT empty string is ignored", () => {
    withEnv({ AGENT: "" });
    expect(detectAgent()).toBeUndefined();
  });

  test("specific env vars take priority over AGENT", () => {
    withEnv({ AGENT: "goose", CLAUDE_CODE: "1" });
    expect(detectAgent()).toBe("claude");
  });

  // ── No agent ───────────────────────────────────────────────────────

  test("no env vars → undefined", () => {
    withEnv({});
    expect(detectAgent()).toBeUndefined();
  });
});
