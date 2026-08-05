/**
 * Doctor-based post-init verification for embedded frameworks (Flutter, Expo).
 *
 * Runs `flutter doctor` or `npx expo doctor`, surfaces a short status to the
 * user, and reports failures to Sentry telemetry the same way Spotlight-based
 * verification does — without blocking the successful init.
 */

import { type ChildProcess, spawn } from "node:child_process";
import { resolve } from "node:path";
import { captureException } from "@sentry/node-core/light";
import { logger } from "../logger.js";
import { whichSync } from "../which.js";
import type { WorkflowRunResult } from "./types.js";
import type { WizardUI } from "./ui/types.js";
import type {
  ExpoDoctorStrategy,
  FlutterDoctorStrategy,
} from "./verify-strategy.js";

/** Doctor commands can take longer than a local Spotlight probe. */
const DOCTOR_TIMEOUT_S = 60;

/** Maximum output lines retained for telemetry. */
const MAX_OUTPUT_LINES = 50;

/** Absolute-path pattern — scrub user-specific directory paths from telemetry. */
const ABS_PATH_RE = /(?:\/[\w.@-]+){2,}/g;

/** Key=value pattern for redaction (env vars and --flag=value args). */
const KEY_VALUE_RE = /(?:--?)?[A-Za-z_][\w-]*=\S+/g;

/** URI userinfo (user:password@ or :password@) pattern for redaction. */
const URI_USERINFO_RE = /\/\/[^@/\s]*:[^@/\s]+@/g;

/** Newline splitter — hoisted to top level per lint rule. */
const NEWLINE_RE = /\r?\n/;

export type DoctorStrategy = FlutterDoctorStrategy | ExpoDoctorStrategy;

/** Strip absolute paths, env-var values, and URI credentials from output. */
export function scrubOutputLine(line: string): string {
  return line
    .replace(URI_USERINFO_RE, "//[REDACTED]@")
    .replace(KEY_VALUE_RE, (m) => `${m.split("=")[0]}=[REDACTED]`)
    .replace(ABS_PATH_RE, "[PATH]");
}

/**
 * Run the platform doctor command and report the outcome.
 *
 * Never throws for doctor failures — init already succeeded.
 */
export async function verifyWithDoctor(
  strategy: DoctorStrategy,
  result: WorkflowRunResult,
  ui: WizardUI,
  cwd: string
): Promise<void> {
  const [cmd = "", ...cmdArgs] = strategy.args;
  if (!cmd) {
    ui.log.info("Skipping verification — doctor command was empty");
    return;
  }

  if (strategy.tool === "flutter" && !whichSync("flutter")) {
    ui.log.info("Skipping verification — flutter is not on PATH");
    captureException(new Error("init verification skipped"), {
      tags: {
        "wizard.platform": String(result.result?.platform ?? "unknown"),
        "wizard.verify": "no_flutter",
      },
      extra: { source: strategy.source },
    });
    return;
  }

  if (strategy.tool === "expo" && !whichSync(cmd)) {
    ui.log.info("Skipping verification — npx is not on PATH");
    captureException(new Error("init verification skipped"), {
      tags: {
        "wizard.platform": String(result.result?.platform ?? "unknown"),
        "wizard.verify": "no_npx",
      },
      extra: { source: strategy.source },
    });
    return;
  }

  const label = strategy.tool === "flutter" ? "flutter doctor" : "expo doctor";
  logger.debug(
    `Verification command: ${strategy.args.join(" ")} (${strategy.source})`
  );

  const childEnv = buildDoctorEnv(strategy, cwd);
  let child: ChildProcess;
  try {
    child = spawn(cmd, cmdArgs, {
      cwd,
      detached: process.platform !== "win32",
      env: childEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    logger.debug(`Failed to spawn ${label}`, error);
    ui.log.warn(`Skipping verification — could not start ${label}.`);
    return;
  }

  const { lines, exitCode, timedOut, signalReceived } = await waitForDoctor(
    child,
    DOCTOR_TIMEOUT_S * 1000
  );

  if (signalReceived) {
    process.kill(process.pid, signalReceived);
    return;
  }

  reportDoctorOutcome({
    ui,
    result,
    strategy,
    label,
    lines,
    exitCode,
    timedOut,
  });
}

/** Augment PATH for Expo so local `expo` resolves via node_modules/.bin. */
function buildDoctorEnv(
  strategy: DoctorStrategy,
  cwd: string
): Record<string, string | undefined> {
  if (strategy.tool !== "expo") {
    return { ...process.env };
  }
  const binDir = resolve(cwd, "node_modules", ".bin");
  const sep = process.platform === "win32" ? ";" : ":";
  return {
    ...process.env,
    PATH: process.env.PATH ? `${binDir}${sep}${process.env.PATH}` : binDir,
    // Avoid npx interactive prompts hanging the wizard.
    npm_config_yes: "true",
  };
}

type DoctorWaitResult = {
  lines: string[];
  exitCode: number | null;
  timedOut: boolean;
  signalReceived: NodeJS.Signals | null;
};

async function waitForDoctor(
  child: ChildProcess,
  timeoutMs: number
): Promise<DoctorWaitResult> {
  const lines: string[] = [];
  let signalReceived: NodeJS.Signals | null = null;

  const append = (raw: Buffer) => {
    for (const segment of raw.toString("utf-8").split(NEWLINE_RE)) {
      const trimmed = segment.trim();
      if (!trimmed) {
        continue;
      }
      if (lines.length < MAX_OUTPUT_LINES) {
        lines.push(trimmed);
      }
    }
  };

  child.stdout?.on("data", append);
  child.stderr?.on("data", append);

  const safeKill = (sig: NodeJS.Signals) => {
    try {
      if (child.pid !== undefined && process.platform !== "win32") {
        process.kill(-child.pid, sig);
        return;
      }
      child.kill(sig);
    } catch (error) {
      logger.debug(`Failed to signal doctor process with ${sig}`, error);
    }
  };

  const onSigint = () => {
    signalReceived = "SIGINT";
    safeKill("SIGINT");
  };
  const onSigterm = () => {
    signalReceived = "SIGTERM";
    safeKill("SIGTERM");
  };
  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);

  let timedOut = false;
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

  const exitPromise = new Promise<number | null>((resolveExit) => {
    child.on("close", (code) => resolveExit(code));
    child.on("error", (error) => {
      logger.debug("Doctor process errored", error);
      resolveExit(1);
    });
  });

  const timeoutPromise = new Promise<"timeout">((resolveTimeout) => {
    timeoutHandle = setTimeout(() => {
      timedOut = true;
      safeKill("SIGTERM");
      resolveTimeout("timeout");
    }, timeoutMs);
  });

  const raced = await Promise.race([
    exitPromise.then((code) => ({ kind: "exit" as const, code })),
    timeoutPromise.then(() => ({ kind: "timeout" as const })),
  ]);

  if (timeoutHandle !== undefined) {
    clearTimeout(timeoutHandle);
  }

  // If we timed out, wait briefly for the process to exit after SIGTERM.
  let exitCode: number | null =
    raced.kind === "exit" ? raced.code : child.exitCode;
  if (raced.kind === "timeout") {
    await Promise.race([
      exitPromise,
      new Promise<void>((r) => {
        setTimeout(r, 2000);
      }),
    ]);
    if (child.exitCode === null && child.pid !== undefined) {
      safeKill("SIGKILL");
    }
    exitCode = child.exitCode;
  }

  process.removeListener("SIGINT", onSigint);
  process.removeListener("SIGTERM", onSigterm);
  child.stdout?.destroy();
  child.stderr?.destroy();

  return { lines, exitCode, timedOut, signalReceived };
}

type ReportArgs = {
  ui: WizardUI;
  result: WorkflowRunResult;
  strategy: DoctorStrategy;
  label: string;
  lines: string[];
  exitCode: number | null;
  timedOut: boolean;
};

function reportDoctorOutcome(args: ReportArgs): void {
  const { ui, result, strategy, label, lines, exitCode, timedOut } = args;
  const telemetryTags = {
    "wizard.platform": String(result.result?.platform ?? "unknown"),
  };
  const telemetryExtra = {
    features: result.result?.features,
    detectedCommand: scrubOutputLine(strategy.args.join(" ")),
    detectedSource: strategy.source,
    doctorTool: strategy.tool,
    outputLines: lines.length,
    outputTail: lines.slice(-10).map(scrubOutputLine),
  };

  if (timedOut) {
    ui.log.warn(
      `Could not verify — ${label} timed out after ${DOCTOR_TIMEOUT_S}s`
    );
    captureException(new Error("init verification failed"), {
      tags: { ...telemetryTags, "wizard.verify": "doctor_timeout" },
      extra: telemetryExtra,
    });
    return;
  }

  if (exitCode === 0) {
    ui.log.success(`Verified — ${label} passed`);
    return;
  }

  const codeLabel = exitCode === null ? "unknown" : String(exitCode);
  const lastLine = lines.at(-1);
  const detail = lastLine ? `: ${scrubOutputLine(lastLine).slice(0, 200)}` : "";
  ui.log.warn(
    `Could not verify — ${label} exited with code ${codeLabel}${detail}`
  );
  captureException(new Error("init verification failed"), {
    tags: { ...telemetryTags, "wizard.verify": "doctor_failed" },
    extra: { ...telemetryExtra, exitCode },
  });
}
