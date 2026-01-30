/**
 * Runtime constants for the CLI.
 */

/** Build-time constant injected by esbuild/bun */
declare const SENTRY_CLI_VERSION: string | undefined;

/** CLI version string, available for help output and other uses */
export const CLI_VERSION =
  typeof SENTRY_CLI_VERSION !== "undefined" ? SENTRY_CLI_VERSION : "0.0.0-dev";

/**
 * Generate the User-Agent string for API requests.
 * Format: sentry-cli/<version> (<os>-<arch>) <runtime>/<version>
 *
 * @example "sentry-cli/0.5.0 (linux-x64) bun/1.3.3"
 * @example "sentry-cli/0.5.0 (darwin-arm64) node/22.12.0"
 */
export function getUserAgent(): string {
  const runtime =
    typeof process.versions.bun !== "undefined"
      ? `bun/${process.versions.bun}`
      : `node/${process.versions.node}`;
  return `sentry-cli/${CLI_VERSION} (${process.platform}-${process.arch}) ${runtime}`;
}

/**
 * DSN for CLI telemetry (error tracking and usage metrics).
 *
 * This is NOT for user projects - it's for tracking errors in the CLI itself.
 * Safe to hardcode as DSNs are designed to be public (they only allow sending
 * events, not reading data).
 */
export const SENTRY_CLI_DSN =
  "https://1188a86f3f8168f089450587b00bca66@o1.ingest.us.sentry.io/4510776311808000";
