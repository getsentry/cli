/**
 * AI agent detection — determines whether the CLI is being driven by
 * a specific AI coding agent.
 *
 * Detection uses two strategies:
 * 1. **Environment variables** (sync) — agents inject these into child
 *    processes. Adapted from Vercel's @vercel/detect-agent (Apache-2.0).
 * 2. **Process tree walking** (async) — scan parent/grandparent process
 *    names for known agent executables. Runs as a non-blocking background
 *    task so it never delays CLI startup.
 *
 * To add a new agent, add entries to {@link ENV_VAR_AGENTS} and/or
 * {@link PROCESS_NAME_AGENTS}.
 */

import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
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
  // Replit — REPL_ID intentionally excluded because it's set in ALL Replit
  // workspaces, not just when the AI agent is driving the CLI
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
 * Async process info provider signature. Default reads from `/proc/` or `ps(1)`.
 * Override via {@link setProcessInfoProvider} for testing.
 */
type ProcessInfoProvider = (pid: number) => Promise<ProcessInfo | undefined>;

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
 * Detect agent from environment variables only (synchronous, no I/O).
 *
 * Priority:
 * 1. `AI_AGENT` env var — explicit override, any agent can self-identify
 * 2. Agent-specific env vars from {@link ENV_VAR_AGENTS}
 * 3. Claude Code with Cowork variant (conditional, can't be in the map)
 * 4. `AGENT` env var — generic fallback set by Goose, Amp, and others
 *
 * Returns the agent name string, or `undefined` if no agent is detected.
 * For process tree fallback, use {@link detectAgentFromProcessTree} separately.
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

  // 4. Lowest priority: generic AGENT fallback
  return env.AGENT?.trim() || undefined;
}

/**
 * Walk the ancestor process tree looking for known agent executables.
 *
 * Fully async — never blocks CLI startup. Starts at the direct parent
 * (`process.ppid`) and walks up to {@link MAX_ANCESTOR_DEPTH} levels.
 * Stops at PID 1 (init/launchd) or on any read error.
 *
 * - **Linux**: reads `/proc/<pid>/status` (in-memory filesystem, fast).
 * - **macOS**: uses `ps(1)` with a 500ms timeout per invocation.
 * - **Windows**: not supported (env var detection still works).
 */
export async function detectAgentFromProcessTree(): Promise<
  string | undefined
> {
  let pid = process.ppid;

  for (let depth = 0; depth < MAX_ANCESTOR_DEPTH && pid > 1; depth++) {
    const info = await _getProcessInfo(pid);
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
 * Windows is unsupported — returns `undefined`.
 */
export async function getProcessInfoFromOS(
  pid: number
): Promise<ProcessInfo | undefined> {
  // Linux: /proc is an in-memory filesystem — fast even though async
  try {
    const status = await readFile(`/proc/${pid}/status`, "utf-8");
    const nameMatch = status.match(PROC_STATUS_NAME_RE);
    const ppidMatch = status.match(PROC_STATUS_PPID_RE);
    if (nameMatch?.[1] && ppidMatch?.[1]) {
      return { name: nameMatch[1].trim(), ppid: Number(ppidMatch[1]) };
    }
  } catch {
    // Not Linux or process is gone — fall through to ps
  }

  // macOS / other Unix: use ps(1) asynchronously
  if (process.platform !== "win32") {
    try {
      const result = await execFileUnreffed(
        "ps",
        ["-p", String(pid), "-o", "ppid=,comm="],
        { timeout: 500 }
      );
      const match = result.trim().match(PS_PPID_COMM_RE);
      if (match?.[1] && match?.[2]) {
        return { name: basename(match[2].trim()), ppid: Number(match[1]) };
      }
    } catch {
      // Process gone, ps not available, or timeout
    }
  }
}

/**
 * Spawn `execFile` with the child process unreffed so it never
 * prevents the CLI from exiting. Resolves with stdout on success.
 */
function execFileUnreffed(
  cmd: string,
  args: readonly string[],
  opts: { timeout?: number }
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      cmd,
      args,
      { encoding: "utf-8", ...opts },
      (err, stdout) => {
        if (err) {
          reject(err);
        } else {
          resolve(stdout);
        }
      }
    );
    child.unref();
  });
}
