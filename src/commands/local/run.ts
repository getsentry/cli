/**
 * sentry local run
 *
 * Run a command with the local dev server enabled. Injects
 * `SENTRY_SPOTLIGHT` into the child process environment so the Sentry SDK
 * auto-sends envelopes to the local server.
 */

import type { SentryContext } from "../../context.js";
import { buildCommand } from "../../lib/command.js";
import { CliError, EXIT, ValidationError } from "../../lib/errors.js";
import { bold } from "../../lib/formatters/colors.js";
import { logger } from "../../lib/logger.js";
import { DEFAULT_PORT } from "./server.js";

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

export const runCommand = buildCommand({
  docs: {
    brief: "Run a command with the local dev server enabled",
    fullDescription:
      "Run a command with the SENTRY_SPOTLIGHT environment variable\n" +
      "injected so the Sentry SDK automatically sends envelopes to the\n" +
      "local server.\n\n" +
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
  async *func(this: SentryContext, flags: RunFlags, args: string[]) {
    if (args.length === 0) {
      throw new ValidationError(
        "No command provided. Usage: sentry local run -- <command>",
        "command"
      );
    }

    const spotlightUrl = `http://${flags.host}:${flags.port}/stream`;

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
      throw new CliError(
        `Failed to start "${args[0]}": ${err instanceof Error ? err.message : String(err)}`,
        EXIT.GENERAL
      );
    }

    const exitCode = await child.exited;

    if (exitCode !== 0) {
      throw new CliError(`Process exited with code ${exitCode}`, EXIT.GENERAL);
    }
  },
});
