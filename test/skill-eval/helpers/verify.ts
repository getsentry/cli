/**
 * Verify planned CLI commands against the real binary.
 *
 * Runs each command's subcommand route with `-h` to check it exists.
 * A valid route returns exit code 0 (Stricli intercepts `-h` before
 * command execution, so no auth/env setup is needed).
 * An unknown route returns exit code 251 (Bun) or -5 (Node).
 */

import { getCliCommand } from "../../fixture.js";
import type { PlannedCommand } from "./types.js";

/** Result of verifying a single planned command against the real CLI binary */
export type CommandVerification = {
  command: string;
  valid: boolean;
  /** First few lines of help output (for valid commands) or error message */
  detail: string;
};

/**
 * Extract the subcommand route from a full CLI command string.
 *
 * Stops at flags (`-*`), paths (`/`), quoted values, or assignments (`=`).
 * E.g., `"sentry issue list --query '...'"` → `["issue", "list"]`
 * E.g., `"sentry api /api/0/..."` → `["api"]`
 */
function extractRoute(command: string): string[] {
  const tokens = command.trim().split(/\s+/);
  const start = tokens[0] === "sentry" ? 1 : 0;

  const route: string[] = [];
  for (let i = start; i < tokens.length; i++) {
    const token = tokens[i];
    if (
      token.startsWith("-") ||
      token.includes("/") ||
      token.includes("=") ||
      token.startsWith('"') ||
      token.startsWith("'")
    ) {
      break;
    }
    route.push(token);
  }
  return route;
}

/**
 * Verify each planned command by running its route with `-h`.
 *
 * Uses `getCliCommand()` which respects `SENTRY_CLI_BINARY` env var
 * (pre-built binary in e2e CI) or falls back to `bun run src/bin.ts`.
 */
export async function verifyPlannedCommands(
  commands: PlannedCommand[]
): Promise<CommandVerification[]> {
  const cliCmd = getCliCommand();
  const results: CommandVerification[] = [];

  for (const { command } of commands) {
    const route = extractRoute(command);
    if (route.length === 0) {
      results.push({
        command,
        valid: false,
        detail: "Could not extract subcommand from command string",
      });
      continue;
    }

    const proc = Bun.spawn([...cliCmd, ...route, "-h"], {
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, SENTRY_CLI_NO_TELEMETRY: "1" },
    });

    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    const exitCode = await proc.exited;

    const valid = exitCode === 0;
    const output = (stdout || stderr).trim();
    // Take first 3 lines as a summary
    const detail = output.split("\n").slice(0, 3).join("\n").trim();

    results.push({ command, valid, detail });
  }

  return results;
}

/** Format verification results as a human-readable string for the judge prompt */
export function formatVerifications(
  verifications: CommandVerification[]
): string {
  return verifications
    .map((v, i) => {
      const icon = v.valid ? "VALID" : "INVALID";
      return `${i + 1}. \`${v.command}\`: ${icon} — ${v.detail}`;
    })
    .join("\n");
}
