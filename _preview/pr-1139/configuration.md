---
title: "Configuration"
description: "Environment variables, config files, and configuration options for the Sentry CLI"
url: "https://cli.sentry.dev/_preview/pr-1139/configuration/"
---

# Configuration

The Sentry CLI can be configured through config files, environment variables, and a local database. Most users don't need to set any of these — the CLI auto-detects your project from your codebase and stores credentials locally after `sentry auth login`.

## Environment Variables

[Section titled “Environment Variables”](#environment-variables)

### `SENTRY_AUTH_TOKEN`

[Section titled “SENTRY_AUTH_TOKEN”](#sentry_auth_token)

Authentication token for the Sentry API. This is the primary way to authenticate in CI/CD pipelines and scripts where interactive login is not possible.

You can create auth tokens in your [Sentry account settings](https://sentry.io/settings/account/api/auth-tokens/). When a stored OAuth login from `sentry auth login` also exists, the stored login takes priority — set `SENTRY_FORCE_ENV_TOKEN=1` to override.

Terminal window

```
export SENTRY_AUTH_TOKEN=sntrys_YOUR_TOKEN_HERE
```


### `SENTRY_TOKEN`

[Section titled “SENTRY_TOKEN”](#sentry_token)

Legacy alias for `SENTRY_AUTH_TOKEN`. If both are set, `SENTRY_AUTH_TOKEN` takes precedence.

### `SENTRY_FORCE_ENV_TOKEN`

[Section titled “SENTRY_FORCE_ENV_TOKEN”](#sentry_force_env_token)

When set, environment variable tokens (`SENTRY_AUTH_TOKEN` / `SENTRY_TOKEN`) take precedence over the stored OAuth token from `sentry auth login`. By default, the stored OAuth token takes priority because it supports automatic refresh. Set this if you want to ensure the environment variable token is always used, which is useful for self-hosted setups or CI environments.

Terminal window

```
export SENTRY_FORCE_ENV_TOKEN=1
```


### `SENTRY_ORG`

[Section titled “SENTRY_ORG”](#sentry_org)

Default organization slug. Skips organization auto-detection.

Terminal window

```
export SENTRY_ORG=my-org
```


### `SENTRY_PROJECT`

[Section titled “SENTRY_PROJECT”](#sentry_project)

Default project slug. Can also include the org in `org/project` format.

When using the `org/project` combo format, `SENTRY_ORG` is ignored.

Terminal window

```
export SENTRY_PROJECT=my-org/my-project
```


### `SENTRY_DSN`

[Section titled “SENTRY_DSN”](#sentry_dsn)

Sentry DSN for project auto-detection. This is the same DSN you use in `Sentry.init()`. The CLI resolves it to determine your organization and project.

The CLI also detects DSNs from `.env` files and source code automatically — see [DSN Auto-Detection](https://cli.sentry.dev/_preview/pr-1139/configuration/features.md#dsn-auto-detection).

Terminal window

```
export SENTRY_DSN=https://key@o123.ingest.us.sentry.io/456
```


### `SENTRY_RELEASE`

[Section titled “SENTRY_RELEASE”](#sentry_release)

Explicit release version for `sentry release propose-version`. When set, the command returns this value immediately without checking CI environment variables or local git history. Useful in CI pipelines where the release version is determined by a prior step.

Terminal window

```
export SENTRY_RELEASE=1.0.0
```


### `SENTRY_HOST`

[Section titled “SENTRY_HOST”](#sentry_host)

Base URL of your Sentry instance. **Only needed for [self-hosted Sentry](https://cli.sentry.dev/_preview/pr-1139/configuration/self-hosted.md).** SaaS users (sentry.io) should not set this.

When set, all API requests (including OAuth login) are directed to this URL instead of `https://sentry.io`. The CLI also sets this automatically when you pass a self-hosted Sentry URL as a command argument.

`SENTRY_HOST` takes precedence over `SENTRY_URL`. Both work identically — use whichever you prefer.

Terminal window

```
export SENTRY_HOST=https://sentry.example.com
```


### `SENTRY_URL`

[Section titled “SENTRY_URL”](#sentry_url)

Alias for `SENTRY_HOST`. If both are set, `SENTRY_HOST` takes precedence.

### `SENTRY_CLIENT_ID`

[Section titled “SENTRY_CLIENT_ID”](#sentry_client_id)

Client ID of a public OAuth application on your Sentry instance. **Required for [self-hosted Sentry](https://cli.sentry.dev/_preview/pr-1139/configuration/self-hosted.md)** (26.1.0+) to use `sentry auth login` with the device flow. See the [Self-Hosted guide](https://cli.sentry.dev/_preview/pr-1139/configuration/self-hosted.md#1-create-a-public-oauth-application) for how to create one.

Terminal window

```
export SENTRY_CLIENT_ID=your-oauth-client-id
```


### `SENTRY_CUSTOM_HEADERS`

[Section titled “SENTRY_CUSTOM_HEADERS”](#sentry_custom_headers)

Custom HTTP headers to include in all requests to your Sentry instance. **Only applies to [self-hosted Sentry](https://cli.sentry.dev/_preview/pr-1139/configuration/self-hosted.md).** Ignored when targeting sentry.io.

Use semicolon-separated `Name: Value` pairs. Useful for environments behind reverse proxies that require additional headers for authentication (e.g., Google IAP, Cloudflare Access).

Can also be set persistently with `sentry cli defaults headers`.

Terminal window

```
export SENTRY_CUSTOM_HEADERS="X-IAP-Token: my-proxy-token"
```


### `SENTRY_CONFIG_DIR`

[Section titled “SENTRY_CONFIG_DIR”](#sentry_config_dir)

Override the directory where the CLI stores its database (credentials, caches, defaults). Defaults to `~/.sentry/`.

Terminal window

```
export SENTRY_CONFIG_DIR=/path/to/config
```


### `SENTRY_INSTALL_DIR`

[Section titled “SENTRY_INSTALL_DIR”](#sentry_install_dir)

Override the directory where the CLI binary is installed. Used by the install script and `sentry cli upgrade` to control the binary location.

Terminal window

```
export SENTRY_INSTALL_DIR=/usr/local/bin
```


### `SENTRY_VERSION`

[Section titled “SENTRY_VERSION”](#sentry_version)

Pin a specific version for the [install script](https://cli.sentry.dev/_preview/pr-1139/configuration/getting-started.md#install-script). Accepts a version number (e.g., `0.19.0`) or `nightly`. The `--version` flag takes precedence if both are set.

This is useful in CI/CD pipelines and Dockerfiles where you want reproducible installations without inline flags.

Terminal window

```
export SENTRY_VERSION=nightly
```


### `SENTRY_INIT`

[Section titled “SENTRY_INIT”](#sentry_init)

Used with the install script. When set to `1`, the installer runs `sentry init` after installing the binary to guide you through project setup.

Terminal window

```
export SENTRY_INIT=1
```


### `SENTRY_INIT_TUI`

[Section titled “SENTRY_INIT_TUI”](#sentry_init_tui)

Control the TUI (terminal user interface) for `sentry init`. Set to `0` to disable the interactive TUI and use plain text logging output instead. Useful in CI/CD pipelines or environments without full terminal support.

Terminal window

```
export SENTRY_INIT_TUI=0
```


### `NODE_EXTRA_CA_CERTS`

[Section titled “NODE_EXTRA_CA_CERTS”](#node_extra_ca_certs)

Path to a PEM file containing additional CA certificates to trust. Useful behind corporate TLS-intercepting proxies (Zscaler, Netskope, etc.).

Can also be set persistently with `sentry cli defaults ca-cert`.

Terminal window

```
export NODE_EXTRA_CA_CERTS=/path/to/corporate-ca.pem
```


### `SENTRY_PLAIN_OUTPUT`

[Section titled “SENTRY_PLAIN_OUTPUT”](#sentry_plain_output)

Force plain text output (no colors or ANSI formatting). Takes precedence over `NO_COLOR`.

Terminal window

```
export SENTRY_PLAIN_OUTPUT=1
```


### `NO_COLOR`

[Section titled “NO_COLOR”](#no_color)

Standard convention to disable color output. See [no-color.org](https://no-color.org/). Respected when `SENTRY_PLAIN_OUTPUT` is not set.

Terminal window

```
export NO_COLOR=1
```


### `FORCE_COLOR`

[Section titled “FORCE_COLOR”](#force_color)

Force color output on interactive terminals. Only takes effect when stdout is a TTY. Set to `0` to force plain output, `1` to force color. Ignored when stdout is piped.

Terminal window

```
export FORCE_COLOR=1
```


### `SENTRY_OUTPUT_FORMAT`

[Section titled “SENTRY_OUTPUT_FORMAT”](#sentry_output_format)

Force the output format for all commands. Currently only `json` is supported. This is primarily used by the [library API](https://cli.sentry.dev/_preview/pr-1139/configuration/library-usage.md) (`createSentrySDK()`) to get JSON output without passing `--json` flags.

Terminal window

```
export SENTRY_OUTPUT_FORMAT=json
```


### `SENTRY_LOG_LEVEL`

[Section titled “SENTRY_LOG_LEVEL”](#sentry_log_level)

Controls the verbosity of diagnostic output. Defaults to `info`.

Valid values: `error`, `warn`, `log`, `info`, `debug`, `trace`

Equivalent to passing `--log-level debug` on the command line. CLI flags take precedence over the environment variable.

Terminal window

```
export SENTRY_LOG_LEVEL=debug
```


### `SENTRY_CLI_NO_TELEMETRY`

[Section titled “SENTRY_CLI_NO_TELEMETRY”](#sentry_cli_no_telemetry)

Disable CLI telemetry (error tracking for the CLI itself). The CLI sends anonymized error reports to help improve reliability — set this to opt out.

Terminal window

```
export SENTRY_CLI_NO_TELEMETRY=1
```


### `SENTRY_CLI_NO_UPDATE_CHECK`

[Section titled “SENTRY_CLI_NO_UPDATE_CHECK”](#sentry_cli_no_update_check)

Disable the automatic update check that runs periodically in the background.

Terminal window

```
export SENTRY_CLI_NO_UPDATE_CHECK=1
```


### `SENTRY_NO_CACHE`

[Section titled “SENTRY_NO_CACHE”](#sentry_no_cache)

Disable API response caching. When set, the CLI will not cache API responses and will always make fresh requests.

Terminal window

```
export SENTRY_NO_CACHE=1
```


### `SENTRY_MAX_PAGINATION_PAGES`

[Section titled “SENTRY_MAX_PAGINATION_PAGES”](#sentry_max_pagination_pages)

Cap the maximum number of pages fetched during auto-pagination. Useful for limiting API calls when using large `--limit` values.

Terminal window

```
export SENTRY_MAX_PAGINATION_PAGES=10
```


### `SENTRY_CLI_NO_AUTO_REPAIR`

[Section titled “SENTRY_CLI_NO_AUTO_REPAIR”](#sentry_cli_no_auto_repair)

Disable automatic database schema repair. By default, the CLI automatically repairs its SQLite database when it detects schema drift. Set this to `1` to prevent auto-repair.

Terminal window

```
export SENTRY_CLI_NO_AUTO_REPAIR=1
```


## Configuration File (`.sentryclirc`)

[Section titled “Configuration File (.sentryclirc)”](#configuration-file-sentryclirc)

The CLI supports a `.sentryclirc` config file using standard INI syntax. This is the same format used by the legacy `sentry-cli` tool, so existing config files are automatically picked up.

### How It Works

[Section titled “How It Works”](#how-it-works)

The CLI looks for `.sentryclirc` files by walking up from your current directory toward the filesystem root. If multiple files are found, values from the closest file take priority, with `~/.sentryclirc` serving as a global fallback.

```
[defaults]org = my-orgproject = my-project
[auth]token = sntrys_...
```


### Supported Fields

[Section titled “Supported Fields”](#supported-fields)

| Section | Key | Description |
| --- | --- | --- |
| `[defaults]` | `org` | Default organization slug |
| `[defaults]` | `project` | Default project slug |
| `[defaults]` | `url` | Sentry base URL (for self-hosted) |
| `[auth]` | `token` | Auth token (mapped to `SENTRY_AUTH_TOKEN`) |

### Monorepo Setup

[Section titled “Monorepo Setup”](#monorepo-setup)

In monorepos, place a `.sentryclirc` at the repo root with your org, then add per-package configs with just the project:

```
my-monorepo/  .sentryclirc              # [defaults] org = my-company  packages/    frontend/      .sentryclirc          # [defaults] project = frontend-web    backend/      .sentryclirc          # [defaults] project = backend-api
```


When you run a command from `packages/frontend/`, the CLI resolves `org = my-company` from the root and `project = frontend-web` from the closest file.

### Resolution Priority

[Section titled “Resolution Priority”](#resolution-priority)

When the CLI needs to determine your org and project, it checks these sources in order:

1. **Explicit CLI arguments** — `sentry issue list my-org/my-project`
2. **Environment variables** — `SENTRY_ORG` / `SENTRY_PROJECT`
3. **`.sentryclirc` config file** — walked up from CWD, merged with `~/.sentryclirc`
4. **Persistent defaults** — set via `sentry cli defaults`
5. **DSN auto-detection** — scans source code and `.env` files
6. **Directory name inference** — matches your directory name against project slugs

The first source that provides both org and project wins. For org-only commands, only the org is needed.

### Backward Compatibility

[Section titled “Backward Compatibility”](#backward-compatibility)

If you previously used the legacy `sentry-cli` and have a `~/.sentryclirc` file, the new CLI reads it automatically. The `[defaults]` and `[auth]` sections are fully compatible. The `[auth] token` value is mapped to the `SENTRY_AUTH_TOKEN` environment variable internally (only if the env var is not already set).

## Persistent Defaults

[Section titled “Persistent Defaults”](#persistent-defaults)

Use `sentry cli defaults` to set persistent defaults for organization, project, URL, and telemetry. These are stored in the CLI's local database and apply to all commands.

Terminal window

```
sentry cli defaults org my-org           # Set default organizationsentry cli defaults project my-project   # Set default projectsentry cli defaults url https://...      # Set Sentry URL (self-hosted)sentry cli defaults telemetry off        # Disable telemetrysentry cli defaults                      # Show all current defaultssentry cli defaults org --clear          # Clear a specific default
```


See [`sentry cli defaults`](https://cli.sentry.dev/_preview/pr-1139/configuration/commands/cli.md#sentry-cli-defaults) for full usage.

## Global Options

[Section titled “Global Options”](#global-options)

These flags are accepted by every command. They are not shown in individual command `--help` output, but are always available.

### `--log-level <level>`

[Section titled “--log-level <level>”](#--log-level-level)

Set the log verbosity level. Accepts: `error`, `warn`, `log`, `info`, `debug`, `trace`.

Terminal window

```
sentry issue list --log-level debugsentry --log-level=trace cli upgrade
```


Overrides `SENTRY_LOG_LEVEL` when both are set.

### `--verbose`

[Section titled “--verbose”](#--verbose)

Shorthand for `--log-level debug`. Enables debug-level diagnostic output.

Terminal window

```
sentry issue list --verbose
```


Note

The `sentry api` command also uses `--verbose` to show full HTTP request/response details. When used with `sentry api`, it serves both purposes (debug logging + HTTP output).

## Credential Storage

[Section titled “Credential Storage”](#credential-storage)

We store credentials and caches in a SQLite database (`cli.db`) inside the config directory (`~/.sentry/` by default, overridable via `SENTRY_CONFIG_DIR`). The database file and its WAL side-files are created with restricted permissions (mode 600) so that only the current user can read them. The database also caches:

- Organization and project defaults
- DSN resolution results
- Region URL mappings
- Project aliases (for monorepo support)

See [Credential Storage](https://cli.sentry.dev/_preview/pr-1139/configuration/commands/auth.md#credential-storage) in the auth command docs for more details.
