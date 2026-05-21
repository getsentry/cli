/**
 * sentry local run
 *
 * Run a command with the local dev server enabled. Injects
 * `SENTRY_SPOTLIGHT` into the child process environment so the Sentry SDK
 * auto-sends envelopes to the local server.
 *
 * If no server is already running on the target port, one is started
 * automatically in the background and shut down when the child exits.
 */

import type { Server } from "node:http";
import { createSpotlightBuffer } from "@spotlightjs/spotlight/sdk";
import type { SentryContext } from "../../context.js";
import { buildCommand } from "../../lib/command.js";
import { CliError, EXIT, ValidationError } from "../../lib/errors.js";
import { bold } from "../../lib/formatters/colors.js";
import { logger } from "../../lib/logger.js";
import {
  buildApp,
  DEFAULT_PORT,
  isServerRunning,
  tryListen,
} from "./server.js";

type RunFlags = {
  readonly port: number;
  readonly host: string;
};

/** Parse and validate a port number. */
function parsePort(value: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new ValidationError(
      `Invalid port: ${value}. Must be an integer between 0 and 65535.`,
      "port"
    );
  }
  return port;
}

/** Buffer size for the auto-started background server. */
const BUFFER_SIZE = 500;

/**
 * Shut down a background server, closing all connections so keep-alive
 * sockets (e.g. SSE subscribers) don't block exit.
 */
function shutdownServer(server: Server): Promise<void> {
  return new Promise<void>((resolve) => {
    server.close(() => resolve());
    if (typeof server.closeAllConnections === "function") {
      server.closeAllConnections();
    }
  });
}

export const runCommand = buildCommand({
  docs: {
    brief: "Run a command with the local dev server enabled",
    fullDescription:
      "Run a command with the SENTRY_SPOTLIGHT environment variable\n" +
      "injected so the Sentry SDK automatically sends envelopes to the\n" +
      "local server.\n\n" +
      "If no server is already listening on the port, one is started\n" +
      "automatically and shut down when the child process exits.\n\n" +
      "The child process inherits all current env vars plus\n" +
      "SENTRY_SPOTLIGHT and SENTRY_TRACES_SAMPLE_RATE=1.\n\n" +
      "Example:\n" +
      "  sentry local run -- npm run dev\n" +
      "  sentry local run -- python manage.py runserver",
  },
  parameters: {
    positional: {
      kind: "array",
      parameter: {
        brief: "Command to run",
        parse: String,
        placeholder: "command",
      },
    },
    flags: {
      port: {
        kind: "parsed",
        parse: parsePort,
        brief: `Port for the local server (default ${DEFAULT_PORT})`,
        default: String(DEFAULT_PORT),
      },
      host: {
        kind: "parsed",
        parse: String,
        brief: "Hostname for the local server (default localhost)",
        default: "localhost",
      },
    },
    aliases: {
      p: "port",
    },
  },
  auth: false,
  // biome-ignore lint/correctness/useYield: child process wrapper, no structured output
  async *func(this: SentryContext, flags: RunFlags, ...rawArgs: string[]) {
    // Strip leading "--" separator that Stricli passes through
    const args = rawArgs[0] === "--" ? rawArgs.slice(1) : rawArgs;
    if (args.length === 0) {
      throw new ValidationError(
        "No command provided. Usage: sentry local run -- <command>",
        "command"
      );
    }

    let url = `http://${flags.host}:${flags.port}`;
    let bgServer: Server | undefined;

    const alreadyRunning = await isServerRunning(url);
    if (!alreadyRunning) {
      logger.info("No server detected, starting one in the background...");
      const buffer = createSpotlightBuffer(BUFFER_SIZE);
      const app = buildApp(buffer);
      const { server, port: boundPort } = await tryListen(
        app,
        flags.port,
        flags.host
      );
      bgServer = server;
      url = `http://${flags.host}:${boundPort}`;
      logger.info(`Background server listening on ${bold(url)}`);
    }

    const spotlightUrl = `${url}/stream`;
    logger.info(`Starting: ${bold(args.join(" "))}`);
    logger.info(`SENTRY_SPOTLIGHT=${spotlightUrl}`);

    let child: ReturnType<typeof Bun.spawn>;
    try {
      child = Bun.spawn(args, {
        env: {
          ...process.env,
          SENTRY_SPOTLIGHT: spotlightUrl,
          NEXT_PUBLIC_SENTRY_SPOTLIGHT: spotlightUrl,
          SENTRY_TRACES_SAMPLE_RATE: "1",
        },
        stdout: "inherit",
        stderr: "inherit",
        stdin: "inherit",
      });
    } catch (err) {
      if (bgServer) {
        await shutdownServer(bgServer);
      }
      throw new CliError(
        `Failed to start "${args[0]}": ${err instanceof Error ? err.message : String(err)}`,
        EXIT.GENERAL
      );
    }

    // Forward signals to the child so the whole process tree shuts down.
    const forwardSignal = (signal: NodeJS.Signals) => {
      child.kill(signal);
    };
    process.once("SIGINT", () => forwardSignal("SIGINT"));
    process.once("SIGTERM", () => forwardSignal("SIGTERM"));

    const exitCode = await child.exited;

    if (bgServer) {
      logger.info("Stopping background server...");
      await shutdownServer(bgServer);
    }

    if (exitCode !== 0) {
      throw new CliError(`Process exited with code ${exitCode}`, exitCode);
    }
  },
});
