---
title: "Configuration"
description: "Environment variables, config files, and configuration options for the Sentry CLI"
url: "https://cli.sentry.dev/_preview/pr-1287/configuration/"
---

# Configuration

The Sentry CLI can be configured through config files, environment variables, and a local database. Most users don't need to set any of these — the CLI auto-detects your project from your codebase and stores credentials locally after `sentry auth login`.

## Environment Variables

### `SENTRY_AUTH_TOKEN`

Authentication token for the Sentry API. This is the primary way to authenticate in CI/CD pipelines and scripts where interactive login is not possible.

You can create auth tokens in your [Sentry account settings](https://sentry.io/settings/account/api/auth-tokens/). When a stored OAuth login from `sentry auth login` also exists, the stored login takes priority — set `SENTRY_FORCE_ENV_TOKEN=1` to override.

```bash
export SENTRY_AUTH_TOKEN=sntrys_YOUR_TOKEN_HERE
```


### `SENTRY_TOKEN`

Legacy alias for `SENTRY_AUTH_TOKEN`. If both are set, `SENTRY_AUTH_TOKEN` takes precedence.

### `SENTRY_FORCE_ENV_TOKEN`

When set, environment variable tokens (`SENTRY_AUTH_TOKEN` / `SENTRY_TOKEN`) take precedence over the stored OAuth token from `sentry auth login`. By default, the stored OAuth token takes priority because it supports automatic refresh. Set this if you want to ensure the environment variable token is always used, which is useful for self-hosted setups or CI environments.

```bash
export SENTRY_FORCE_ENV_TOKEN=1
```


### `SENTRY_ORG`

Default organization slug. Skips organization auto-detection.

```bash
export SENTRY_ORG=my-org
```


### `SENTRY_PROJECT`

Default project slug. Can also include the org in `org/project` format.

When using the `org/project` combo format, `SENTRY_ORG` is ignored.

```bash
export SENTRY_PROJECT=my-org/my-project
```


### `SENTRY_DSN`

Sentry DSN for project auto-detection. This is the same DSN you use in `Sentry.init()`. The CLI resolves it to determine your organization and project.

The CLI also detects DSNs from `.env` files and source code automatically — see [DSN Auto-Detection](https://cli.sentry.dev/_preview/pr-1287/configuration/features.md#dsn-auto-detection).

```bash
export SENTRY_DSN=https://key@o123.ingest.us.sentry.io/456
```


### `SENTRY_RELEASE`

Explicit release version for `sentry release propose-version`. When set, the command returns this value immediately without checking CI environment variables or local git history. Useful in CI pipelines where the release version is determined by a prior step.

```bash
export SENTRY_RELEASE=1.0.0
```


### `SENTRY_HOST`

Base URL of your Sentry instance. **Only needed for [self-hosted Sentry](https://cli.sentry.dev/_preview/pr-1287/configuration/self-hosted.md).** SaaS users (sentry.io) should not set this.

When set, all API requests (including OAuth login) are directed to this URL instead of `https://sentry.io`. The CLI also sets this automatically when you pass a self-hosted Sentry URL as a command argument.

`SENTRY_HOST` takes precedence over `SENTRY_URL`. Both work identically — use whichever you prefer.

```bash
export SENTRY_HOST=https://sentry.example.com
```


### `SENTRY_URL`

Alias for `SENTRY_HOST`. If both are set, `SENTRY_HOST` takes precedence.

### `SENTRY_CLIENT_ID`

Client ID of a public OAuth application on your Sentry instance. **Required for [self-hosted Sentry](https://cli.sentry.dev/_preview/pr-1287/configuration/self-hosted.md)** (26.1.0+) to use `sentry auth login` with the device flow. See the [Self-Hosted guide](https://cli.sentry.dev/_preview/pr-1287/configuration/self-hosted.md#1-create-a-public-oauth-application) for how to create one.

```bash
export SENTRY_CLIENT_ID=your-oauth-client-id
```


### `SENTRY_CUSTOM_HEADERS`

Custom HTTP headers to include in all requests to your Sentry instance. **Only applies to [self-hosted Sentry](https://cli.sentry.dev/_preview/pr-1287/configuration/self-hosted.md).** Ignored when targeting sentry.io.

Use semicolon-separated `Name: Value` pairs. Useful for environments behind reverse proxies that require additional headers for authentication (e.g., Google IAP, Cloudflare Access).

Can also be set persistently with `sentry cli defaults headers`.

```bash
export SENTRY_CUSTOM_HEADERS="X-IAP-Token: my-proxy-token"
```


### `SENTRY_CONFIG_DIR`

Override the directory where the CLI stores its database (credentials, caches, defaults). Defaults to `~/.sentry/`.

```bash
export SENTRY_CONFIG_DIR=/path/to/config
```


### `SENTRY_INSTALL_DIR`

Override the directory where the CLI binary is installed. Used by the install script and `sentry cli upgrade` to control the binary location.

```bash
export SENTRY_INSTALL_DIR=/usr/local/bin
```


### `SENTRY_VERSION`

Pin a specific version for the [install script](https://cli.sentry.dev/_preview/pr-1287/configuration/getting-started.md#install-script). Accepts a version number (e.g., `0.19.0`) or `nightly`. The `--version` flag takes precedence if both are set.

This is useful in CI/CD pipelines and Dockerfiles where you want reproducible installations without inline flags.

```bash
export SENTRY_VERSION=nightly
```


### `SENTRY_INIT`

Used with the install script. When set to `1`, the installer runs `sentry init` after installing the binary to guide you through project setup.

```bash
export SENTRY_INIT=1
```


### `SENTRY_INIT_TUI`

Control the TUI (terminal user interface) for `sentry init`. Set to `0` to disable the interactive TUI and use plain text logging output instead. Useful in CI/CD pipelines or environments without full terminal support.

```bash
export SENTRY_INIT_TUI=0
```


### `NODE_EXTRA_CA_CERTS`

Path to a PEM file containing additional CA certificates to trust. Useful behind corporate TLS-intercepting proxies (Zscaler, Netskope, etc.).

Can also be set persistently with `sentry cli defaults ca-cert`.

```bash
export NODE_EXTRA_CA_CERTS=/path/to/corporate-ca.pem
```


### `SENTRY_PLAIN_OUTPUT`

Force plain text output (no colors or ANSI formatting). Takes precedence over `NO_COLOR`.

```bash
export SENTRY_PLAIN_OUTPUT=1
```


### `SENTRY_NO_SIXEL`

Disable the sixel image banner on terminals that support it; the block-art banner is shown instead.

```bash
export SENTRY_NO_SIXEL=1
```


### `NO_COLOR`

Standard convention to disable color output. See [no-color.org](https://no-color.org/). Respected when `SENTRY_PLAIN_OUTPUT` is not set.

```bash
export NO_COLOR=1
```


### `FORCE_COLOR`

Force color output on interactive terminals. Only takes effect when stdout is a TTY. Set to `0` to force plain output, `1` to force color. Ignored when stdout is piped.

```bash
export FORCE_COLOR=1
```


### `SENTRY_OUTPUT_FORMAT`

Force the output format for all commands. Currently only `json` is supported. This is primarily used by the [library API](https://cli.sentry.dev/_preview/pr-1287/configuration/library-usage.md) (`createSentrySDK()`) to get JSON output without passing `--json` flags.

```bash
export SENTRY_OUTPUT_FORMAT=json
```


### `SENTRY_LOG_LEVEL`

Controls the verbosity of diagnostic output. Defaults to `info`.

Valid values: `error`, `warn`, `log`, `info`, `debug`, `trace`

Equivalent to passing `--log-level debug` on the command line. CLI flags take precedence over the environment variable.

```bash
export SENTRY_LOG_LEVEL=debug
```


### `SENTRY_CLI_NO_TELEMETRY`

Disable CLI telemetry (error tracking for the CLI itself). The CLI sends anonymized error reports to help improve reliability — set this to opt out.

```bash
export SENTRY_CLI_NO_TELEMETRY=1
```


### `SENTRY_CLI_NO_UPDATE_CHECK`

Disable the automatic update check that runs periodically in the background.

```bash
export SENTRY_CLI_NO_UPDATE_CHECK=1
```


### `SENTRY_NO_CACHE`

Disable API response caching. When set, the CLI will not cache API responses and will always make fresh requests.

```bash
export SENTRY_NO_CACHE=1
```


### `SENTRY_MAX_PAGINATION_PAGES`

Cap the maximum number of pages fetched during auto-pagination. Useful for limiting API calls when using large `--limit` values.

```bash
export SENTRY_MAX_PAGINATION_PAGES=10
```


### `SENTRY_CLI_NO_AUTO_REPAIR`

Disable automatic database schema repair. By default, the CLI automatically repairs its SQLite database when it detects schema drift. Set this to `1` to prevent auto-repair.

```bash
export SENTRY_CLI_NO_AUTO_REPAIR=1
```


## Configuration File (`.sentryclirc`)

The CLI supports a `.sentryclirc` config file using standard INI syntax. This is the same format used by the legacy `sentry-cli` tool, so existing config files are automatically picked up.

### How It Works

The CLI looks for `.sentryclirc` files by walking up from your current directory toward the filesystem root. If multiple files are found, values from the closest file take priority, with `~/.sentryclirc` serving as a global fallback.

```ini
[defaults]
org = my-org
project = my-project


[auth]
token = sntrys_...
```


### Supported Fields

| Section | Key | Description |
| --- | --- | --- |
| `[defaults]` | `org` | Default organization slug |
| `[defaults]` | `project` | Default project slug |
| `[defaults]` | `url` | Sentry base URL (for self-hosted) |
| `[auth]` | `token` | Auth token (mapped to `SENTRY_AUTH_TOKEN`) |

### Monorepo Setup

In monorepos, place a `.sentryclirc` at the repo root with your org, then add per-package configs with just the project:

```plaintext
my-monorepo/
  .sentryclirc              # [defaults] org = my-company
  packages/
    frontend/
      .sentryclirc          # [defaults] project = frontend-web
    backend/
      .sentryclirc          # [defaults] project = backend-api
```


When you run a command from `packages/frontend/`, the CLI resolves `org = my-company` from the root and `project = frontend-web` from the closest file.

### Resolution Priority

When the CLI needs to determine your org and project, it checks these sources in order:

1. **Explicit CLI arguments** — `sentry issue list my-org/my-project`
2. **Environment variables** — `SENTRY_ORG` / `SENTRY_PROJECT`
3. **`.sentryclirc` config file** — walked up from CWD, merged with `~/.sentryclirc`
4. **Persistent defaults** — set via `sentry cli defaults`
5. **DSN auto-detection** — scans source code and `.env` files
6. **Directory name inference** — matches your directory name against project slugs

The first source that provides both org and project wins. For org-only commands, only the org is needed.

### Backward Compatibility

If you previously used the legacy `sentry-cli` and have a `~/.sentryclirc` file, the new CLI reads it automatically. The `[defaults]` and `[auth]` sections are fully compatible. The `[auth] token` value is mapped to the `SENTRY_AUTH_TOKEN` environment variable internally (only if the env var is not already set).

## Persistent Defaults

Use `sentry cli defaults` to set persistent defaults for organization, project, URL, and telemetry. These are stored in the CLI's local database and apply to all commands.

```bash
sentry cli defaults org my-org           # Set default organization
sentry cli defaults project my-project   # Set default project
sentry cli defaults url https://...      # Set Sentry URL (self-hosted)
sentry cli defaults telemetry off        # Disable telemetry
sentry cli defaults                      # Show all current defaults
sentry cli defaults org --clear          # Clear a specific default
```


See [`sentry cli defaults`](https://cli.sentry.dev/_preview/pr-1287/configuration/commands/cli.md#sentry-cli-defaults) for full usage.

## Global Options

These flags are accepted by every command. They are not shown in individual command `--help` output, but are always available.

### `--log-level <level>`

Set the log verbosity level. Accepts: `error`, `warn`, `log`, `info`, `debug`, `trace`.

```bash
sentry issue list --log-level debug
sentry --log-level=trace cli upgrade
```


Overrides `SENTRY_LOG_LEVEL` when both are set.

### `--verbose`

Shorthand for `--log-level debug`. Enables debug-level diagnostic output.

```bash
sentry issue list --verbose
```


Note

The `sentry api` command also uses `--verbose` to show full HTTP request/response details. When used with `sentry api`, it serves both purposes (debug logging + HTTP output).

## Credential Storage

We store credentials and caches in a SQLite database (`cli.db`) inside the config directory (`~/.sentry/` by default, overridable via `SENTRY_CONFIG_DIR`). The database file and its WAL side-files are created with restricted permissions (mode 600) so that only the current user can read them. The database also caches:

- Organization and project defaults
- DSN resolution results
- Region URL mappings
- Project aliases (for monorepo support)

See [Credential Storage](https://cli.sentry.dev/_preview/pr-1287/configuration/commands/auth.md#credential-storage) in the auth command docs for more details.

## Navigation

- [Docs home](https://cli.sentry.dev/_preview/pr-1287/index.md)
- [Previous: Self-Hosted](https://cli.sentry.dev/_preview/pr-1287/self-hosted.md)
- [Next: Library Usage](https://cli.sentry.dev/_preview/pr-1287/library-usage.md)
