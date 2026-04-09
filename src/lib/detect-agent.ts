/**
 * AI agent detection — determines whether the CLI is being driven by
 * a specific AI coding agent.
 *
 * Detection uses two strategies:
 * 1. **Environment variables** that agents inject into child processes
 *    (adapted from Vercel's @vercel/detect-agent, Apache-2.0)
 * 2. **Process tree walking** — scan parent/grandparent process names
 *    for known agent executables (fallback when env vars are absent)
 *
 * To add a new agent, add entries to {@link ENV_VAR_AGENTS} and/or
 * {@link PROCESS_NAME_AGENTS}.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename } from "node:path";

import { getEnv } from "./env.js";

/**
 * Env var → agent name. Checked in insertion order — first match wins.
 * Each env var maps directly to the agent that sets it.
 */
export const ENV_VAR_AGENTS = new Map<string, string>([
  // Cursor
  ["CURSOR_TRACE_ID", "cursor"],
  ["CURSOR_AGENT", "cursor"],
  // Gemini CLI
  ["GEMINI_CLI", "gemini"],
  // OpenAI Codex
  ["CODEX_SANDBOX", "codex"],
  ["CODEX_CI", "codex"],
  ["CODEX_THREAD_ID", "codex"],
  // Antigravity
  ["ANTIGRAVITY_AGENT", "antigravity"],
  // Augment
  ["AUGMENT_AGENT", "augment"],
  // OpenCode
  ["OPENCODE_CLIENT", "opencode"],
  // Replit
  ["REPL_ID", "replit"],
  // GitHub Copilot — COPILOT_GITHUB_TOKEN intentionally excluded because
  // users may export it persistently for auth, causing false positives
  ["COPILOT_MODEL", "github-copilot"],
  ["COPILOT_ALLOW_ALL", "github-copilot"],
  // Goose
  ["GOOSE_TERMINAL", "goose"],
  // Amp
  ["AMP_THREAD_ID", "amp"],
]);

/**
 * Process executable basename (lowercase) → agent name.
 * Used when scanning the parent process tree as a fallback.
 */
export const PROCESS_NAME_AGENTS = new Map<string, string>([
  ["cursor", "cursor"],
  ["claude", "claude"],
  ["goose", "goose"],
  ["windsurf", "windsurf"],
  ["amp", "amp"],
  ["codex", "codex"],
  ["augment", "augment"],
  ["opencode", "opencode"],
  ["gemini", "gemini"],
]);

/** Max levels to walk up the process tree before giving up. */
const MAX_ANCESTOR_DEPTH = 5;

/** Pattern to extract `Name:` from `/proc/<pid>/status`. */
const PROC_STATUS_NAME_RE = /^Name:\s+(.+)$/m;

/** Pattern to extract `PPid:` from `/proc/<pid>/status`. */
const PROC_STATUS_PPID_RE = /^PPid:\s+(\d+)$/m;

/** Pattern to parse `ps -o ppid=,comm=` output: "  <ppid> <comm>". */
const PS_PPID_COMM_RE = /^(\d+)\s+(.+)$/;

/** Name + parent PID of a process. */
type ProcessInfo = {
  /** Basename of the executable (e.g. "cursor", "bash"). */
  name: string;
  /** Parent process ID, or 0 if unavailable. */
  ppid: number;
};

/**
 * Process info provider signature. Default reads from `/proc/` or `ps(1)`.
 * Override via {@link setProcessInfoProvider} for testing.
 */
type ProcessInfoProvider = (pid: number) => ProcessInfo | undefined;

let _getProcessInfo: ProcessInfoProvider = getProcessInfoFromOS;

/**
 * Override the process info provider. Follows the same pattern as
 * {@link setEnv} — call with a mock in tests, reset in `afterEach`.
 *
 * Pass `getProcessInfoFromOS` to restore the real implementation.
 */
export function setProcessInfoProvider(provider: ProcessInfoProvider): void {
  _getProcessInfo = provider;
}

/**
 * Detect which AI agent (if any) is invoking the CLI.
 *
 * Priority:
 * 1. `AI_AGENT` env var — explicit override, any agent can self-identify
 * 2. Agent-specific env vars from {@link ENV_VAR_AGENTS}
 * 3. Claude Code with Cowork variant (conditional, can't be in the map)
 * 4. Parent process tree — walk ancestors looking for known executables
 * 5. `AGENT` env var — generic fallback set by Goose, Amp, and others
 *
 * Returns the agent name string, or `undefined` if no agent is detected.
 */
export function detectAgent(): string | undefined {
  const env = getEnv();

  // 1. Highest priority: explicit override — any agent can self-identify
  const aiAgent = env.AI_AGENT?.trim();
  if (aiAgent) {
    return aiAgent;
  }

  // 2. Table-driven env var check (Map iteration preserves insertion order)
  for (const [envVar, agent] of ENV_VAR_AGENTS) {
    if (env[envVar]) {
      return agent;
    }
  }

  // 3. Claude Code / Cowork — requires branching logic, so not in the map
  if (env.CLAUDECODE || env.CLAUDE_CODE) {
    return env.CLAUDE_CODE_IS_COWORK ? "cowork" : "claude";
  }

  // 4. Process tree: walk parent → grandparent → ... looking for known agents
  const processAgent = detectAgentFromProcessTree();
  if (processAgent) {
    return processAgent;
  }

  // 5. Lowest priority: generic AGENT fallback
  return env.AGENT?.trim() || undefined;
}

/**
 * Walk the ancestor process tree looking for known agent executables.
 *
 * Starts at the direct parent (`process.ppid`) and walks up to
 * {@link MAX_ANCESTOR_DEPTH} levels. Stops at PID 1 (init/launchd)
 * or on any read error (process exited, permission denied).
 *
 * On Linux, reads `/proc/<pid>/status` (in-memory, fast).
 * On macOS, falls back to `ps(1)`.
 */
export function detectAgentFromProcessTree(): string | undefined {
  let pid = process.ppid;

  for (let depth = 0; depth < MAX_ANCESTOR_DEPTH && pid > 1; depth++) {
    const info = _getProcessInfo(pid);
    if (!info) {
      break;
    }

    const agent = PROCESS_NAME_AGENTS.get(info.name.toLowerCase());
    if (agent) {
      return agent;
    }

    pid = info.ppid;
  }

  return;
}

/**
 * Read process name and parent PID for a given PID.
 *
 * Tries `/proc/<pid>/status` first (Linux, no subprocess overhead),
 * falls back to `ps(1)` (macOS and other Unix systems).
 *
 * Returns `undefined` if the process doesn't exist or can't be read.
 */
export function getProcessInfoFromOS(pid: number): ProcessInfo | undefined {
  // Linux: /proc is an in-memory filesystem — no subprocess needed
  try {
    const status = readFileSync(`/proc/${pid}/status`, "utf-8");
    const nameMatch = status.match(PROC_STATUS_NAME_RE);
    const ppidMatch = status.match(PROC_STATUS_PPID_RE);
    if (nameMatch?.[1] && ppidMatch?.[1]) {
      return { name: nameMatch[1].trim(), ppid: Number(ppidMatch[1]) };
    }
  } catch {
    // Not Linux or process is gone — fall through to ps
  }

  // macOS / other Unix: use ps(1)
  if (process.platform !== "win32") {
    try {
      const result = execFileSync(
        "ps",
        ["-p", String(pid), "-o", "ppid=,comm="],
        {
          encoding: "utf-8",
          stdio: ["pipe", "pipe", "ignore"],
        }
      );
      // Output: "  1234 /Applications/Cursor.app/Contents/MacOS/Cursor"
      const match = result.trim().match(PS_PPID_COMM_RE);
      if (match?.[1] && match?.[2]) {
        return { name: basename(match[2].trim()), ppid: Number(match[1]) };
      }
    } catch {
      // Process gone or ps not available
    }
  }
}
