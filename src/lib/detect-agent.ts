/**
 * AI agent detection — determines whether the CLI is being driven by
 * a specific AI coding agent.
 *
 * Detection is based on environment variables that agents inject into
 * child processes. Adapted from Vercel's @vercel/detect-agent (Apache-2.0).
 *
 * To add a new agent, append an entry to {@link AGENT_ENV_VARS}.
 */

import { getEnv } from "./env.js";

/**
 * Agent detection table. Checked in order — first match wins.
 * Each entry maps one or more env vars to an agent name.
 */
const AGENT_ENV_VARS: ReadonlyArray<{
  envVars: readonly string[];
  agent: string;
}> = [
  { envVars: ["CURSOR_TRACE_ID", "CURSOR_AGENT"], agent: "cursor" },
  { envVars: ["GEMINI_CLI"], agent: "gemini" },
  { envVars: ["CODEX_SANDBOX", "CODEX_CI", "CODEX_THREAD_ID"], agent: "codex" },
  { envVars: ["ANTIGRAVITY_AGENT"], agent: "antigravity" },
  { envVars: ["AUGMENT_AGENT"], agent: "augment" },
  { envVars: ["OPENCODE_CLIENT"], agent: "opencode" },
  { envVars: ["REPL_ID"], agent: "replit" },
  {
    envVars: ["COPILOT_MODEL", "COPILOT_ALLOW_ALL", "COPILOT_GITHUB_TOKEN"],
    agent: "github-copilot",
  },
  { envVars: ["GOOSE_TERMINAL"], agent: "goose" },
  { envVars: ["AMP_THREAD_ID"], agent: "amp" },
];

/**
 * Detect which AI agent (if any) is invoking the CLI.
 *
 * Priority: `AI_AGENT` override > specific agent env vars >
 * Claude Code (with cowork variant) > `AGENT` generic fallback.
 *
 * Returns the agent name string, or `undefined` if no agent is detected.
 */
export function detectAgent(): string | undefined {
  const env = getEnv();

  // Highest priority: generic override — any agent can self-identify
  const aiAgent = env.AI_AGENT?.trim();
  if (aiAgent) {
    return aiAgent;
  }

  // Table-driven check for known agents
  for (const { envVars, agent } of AGENT_ENV_VARS) {
    if (envVars.some((v) => env[v])) {
      return agent;
    }
  }

  // Claude Code / Cowork (needs branching logic, so not in the table)
  if (env.CLAUDECODE || env.CLAUDE_CODE) {
    return env.CLAUDE_CODE_IS_COWORK ? "cowork" : "claude";
  }

  // Lowest priority: generic AGENT fallback (set by Goose, Amp, and others)
  return env.AGENT?.trim() || undefined;
}
