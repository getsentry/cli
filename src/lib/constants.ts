/**
 * Runtime constants for the CLI.
 */

/**
 * DSN for CLI telemetry (error tracking and usage metrics).
 *
 * This is NOT for user projects - it's for tracking errors in the CLI itself.
 * Safe to hardcode as DSNs are designed to be public (they only allow sending
 * events, not reading data).
 */
export const SENTRY_CLI_DSN =
  "https://1188a86f3f8168f089450587b00bca66@o1.ingest.us.sentry.io/4510776311808000";
