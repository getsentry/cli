/** Post-init verification: run the dev server and check for SDK events. */

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
const VERIFY_TIMEOUT_S = 30;

/**
 * Run the dev server, spawn the child process, and verify that the Sentry
 * SDK sends at least one envelope within {@link VERIFY_TIMEOUT_S} seconds.
 *
 * Called after `formatResult` in the wizard success path. On failure this
 * logs a warning and reports to Sentry telemetry — it does NOT throw, since
 * the init itself succeeded and the user should not be blocked.
 *
 * @param result - The wizard run result (used for telemetry tags)
 * @param ui - Wizard UI for logging
 * @param cwd - Project directory to run the dev command in
 */
export async function verifySetup(
  result: WorkflowRunResult,
  ui: WizardUI,
  cwd: string
): Promise<void> {
  const detected = await detectDevCommand(cwd);
  if (!detected) {
    ui.log.info(
      "Skipping verification — could not detect a dev command.\n" +
        "Run your dev server manually and check for events in Sentry."
    );
    return;
  }

  ui.log.info(`Verifying setup with: ${detected.args.join(" ")}...`);

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

  const envelopeReceived = new Promise<void>((resolveEnvelope) => {
    buffer.subscribe(() => {
      resolveEnvelope();
    });
  });

  let childEnv: Record<string, string | undefined> = {
    ...process.env,
    SENTRY_SPOTLIGHT: spotlightUrl,
    NEXT_PUBLIC_SENTRY_SPOTLIGHT: spotlightUrl,
    SENTRY_TRACES_SAMPLE_RATE: "1",
  };

  // Augment PATH for Node projects
  if (detected.source.startsWith("package.json")) {
    const binDir = resolve(cwd, "node_modules", ".bin");
    const sep = process.platform === "win32" ? ";" : ":";
    childEnv = {
      ...childEnv,
      PATH: childEnv.PATH ? `${binDir}${sep}${childEnv.PATH}` : binDir,
    };
  }

  let child: ReturnType<typeof Bun.spawn>;
  try {
    child = Bun.spawn(detected.args, {
      cwd,
      env: childEnv,
      stdout: "ignore",
      stderr: "ignore",
      stdin: "ignore",
    });
  } catch (error) {
    logger.debug("Failed to spawn verification child", error);
    await shutdownServer(server);
    ui.log.warn("Skipping verification — could not start the dev command.");
    return;
  }

  const onSigint = () => {
    try {
      child.kill("SIGINT");
    } catch {
      logger.debug("Child already exited");
    }
  };
  const onSigterm = () => {
    try {
      child.kill("SIGTERM");
    } catch {
      logger.debug("Child already exited");
    }
  };
  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);

  const childExited = child.exited.then((code) => ({
    kind: "exited" as const,
    code,
  }));

  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

  const outcome = await Promise.race([
    envelopeReceived.then(() => ({ kind: "envelope" as const })),
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

  // Clean up — kill and wait for the child to release its port
  try {
    child.kill("SIGTERM");
    let graceTimer: ReturnType<typeof setTimeout> | undefined;
    const exited = await Promise.race([
      child.exited.then(() => true),
      new Promise<false>((r) => {
        graceTimer = setTimeout(() => r(false), 5000);
      }),
    ]);
    clearTimeout(graceTimer);
    if (!exited) {
      child.kill("SIGKILL");
      await child.exited;
    }
  } catch (error) {
    logger.debug("Failed to kill verification child", error);
  }
  process.removeListener("SIGINT", onSigint);
  process.removeListener("SIGTERM", onSigterm);
  await shutdownServer(server);

  const telemetryTags = {
    "wizard.platform": String(result.result?.platform ?? "unknown"),
  };
  const telemetryExtra = {
    features: result.result?.features,
    detectedCommand: detected.args
      .join(" ")
      .replace(/[A-Za-z_]\w*=\S+/g, (m) => `${m.split("=")[0]}=[REDACTED]`),
    detectedSource: detected.source,
  };

  switch (outcome.kind) {
    case "envelope": {
      ui.log.success("Your app is sending events to Sentry");
      return;
    }
    case "timeout": {
      ui.log.warn(
        `Could not verify — no events received within ${VERIFY_TIMEOUT_S}s`
      );
      captureException(new Error("init verification failed"), {
        tags: { ...telemetryTags, "wizard.verify": "timeout" },
        extra: telemetryExtra,
      });
      return;
    }
    case "exited": {
      ui.log.warn(
        `Could not verify — dev server exited with code ${outcome.code}`
      );
      captureException(new Error("init verification failed"), {
        tags: { ...telemetryTags, "wizard.verify": "child_exited" },
        extra: { ...telemetryExtra, exitCode: outcome.code },
      });
      return;
    }
    default: {
      logger.debug("Unexpected verification outcome");
      return;
    }
  }
}
