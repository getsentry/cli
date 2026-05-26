/**
 * Post-init verification: run the dev server and check for SDK events.
 *
 * Uses a two-signal approach:
 * 1. **Stdout-based**: Pipe the child's stdout/stderr and watch for output.
 *    If the process produces output without fatal error patterns, the app
 *    started successfully.
 * 2. **Envelope-based**: A Spotlight sidecar receives SDK envelopes. If one
 *    arrives, the SDK is confirmed working (strongest signal).
 *
 * Either signal resolving first counts as success. A non-zero exit code
 * or fatal error patterns in stderr indicate failure.
 */

import { type ChildProcess, spawn } from "node:child_process";
import { resolve } from "node:path";
import { captureException } from "@sentry/node-core/light";
import { createSpotlightBuffer } from "@spotlightjs/spotlight/sdk";
import { BUFFER_SIZE, shutdownServer } from "../../commands/local/run.js";
import { buildApp, tryListen } from "../../commands/local/server.js";
import { detectDevCommand } from "../dev-script.js";
import { logger } from "../logger.js";
import type { WorkflowRunResult } from "./types.js";
import type { WizardUI } from "./ui/types.js";

/** Verification timeout in seconds. */
const VERIFY_TIMEOUT_S = 15;

/**
 * Patterns in stderr/stdout that indicate a fatal startup failure.
 * Matched case-insensitively against each collected output line.
 */
const FATAL_ERROR_PATTERNS = [
  /\bERR_MODULE_NOT_FOUND\b/,
  /\bMODULE_NOT_FOUND\b/,
  /\bCannot find module\b/i,
  /\bEADDRINUSE\b/,
  /\bSyntaxError\b/,
  /\bReferenceError\b/,
  /\bTypeError\b/,
  /\bError \[ERR_/,
  /\bFATAL ERROR\b/i,
  /\bUnhandledPromiseRejection\b/,
  /\bERR_PNPM_/,
];

/** Maximum number of output lines to keep for error reporting. */
const MAX_OUTPUT_LINES = 50;

/** Absolute-path pattern — scrub user-specific directory paths from telemetry. */
const ABS_PATH_RE = /(?:\/[\w.@-]+){2,}/g;

/** Env-var assignment pattern for redaction. */
const ENV_VAR_RE = /[A-Za-z_]\w*=\S+/g;

/** Strip absolute paths and env-var values from a dev-server output line. */
function scrubOutputLine(line: string): string {
  return line
    .replace(ENV_VAR_RE, (m) => `${m.split("=")[0]}=[REDACTED]`)
    .replace(ABS_PATH_RE, "[PATH]");
}

/** Newline splitter — hoisted to top level per lint rule. */
const NEWLINE_RE = /\r?\n/;

/**
 * Outcome of the stdout-based startup check.
 *
 * - `started`: The child produced output without fatal error patterns.
 * - `errored`: A fatal error pattern was detected in the output.
 * - `silent`:  No output was produced before the timeout.
 */
type StartupOutcome =
  | { kind: "started" }
  | { kind: "errored"; errorLine: string }
  | { kind: "silent" };

/** Check a single line against all fatal error patterns. */
function findFatalError(line: string): boolean {
  return FATAL_ERROR_PATTERNS.some((p) => p.test(line));
}

/** Scan collected lines for fatal errors, returning the first match. */
function scanLinesForError(
  lines: readonly string[]
): StartupOutcome & { kind: "errored" | "started" } {
  for (const line of lines) {
    if (findFatalError(line)) {
      return { kind: "errored", errorLine: line };
    }
  }
  return { kind: "started" };
}

/**
 * Collect lines from a child process's piped stdout and stderr.
 * Returns a promise that resolves when either:
 * - A fatal error pattern is detected (errored)
 * - At least one non-empty line arrives without errors after the timeout (started)
 * - The timeout expires with no output (silent)
 */
function watchChildOutput(
  child: ChildProcess,
  timeoutMs: number
): { promise: Promise<StartupOutcome>; getLines: () => string[] } {
  const lines: string[] = [];
  let hasOutput = false;
  let settled = false;

  let settle: (outcome: StartupOutcome) => void;
  const promise = new Promise<StartupOutcome>((r) => {
    settle = (outcome) => {
      if (settled) {
        return;
      }
      settled = true;
      r(outcome);
    };
  });

  const processChunk = (raw: Buffer) => {
    if (settled) {
      return;
    }
    const text = raw.toString("utf-8");
    for (const segment of text.split(NEWLINE_RE)) {
      const trimmed = segment.trim();
      if (!trimmed) {
        continue;
      }
      if (lines.length < MAX_OUTPUT_LINES) {
        lines.push(trimmed);
      }
      if (findFatalError(trimmed)) {
        settle({ kind: "errored", errorLine: trimmed });
        return;
      }
      hasOutput = true;
    }
  };

  child.stdout?.on("data", processChunk);
  child.stderr?.on("data", processChunk);

  const timer = setTimeout(() => {
    settle(hasOutput ? { kind: "started" } : { kind: "silent" });
  }, timeoutMs);

  child.on("close", () => {
    clearTimeout(timer);
    if (hasOutput) {
      settle(scanLinesForError(lines));
    } else {
      settle({ kind: "silent" });
    }
  });

  return { promise, getLines: () => lines };
}

/** Build the child process environment for verification. */
function buildVerifyEnv(
  spotlightUrl: string,
  detected: { source: string },
  cwd: string
): Record<string, string | undefined> {
  let env: Record<string, string | undefined> = {
    ...process.env,
    SENTRY_SPOTLIGHT: spotlightUrl,
    NEXT_PUBLIC_SENTRY_SPOTLIGHT: spotlightUrl,
    SENTRY_TRACES_SAMPLE_RATE: process.env.SENTRY_TRACES_SAMPLE_RATE ?? "1",
    SENTRY_RELEASE: "sentry-cli-verify",
  };
  if (detected.source.startsWith("package.json")) {
    const binDir = resolve(cwd, "node_modules", ".bin");
    const sep = process.platform === "win32" ? ";" : ":";
    env = {
      ...env,
      PATH: env.PATH ? `${binDir}${sep}${env.PATH}` : binDir,
    };
  }
  return env;
}

/** Gracefully kill a child process with SIGTERM → grace period → SIGKILL. */
async function cleanupChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) {
    return;
  }
  try {
    child.kill("SIGTERM");
    let graceTimer: ReturnType<typeof setTimeout> | undefined;
    const exited = await Promise.race([
      new Promise<true>((r) => child.on("close", () => r(true))),
      new Promise<false>((r) => {
        graceTimer = setTimeout(() => r(false), 5000);
      }),
    ]);
    clearTimeout(graceTimer);
    if (!exited && child.exitCode === null) {
      try {
        child.kill("SIGKILL");
      } catch {
        logger.debug("Child exited before SIGKILL");
      }
    }
  } catch (error) {
    logger.debug("Failed to kill verification child", error);
  }
}

/**
 * Run the dev server, spawn the child process, and verify that the Sentry
 * SDK is working or at minimum that the app starts without errors.
 *
 * Called before `formatResult` in the wizard success path. On failure this
 * logs a warning and reports to Sentry telemetry — it does NOT throw, since
 * the init itself succeeded and the user should not be blocked.
 */
export async function verifySetup(
  result: WorkflowRunResult,
  ui: WizardUI,
  cwd: string
): Promise<void> {
  const detected = await detectDevCommand(cwd);
  if (!detected) {
    ui.log.info("Skipping verification — could not detect a dev command");
    captureException(new Error("init verification skipped"), {
      tags: {
        "wizard.platform": String(result.result?.platform ?? "unknown"),
        "wizard.verify": "no_dev_command",
      },
    });
    return;
  }

  logger.debug(`Verification command: ${detected.args.join(" ")}`);

  const buffer = createSpotlightBuffer(BUFFER_SIZE);
  const app = buildApp(buffer);

  let server: Awaited<ReturnType<typeof tryListen>>["server"];
  let boundPort: number;
  try {
    const listenResult = await tryListen(app, 0, "localhost");
    server = listenResult.server;
    boundPort = listenResult.port;
  } catch (error) {
    logger.debug("Failed to start verification server", error);
    ui.log.warn("Skipping verification — could not start local server.");
    return;
  }

  const spotlightUrl = `http://localhost:${boundPort}/stream`;
  let subscriptionId: string | undefined;
  const envelopeReceived = new Promise<void>((r) => {
    subscriptionId = buffer.subscribe(() => r());
  });
  const childEnv = buildVerifyEnv(spotlightUrl, detected, cwd);

  let child: ChildProcess;
  try {
    const [cmd = "", ...cmdArgs] = detected.args;
    child = spawn(cmd, cmdArgs, {
      cwd,
      env: childEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    logger.debug("Failed to spawn verification child", error);
    await shutdownServer(server);
    ui.log.warn("Skipping verification — could not start the dev command.");
    return;
  }

  const safeKill = (sig: NodeJS.Signals) => {
    try {
      child.kill(sig);
    } catch {
      logger.debug(`Child already exited when forwarding ${sig}`);
    }
  };
  const onSigint = () => safeKill("SIGINT");
  const onSigterm = () => safeKill("SIGTERM");
  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);

  const { promise: startupPromise, getLines } = watchChildOutput(
    child,
    VERIFY_TIMEOUT_S * 1000
  );
  const childExited = new Promise<{ kind: "exited"; code: number }>((r) => {
    child.on("close", (code) =>
      r({ kind: "exited" as const, code: code ?? 1 })
    );
  });

  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const outcome = await Promise.race([
    envelopeReceived.then(() => ({ kind: "envelope" as const })),
    startupPromise,
    childExited,
    new Promise<{ kind: "timeout" }>((r) => {
      timeoutHandle = setTimeout(
        () => r({ kind: "timeout" as const }),
        VERIFY_TIMEOUT_S * 1000
      );
    }),
  ]);

  if (timeoutHandle !== undefined) {
    clearTimeout(timeoutHandle);
  }

  await cleanupChild(child);
  if (subscriptionId) {
    buffer.unsubscribe(subscriptionId);
  }
  process.removeListener("SIGINT", onSigint);
  process.removeListener("SIGTERM", onSigterm);
  await shutdownServer(server);

  reportOutcome(outcome, { ui, result, detected, getLines });
}

type VerifyOutcome =
  | { kind: "envelope" }
  | StartupOutcome
  | { kind: "exited"; code: number }
  | { kind: "timeout" };

type ReportContext = {
  ui: WizardUI;
  result: WorkflowRunResult;
  detected: { args: string[]; source: string };
  getLines: () => string[];
};

/** Report the verification outcome to the user and telemetry. */
// biome-ignore lint/nursery/useMaxParams: existing 4-param shape; cwd is a defaulted extension
function reportOutcome(outcome: VerifyOutcome, ctx: ReportContext): void {
  const { ui, result, detected, getLines } = ctx;
  const telemetryTags = {
    "wizard.platform": String(result.result?.platform ?? "unknown"),
  };
  const telemetryExtra = {
    features: result.result?.features,
    detectedCommand: detected.args
      .join(" ")
      .replace(/[A-Za-z_]\w*=\S+/g, (m) => `${m.split("=")[0]}=[REDACTED]`),
    detectedSource: detected.source,
    outputLines: getLines().length,
  };

  if (outcome.kind === "envelope") {
    ui.log.success("Verified — your app is sending events to Sentry");
    return;
  }

  if (outcome.kind === "started") {
    ui.log.success("Verified — app started successfully");
    return;
  }

  if (outcome.kind === "errored") {
    ui.log.warn(
      `Could not verify — startup error: ${outcome.errorLine.slice(0, 200)}`
    );
    captureException(new Error("init verification: startup error"), {
      tags: { ...telemetryTags, "wizard.verify": "startup_error" },
      extra: {
        ...telemetryExtra,
        errorLine: scrubOutputLine(outcome.errorLine),
      },
    });
    return;
  }

  if (outcome.kind === "exited") {
    if (outcome.code === 0) {
      ui.log.success("Verified — dev server exited cleanly");
      return;
    }
    ui.log.warn(
      `Could not verify — dev server exited with code ${outcome.code}`
    );
    logger.debug(`Last output: ${getLines().slice(-3).join(" | ")}`);
    captureException(new Error("init verification failed"), {
      tags: { ...telemetryTags, "wizard.verify": "child_exited" },
      extra: { ...telemetryExtra, exitCode: outcome.code },
    });
    return;
  }

  const verifyTag = outcome.kind === "silent" ? "silent" : "timeout";
  ui.log.warn(`Could not verify — no output within ${VERIFY_TIMEOUT_S}s`);
  captureException(new Error("init verification failed"), {
    tags: { ...telemetryTags, "wizard.verify": verifyTag },
    extra: telemetryExtra,
  });
}
