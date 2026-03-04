/**
 * Structured logging for Sentry CLI.
 *
 * Built on {@link https://github.com/unjs/consola | consola} — a lightweight CLI logger
 * with log levels, tag scoping, and fancy TTY output. Two reporters are wired up:
 *
 * 1. **FancyReporter** (built-in) — writes to stderr with colors/icons for TTY,
 *    falls back to BasicReporter in CI/non-TTY environments.
 * 2. **Sentry.createConsolaReporter()** — auto-forwards all log messages to Sentry
 *    structured logs via `_INTERNAL_captureLog`. Requires `enableLogs: true` in
 *    `Sentry.init()` (already enabled in telemetry.ts).
 *
 * ## Log levels
 *
 * | Level | consola | Shows |
 * |-------|---------|-------|
 * | error | 0       | fatal, error |
 * | warn  | 1       | + warn |
 * | info  | 3       | + info, success, start, ready, log (default) |
 * | debug | 4       | + debug |
 * | trace | 5       | + trace |
 *
 * ## Usage
 *
 * ```ts
 * import { logger } from "./logger.js";
 *
 * // User-facing messages (always visible at default level)
 * logger.info("Checking for updates...");
 * logger.success("Upgrade complete!");
 *
 * // Diagnostic messages (visible with SENTRY_LOG_LEVEL=debug or --verbose)
 * logger.debug("Found chain of 2 patches totalling 96 KB");
 *
 * // Scoped diagnostic messages
 * const log = logger.withTag("delta-upgrade");
 * log.debug("Resolved stable chain: 0.12.0 → 0.13.0");
 * ```
 *
 * ## Environment variables
 *
 * - `SENTRY_LOG_LEVEL` — Sets log level: `error`, `warn`, `info` (default), `debug`, `trace`
 * - `NO_COLOR` — Disables color output (respected by consola natively)
 * - `FORCE_COLOR` — Forces color output even in non-TTY
 *
 * @module
 */

import { createConsola } from "consola";

/**
 * Environment variable name for controlling CLI log verbosity.
 *
 * Using `SENTRY_LOG_LEVEL` (not `CONSOLA_LEVEL`) to be consistent with
 * other Sentry CLI env vars (`SENTRY_URL`, `SENTRY_AUTH_TOKEN`, etc.).
 */
export const LOG_LEVEL_ENV_VAR = "SENTRY_LOG_LEVEL";

/**
 * Valid log level names accepted by `SENTRY_LOG_LEVEL` and `--log-level`.
 *
 * Maps to consola numeric levels:
 * - error → 0
 * - warn → 1
 * - info → 3 (default)
 * - debug → 4
 * - trace → 5
 */
export const LOG_LEVEL_NAMES = [
  "error",
  "warn",
  "info",
  "debug",
  "trace",
] as const;

/** A valid log level name string */
export type LogLevelName = (typeof LOG_LEVEL_NAMES)[number];

/** Maps level names to consola numeric levels */
const LOG_LEVEL_MAP: Record<LogLevelName, number> = {
  error: 0,
  warn: 1,
  info: 3,
  debug: 4,
  trace: 5,
};

/**
 * Default log level when nothing is configured.
 * Level 3 shows info, success, start, ready, log, fail — standard user-facing output.
 */
const DEFAULT_LOG_LEVEL = 3;

/**
 * Parse a log level name string into a consola numeric level.
 *
 * Returns the default level (info = 3) for unrecognized values so that
 * a typo in `SENTRY_LOG_LEVEL` doesn't break the CLI.
 *
 * @param name - Level name from env var or CLI flag
 * @returns consola numeric level
 */
export function parseLogLevel(name: string): number {
  const normalized = name.toLowerCase().trim();
  if (normalized in LOG_LEVEL_MAP) {
    return LOG_LEVEL_MAP[normalized as LogLevelName];
  }
  return DEFAULT_LOG_LEVEL;
}

/**
 * Read the initial log level from the `SENTRY_LOG_LEVEL` environment variable.
 *
 * @returns consola numeric level (defaults to 3 / info)
 */
function getInitialLogLevel(): number {
  const envLevel = process.env[LOG_LEVEL_ENV_VAR];
  if (envLevel) {
    return parseLogLevel(envLevel);
  }
  return DEFAULT_LOG_LEVEL;
}

/**
 * Global CLI logger instance.
 *
 * Use `logger.info()`, `logger.success()`, `logger.start()` for user-facing messages.
 * Use `logger.debug()`, `logger.trace()` for diagnostic output.
 * Use `logger.withTag('scope')` for domain-specific scoped loggers.
 *
 * The Sentry reporter is added lazily via {@link attachSentryReporter} after
 * Sentry.init() completes, since the reporter needs an active Sentry client.
 */
export const logger = createConsola({
  level: getInitialLogLevel(),
  // stderr is the correct stream for diagnostic/log output in CLIs —
  // stdout is reserved for command output (data, JSON, tables).
  stderr: process.stderr,
  // FancyReporter is included by default for TTY, BasicReporter for CI/non-TTY.
  // Sentry reporter is added after Sentry.init() via attachSentryReporter().
});

/** Whether the Sentry reporter has already been attached */
let sentryReporterAttached = false;

/**
 * Attach the Sentry consola reporter for automatic log forwarding.
 *
 * Must be called after `Sentry.init()` completes so that `createConsolaReporter()`
 * can find the active client. Safe to call multiple times — subsequent calls are no-ops.
 *
 * The reporter auto-forwards all consola log messages to Sentry structured logs,
 * mapping consola types to Sentry severity levels:
 * - fatal → fatal, error → error, warn → warn
 * - info/log/success/ready/start → info
 * - debug/verbose → debug, trace → trace
 *
 * Tags are preserved as `consola.tag` attributes in Sentry.
 */
export function attachSentryReporter(): void {
  if (sentryReporterAttached) {
    return;
  }
  sentryReporterAttached = true;

  try {
    // Dynamic import to avoid pulling in Sentry at module load time.
    // The reporter is exported from @sentry/bun (via @sentry/node → @sentry/core).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Sentry = require("@sentry/bun") as {
      createConsolaReporter: (options?: Record<string, unknown>) => {
        log: (logObj: unknown) => void;
      };
    };

    const sentryReporter = Sentry.createConsolaReporter();
    logger.addReporter(sentryReporter);
  } catch {
    // Sentry not available (e.g., telemetry disabled) — continue without reporter
  }
}

/**
 * Set the logger level at runtime.
 *
 * Called from the global `--verbose` / `--log-level` flag handler in bin.ts
 * after pre-parsing argv.
 *
 * @param level - consola numeric level (0-5)
 */
export function setLogLevel(level: number): void {
  logger.level = level;
}

/**
 * Parse `--verbose` and `--log-level <level>` from raw argv.
 *
 * These are "global" flags that must be processed before Stricli sees the args,
 * because Stricli has no concept of global flags.
 *
 * `--log-level` is consumed (removed from argv) because it's exclusively a
 * logger flag — no command defines it. `--verbose` is NOT consumed because
 * some commands (e.g., `api`) define their own `--verbose` flag with
 * command-specific semantics.
 *
 * Priority: `--log-level` wins over `--verbose` if both are specified.
 * `--verbose` is equivalent to `--log-level debug`.
 *
 * @param argv - Raw process.argv.slice(2), mutated in place
 * @returns The resolved log level, or null if no flag was specified
 */
export function extractLogLevelFromArgs(argv: string[]): number | null {
  let resolvedLevel: number | null = null;

  // Check --verbose but leave it in argv — commands like `api` have their own --verbose flag
  const verboseIdx = argv.indexOf("--verbose");
  if (verboseIdx !== -1) {
    resolvedLevel = LOG_LEVEL_MAP.debug;
  }

  // Process --log-level <level> (overrides --verbose, consumed from argv)
  const logLevelIdx = argv.indexOf("--log-level");
  if (logLevelIdx !== -1) {
    const levelValue = argv[logLevelIdx + 1];
    if (levelValue && !levelValue.startsWith("-")) {
      resolvedLevel = parseLogLevel(levelValue);
      argv.splice(logLevelIdx, 2);
    } else {
      // --log-level without value — remove just the flag, use debug as sensible default
      resolvedLevel = LOG_LEVEL_MAP.debug;
      argv.splice(logLevelIdx, 1);
    }
  }

  return resolvedLevel;
}
