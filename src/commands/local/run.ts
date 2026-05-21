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
import { resolve } from "node:path";
import { createSpotlightBuffer } from "@spotlightjs/spotlight/sdk";
import type { SentryContext } from "../../context.js";
import { buildCommand } from "../../lib/command.js";
import { detectDevCommand } from "../../lib/dev-script.js";
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
  readonly verify: boolean;
  readonly timeout: number;
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
export const BUFFER_SIZE = 500;

/**
 * Shut down a background server, closing all connections so keep-alive
 * sockets (e.g. SSE subscribers) don't block exit.
 */
export function shutdownServer(server: Server): Promise<void> {
  return new Promise<void>((done) => {
    server.close(() => done());
    if (typeof server.closeAllConnections === "function") {
      server.closeAllConnections();
    }
  });
}

/** Parse a timeout value, ensuring it's a non-negative integer. */
function parseTimeout(value: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    throw new ValidationError(
      `Invalid timeout: ${value}. Must be a non-negative number.`,
      "timeout"
    );
  }
  return n;
}

/**
 * Whether the detected command originated from a package.json script.
 * Used to decide if `./node_modules/.bin` should be prepended to PATH.
 */
function isPackageJsonSource(source: string): boolean {
  return source.startsWith("package.json");
}

/** Augment PATH with `./node_modules/.bin` for Node project scripts. */
function augmentPathForNode(
  env: Record<string, string | undefined>,
  cwd: string
): Record<string, string | undefined> {
  const binDir = resolve(cwd, "node_modules", ".bin");
  const sep = process.platform === "win32" ? ";" : ":";
  return {
    ...env,
    PATH: `${binDir}${sep}${env.PATH ?? ""}`,
  };
}

const AUTO_DETECT_ERROR_MESSAGE = [
  "No command provided and could not auto-detect a dev script.",
  "Usage: sentry local run -- <command>",
  "",
  "Supported auto-detection:",
  "  - package.json (scripts: dev, develop, serve, start)",
  "  - manage.py (Django)",
  "  - app.py / main.py (Python)",
  "  - go.mod (Go)",
  "  - docker-compose.yml / compose.yml (Docker Compose)",
].join("\n");

/** Build the env vars for the child process. */
function buildChildEnv(
  spotlightUrl: string,
  commandSource: string,
  cwd: string
): Record<string, string | undefined> {
  let env: Record<string, string | undefined> = {
    ...process.env,
    SENTRY_SPOTLIGHT: spotlightUrl,
    NEXT_PUBLIC_SENTRY_SPOTLIGHT: spotlightUrl,
    SENTRY_TRACES_SAMPLE_RATE: "1",
  };
  if (isPackageJsonSource(commandSource)) {
    env = augmentPathForNode(env, cwd);
  }
  return env;
}

/** Resolve args and source — auto-detect from filesystem when no args provided. */
async function resolveArgs(
  stripped: string[],
  cwd: string
): Promise<{ args: string[]; commandSource: string }> {
  if (stripped.length > 0) {
    return { args: stripped, commandSource: "" };
  }
  const detected = await detectDevCommand(cwd);
  if (!detected) {
    throw new ValidationError(AUTO_DETECT_ERROR_MESSAGE, "command");
  }
  logger.info(`Detected ${detected.source}: ${detected.args.join(" ")}`);
  return { args: detected.args, commandSource: detected.source };
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
      verify: {
        kind: "boolean",
        brief: "Verify SDK sends events, then exit",
        default: false,
      },
      timeout: {
        kind: "parsed",
        parse: parseTimeout,
        brief: "Kill the child after N seconds (0 = no timeout)",
        default: "0",
      },
    },
    aliases: {
      p: "port",
      V: "verify",
      t: "timeout",
    },
  },
  auth: false,
  async *func(this: SentryContext, flags: RunFlags, ...rawArgs: string[]) {
    const stripped = rawArgs[0] === "--" ? rawArgs.slice(1) : rawArgs;
    const { args, commandSource } = await resolveArgs(stripped, this.cwd);

    if (flags.verify) {
      yield* runWithVerify(args, flags, this.cwd, commandSource);
      return;
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

    const childEnv = buildChildEnv(spotlightUrl, commandSource, this.cwd);

    let child: ReturnType<typeof Bun.spawn>;
    try {
      child = Bun.spawn(args, {
        cwd: this.cwd,
        env: childEnv,
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

    const forwardSignal = (signal: NodeJS.Signals) => {
      child.kill(signal);
    };
    process.once("SIGINT", () => forwardSignal("SIGINT"));
    process.once("SIGTERM", () => forwardSignal("SIGTERM"));

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    if (flags.timeout > 0) {
      timeoutId = setTimeout(() => {
        logger.warn(`Timeout: killing child after ${flags.timeout}s`);
        child.kill("SIGTERM");
      }, flags.timeout * 1000);
    }

    const exitCode = await child.exited;

    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }

    if (bgServer) {
      logger.info("Stopping background server...");
      await shutdownServer(bgServer);
    }

    if (exitCode !== 0) {
      throw new CliError(`Process exited with code ${exitCode}`, exitCode);
    }
  },
});

/**
 * Run in --verify mode: start a background server, subscribe to the buffer
 * for the first envelope, and race between envelope arrival, timeout,
 * and child exit.
 */
async function* runWithVerify(
  args: string[],
  flags: RunFlags,
  cwd: string,
  commandSource: string
): AsyncGenerator<never, void, unknown> {
  const buffer = createSpotlightBuffer(BUFFER_SIZE);
  const app = buildApp(buffer);
  const { server, port: boundPort } = await tryListen(
    app,
    flags.port,
    flags.host
  );
  const url = `http://${flags.host}:${boundPort}`;
  logger.info(`Verify server listening on ${bold(url)}`);

  const spotlightUrl = `${url}/stream`;

  const envelopeReceived = new Promise<void>((resolveEnvelope) => {
    buffer.subscribe(() => {
      resolveEnvelope();
    });
  });

  const childEnv = buildChildEnv(spotlightUrl, commandSource, cwd);

  let child: ReturnType<typeof Bun.spawn>;
  try {
    child = Bun.spawn(args, {
      cwd,
      env: childEnv,
      stdout: "inherit",
      stderr: "inherit",
      stdin: "inherit",
    });
  } catch (err) {
    await shutdownServer(server);
    throw new CliError(
      `Failed to start "${args[0]}": ${err instanceof Error ? err.message : String(err)}`,
      EXIT.GENERAL
    );
  }

  const forwardSignal = (signal: NodeJS.Signals) => {
    child.kill(signal);
  };
  process.once("SIGINT", () => forwardSignal("SIGINT"));
  process.once("SIGTERM", () => forwardSignal("SIGTERM"));

  const childExited = child.exited.then((code) => ({
    kind: "exited" as const,
    code,
  }));

  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

  const racers: Promise<
    | { kind: "envelope" }
    | { kind: "exited"; code: number }
    | { kind: "timeout" }
  >[] = [
    envelopeReceived.then(() => ({ kind: "envelope" as const })),
    childExited,
  ];

  if (flags.timeout > 0) {
    racers.push(
      new Promise((r) => {
        timeoutHandle = setTimeout(
          () => r({ kind: "timeout" as const }),
          flags.timeout * 1000
        );
      })
    );
  }

  const outcome = await Promise.race(racers);

  if (timeoutHandle !== undefined) {
    clearTimeout(timeoutHandle);
  }

  switch (outcome.kind) {
    case "envelope": {
      logger.info("Setup verified — your app is sending events to Sentry");
      child.kill("SIGTERM");
      await shutdownServer(server);
      return;
    }
    case "timeout": {
      logger.warn(
        `Verification timed out after ${flags.timeout}s — no events received from the SDK`
      );
      child.kill("SIGTERM");
      await shutdownServer(server);
      throw new CliError(
        `Verification timed out after ${flags.timeout}s`,
        EXIT.WIZARD_VERIFY
      );
    }
    case "exited": {
      await shutdownServer(server);
      if (outcome.code === 0) {
        logger.warn("Process exited before sending any events");
        throw new CliError(
          "Process exited before sending any events",
          EXIT.WIZARD_VERIFY
        );
      }
      logger.warn(`Process crashed with code ${outcome.code}`);
      throw new CliError(
        `Process crashed with code ${outcome.code}`,
        outcome.code
      );
    }
    default: {
      throw new CliError("Unexpected verification outcome", EXIT.GENERAL);
    }
  }
}
