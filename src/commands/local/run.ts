/**
 * sentry local run
 *
 * Run a command with the local dev server enabled. Injects
 * `SENTRY_SPOTLIGHT` (read automatically by server-side SDKs) plus the
 * framework-prefixed client variants (`NEXT_PUBLIC_SENTRY_SPOTLIGHT`,
 * `VITE_SENTRY_SPOTLIGHT`, etc.) so the spotlight URL also reaches
 * browser bundles regardless of bundler.
 *
 * If no server is already running on the target port, one is started
 * automatically in the background and shut down when the child exits.
 */

import { type ChildProcess, spawn } from "node:child_process";
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
  parsePort,
  tryListen,
} from "./server.js";

type RunFlags = {
  readonly port: number;
  readonly host: string;
};

/** Buffer size for the auto-started background server. */
const BUFFER_SIZE = 500;

/**
 * Client-side env var prefixes that frameworks inline into browser bundles
 * at build time. We inject `<PREFIX>SENTRY_SPOTLIGHT` for every variant so the
 * spotlight URL reaches whichever bundler the user's app uses.
 *
 * Mirrors the prefixes the Sentry browser SDK is intended to read for
 * Spotlight configuration (see getsentry/sentry-javascript#18198). Note this
 * set differs from the DSN-detection prefixes in `src/lib/dsn/env.ts`: it adds
 * `PUBLIC_` (SvelteKit/Astro/Qwik), `VUE_APP_` (Vue CLI), and `GATSBY_`
 * (Gatsby), and omits `EXPO_PUBLIC_` (React Native has no browser bundle).
 */
export const CLIENT_SPOTLIGHT_PREFIXES = [
  "PUBLIC_", // SvelteKit, Astro, Qwik
  "NEXT_PUBLIC_", // Next.js
  "VITE_", // Vite
  "NUXT_PUBLIC_", // Nuxt
  "REACT_APP_", // Create React App
  "VUE_APP_", // Vue CLI
  "GATSBY_", // Gatsby
] as const;

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
      "SENTRY_SPOTLIGHT (server-side SDKs read this automatically), the\n" +
      "framework-prefixed client variants (NEXT_PUBLIC_, VITE_, etc.), and\n" +
      "SENTRY_TRACES_SAMPLE_RATE=1.\n\n" +
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

    let child: ChildProcess;
    try {
      const [cmd = "", ...cmdArgs] = args;
      // Expose the spotlight URL under every framework client prefix so it's
      // inlined into browser bundles regardless of bundler. `SENTRY_SPOTLIGHT`
      // is set last so the base name (read by server-side SDKs) is never
      // shadowed by a client variant.
      const clientSpotlightVars = Object.fromEntries(
        CLIENT_SPOTLIGHT_PREFIXES.map((prefix) => [
          `${prefix}SENTRY_SPOTLIGHT`,
          spotlightUrl,
        ])
      );
      child = spawn(cmd, cmdArgs, {
        env: {
          ...process.env,
          ...clientSpotlightVars,
          SENTRY_SPOTLIGHT: spotlightUrl,
          SENTRY_TRACES_SAMPLE_RATE:
            process.env.SENTRY_TRACES_SAMPLE_RATE ?? "1",
        },
        stdio: "inherit",
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
    // Store references so handlers can be removed in finally.
    const onSigint = () => child.kill("SIGINT");
    const onSigterm = () => child.kill("SIGTERM");
    process.once("SIGINT", onSigint);
    process.once("SIGTERM", onSigterm);

    let exitCode: number;
    try {
      exitCode = await new Promise<number>((resolve, reject) => {
        let settled = false;
        child.on("close", (code) => {
          if (!settled) {
            settled = true;
            resolve(code ?? 1);
          }
        });
        // If spawn itself fails (e.g. ENOENT), 'close' may never fire.
        child.on("error", (err) => {
          logger.debug(`Child process error: ${err.message}`);
          if (!settled) {
            settled = true;
            reject(err);
          }
        });
      });
    } finally {
      process.removeListener("SIGINT", onSigint);
      process.removeListener("SIGTERM", onSigterm);
      if (bgServer) {
        logger.info("Stopping background server...");
        await shutdownServer(bgServer);
      }
    }

    if (exitCode !== 0) {
      throw new CliError(`Process exited with code ${exitCode}`, exitCode);
    }
  },
});
