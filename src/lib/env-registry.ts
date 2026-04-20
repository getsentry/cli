/**
 * Environment Variable Registry
 *
 * Centralized metadata catalog for all environment variables recognized
 * by the CLI. Used by doc generators to produce configuration.md — NOT
 * used at runtime for env var access (existing `getEnv()` patterns remain).
 */

/** Metadata for a single environment variable */
export type EnvVarEntry = {
  /** Variable name (e.g., "SENTRY_AUTH_TOKEN") */
  name: string;
  /** Multi-sentence description (markdown OK). Rendered as body text under the heading. */
  description: string;
  /** Example value shown in a bash code block. If omitted, no code block is generated. */
  example?: string;
  /** Default value, mentioned in the description when provided. */
  defaultValue?: string;
  /** Install-script-only variable (not used at runtime by the CLI binary). */
  installOnly?: boolean;
};

/**
 * All user-facing environment variables recognized by the Sentry CLI.
 *
 * Ordered by documentation priority: auth → targeting → URL → paths →
 * install → display → logging/telemetry → cache/pagination → database.
 * The generator preserves this order in the output.
 */
export const ENV_VAR_REGISTRY: readonly EnvVarEntry[] = [
  // -- Auth --
  {
    name: "SENTRY_AUTH_TOKEN",
    description:
      "Authentication token for the Sentry API. This is the primary way to authenticate in CI/CD pipelines and scripts where interactive login is not possible.\n\nYou can create auth tokens in your [Sentry account settings](https://sentry.io/settings/account/api/auth-tokens/). By default, a stored OAuth token from `sentry auth login` takes priority over this variable. Set `SENTRY_FORCE_ENV_TOKEN=1` to give environment tokens precedence instead.",
    example: "sntrys_YOUR_TOKEN_HERE",
  },
  {
    name: "SENTRY_TOKEN",
    description:
      "Legacy alias for `SENTRY_AUTH_TOKEN`. If both are set, `SENTRY_AUTH_TOKEN` takes precedence.",
  },
  {
    name: "SENTRY_FORCE_ENV_TOKEN",
    description:
      "When set, environment variable tokens (`SENTRY_AUTH_TOKEN` / `SENTRY_TOKEN`) take precedence over the stored OAuth token from `sentry auth login`. By default, the stored OAuth token takes priority because it supports automatic refresh. Set this if you want to ensure the environment variable token is always used, which is useful for self-hosted setups or CI environments.",
    example: "1",
  },
  // -- Targeting --
  {
    name: "SENTRY_ORG",
    description:
      "Default organization slug. Skips organization auto-detection.",
    example: "my-org",
  },
  {
    name: "SENTRY_PROJECT",
    description:
      "Default project slug. Can also include the org in `org/project` format.\n\nWhen using the `org/project` combo format, `SENTRY_ORG` is ignored.",
    example: "my-org/my-project",
  },
  {
    name: "SENTRY_DSN",
    description:
      "Sentry DSN for project auto-detection. This is the same DSN you use in `Sentry.init()`. The CLI resolves it to determine your organization and project.\n\nThe CLI also detects DSNs from `.env` files and source code automatically — see [DSN Auto-Detection](./features/#dsn-auto-detection).",
    example: "https://key@o123.ingest.us.sentry.io/456",
  },
  // -- URL --
  {
    name: "SENTRY_HOST",
    description:
      "Base URL of your Sentry instance. **Only needed for [self-hosted Sentry](./self-hosted/).** SaaS users (sentry.io) should not set this.\n\nWhen set, all API requests (including OAuth login) are directed to this URL instead of `https://sentry.io`. The CLI also sets this automatically when you pass a self-hosted Sentry URL as a command argument.\n\n`SENTRY_HOST` takes precedence over `SENTRY_URL`. Both work identically — use whichever you prefer.",
    example: "https://sentry.example.com",
    defaultValue: "https://sentry.io",
  },
  {
    name: "SENTRY_URL",
    description:
      "Alias for `SENTRY_HOST`. If both are set, `SENTRY_HOST` takes precedence.",
    defaultValue: "https://sentry.io",
  },
  {
    name: "SENTRY_CLIENT_ID",
    description:
      "Client ID of a public OAuth application on your Sentry instance. **Required for [self-hosted Sentry](./self-hosted/)** (26.1.0+) to use `sentry auth login` with the device flow. See the [Self-Hosted guide](./self-hosted/#1-create-a-public-oauth-application) for how to create one.",
    example: "your-oauth-client-id",
  },
  // -- Custom headers --
  {
    name: "SENTRY_CUSTOM_HEADERS",
    description:
      "Custom HTTP headers to include in all requests to your Sentry instance. " +
      "**Only applies to [self-hosted Sentry](./self-hosted/).** Ignored when targeting sentry.io.\n\n" +
      "Use semicolon-separated `Name: Value` pairs. Useful for environments behind " +
      "reverse proxies that require additional headers for authentication " +
      "(e.g., Google IAP, Cloudflare Access).\n\n" +
      "Can also be set persistently with `sentry cli defaults headers`.",
    example: '"X-IAP-Token: my-proxy-token"',
  },
  // -- Paths --
  {
    name: "SENTRY_CONFIG_DIR",
    description:
      "Override the directory where the CLI stores its database (credentials, caches, defaults). Defaults to `~/.sentry/`.",
    example: "/path/to/config",
    defaultValue: "~/.sentry/",
  },
  {
    name: "SENTRY_INSTALL_DIR",
    description:
      "Override the directory where the CLI binary is installed. Used by the install script and `sentry cli upgrade` to control the binary location.",
    example: "/usr/local/bin",
    installOnly: true,
  },
  // -- Install --
  {
    name: "SENTRY_VERSION",
    description:
      "Pin a specific version for the [install script](./getting-started/#install-script). Accepts a version number (e.g., `0.19.0`) or `nightly`. The `--version` flag takes precedence if both are set.\n\nThis is useful in CI/CD pipelines and Dockerfiles where you want reproducible installations without inline flags.",
    example: "nightly",
    installOnly: true,
  },
  {
    name: "SENTRY_INIT",
    description:
      "Used with the install script. When set to `1`, the installer runs `sentry init` after installing the binary to guide you through project setup.",
    example: "1",
    installOnly: true,
  },
  // -- Display --
  {
    name: "SENTRY_PLAIN_OUTPUT",
    description:
      "Force plain text output (no colors or ANSI formatting). Takes precedence over `NO_COLOR`.",
    example: "1",
  },
  {
    name: "NO_COLOR",
    description:
      "Standard convention to disable color output. See [no-color.org](https://no-color.org/). Respected when `SENTRY_PLAIN_OUTPUT` is not set.",
    example: "1",
  },
  {
    name: "FORCE_COLOR",
    description:
      "Force color output on interactive terminals. Only takes effect when stdout is a TTY. Set to `0` to force plain output, `1` to force color. Ignored when stdout is piped.",
    example: "1",
  },
  {
    name: "SENTRY_OUTPUT_FORMAT",
    description:
      "Force the output format for all commands. Currently only `json` is supported. This is primarily used by the [library API](./library-usage/) (`createSentrySDK()`) to get JSON output without passing `--json` flags.",
    example: "json",
  },
  // -- Logging & telemetry --
  {
    name: "SENTRY_LOG_LEVEL",
    description:
      "Controls the verbosity of diagnostic output. Defaults to `info`.\n\nValid values: `error`, `warn`, `log`, `info`, `debug`, `trace`\n\nEquivalent to passing `--log-level debug` on the command line. CLI flags take precedence over the environment variable.",
    example: "debug",
    defaultValue: "info",
  },
  {
    name: "SENTRY_CLI_NO_TELEMETRY",
    description:
      "Disable CLI telemetry (error tracking for the CLI itself). The CLI sends anonymized error reports to help improve reliability — set this to opt out.",
    example: "1",
  },
  {
    name: "SENTRY_CLI_NO_UPDATE_CHECK",
    description:
      "Disable the automatic update check that runs periodically in the background.",
    example: "1",
  },
  // -- Cache & pagination --
  {
    name: "SENTRY_NO_CACHE",
    description:
      "Disable API response caching. When set, the CLI will not cache API responses and will always make fresh requests.",
    example: "1",
  },
  {
    name: "SENTRY_MAX_PAGINATION_PAGES",
    description:
      "Cap the maximum number of pages fetched during auto-pagination. Useful for limiting API calls when using large `--limit` values.",
    example: "10",
    defaultValue: "50",
  },
  // -- Database --
  {
    name: "SENTRY_CLI_NO_AUTO_REPAIR",
    description:
      "Disable automatic database schema repair. By default, the CLI automatically repairs its SQLite database when it detects schema drift. Set this to `1` to prevent auto-repair.",
    example: "1",
  },
];
