---
title: Configuration
description: Environment variables, config files, and configuration options for the Sentry CLI
---

The Sentry CLI can be configured through config files, environment variables, and a local database. Most users don't need to set any of these — the CLI auto-detects your project from your codebase and stores credentials locally after `sentry auth login`.

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
|---------|-----|-------------|
| `[defaults]` | `org` | Default organization slug |
| `[defaults]` | `project` | Default project slug |
| `[defaults]` | `url` | Sentry base URL (for self-hosted) |
| `[auth]` | `token` | Auth token (mapped to `SENTRY_AUTH_TOKEN`) |

### Monorepo Setup

In monorepos, place a `.sentryclirc` at the repo root with your org, then add per-package configs with just the project:

```
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
4. **DSN auto-detection** — scans source code and `.env` files
5. **Directory name inference** — matches your directory name against project slugs

The first source that provides both org and project wins. For org-only commands, only the org is needed.

### Backward Compatibility

If you previously used the legacy `sentry-cli` and have a `~/.sentryclirc` file, the new CLI reads it automatically. The `[defaults]` and `[auth]` sections are fully compatible. The `[auth] token` value is mapped to the `SENTRY_AUTH_TOKEN` environment variable internally (only if the env var is not already set).

## Environment Variables

### `SENTRY_AUTH_TOKEN`

Authentication token for the Sentry API. This is the primary way to authenticate in CI/CD pipelines and scripts where interactive login is not possible.

```bash
export SENTRY_AUTH_TOKEN=sntrys_YOUR_TOKEN_HERE
```

You can create auth tokens in your [Sentry account settings](https://sentry.io/settings/account/api/auth-tokens/). When set, this takes precedence over any stored OAuth token from `sentry auth login`.

### `SENTRY_TOKEN`

Legacy alias for `SENTRY_AUTH_TOKEN`. If both are set, `SENTRY_AUTH_TOKEN` takes precedence.

### `SENTRY_HOST`

Base URL of your Sentry instance. **Only needed for [self-hosted Sentry](./self-hosted/).** SaaS users (sentry.io) should not set this.

```bash
export SENTRY_HOST=https://sentry.example.com
```

When set, all API requests (including OAuth login) are directed to this URL instead of `https://sentry.io`. The CLI also sets this automatically when you pass a self-hosted Sentry URL as a command argument.

`SENTRY_HOST` takes precedence over `SENTRY_URL`. Both work identically — use whichever you prefer.

### `SENTRY_URL`

Alias for `SENTRY_HOST`. If both are set, `SENTRY_HOST` takes precedence.

### `SENTRY_ORG`

Default organization slug. Skips organization auto-detection.

```bash
export SENTRY_ORG=my-org
```

### `SENTRY_PROJECT`

Default project slug. Can also include the org in `org/project` format.

```bash
# Project only (requires SENTRY_ORG or auto-detection for the org)
export SENTRY_PROJECT=my-project

# Org and project together
export SENTRY_PROJECT=my-org/my-project
```

When using the `org/project` combo format, `SENTRY_ORG` is ignored.

### `SENTRY_DSN`

Sentry DSN for project auto-detection. This is the same DSN you use in `Sentry.init()`. The CLI resolves it to determine your organization and project.

```bash
export SENTRY_DSN=https://key@o123.ingest.us.sentry.io/456
```

The CLI also detects DSNs from `.env` files and source code automatically — see [DSN Auto-Detection](./features/#dsn-auto-detection).

### `SENTRY_CLIENT_ID`

Client ID of a public OAuth application on your Sentry instance. **Required for [self-hosted Sentry](./self-hosted/)** (26.1.0+) to use `sentry auth login` with the device flow. See the [Self-Hosted guide](./self-hosted/#1-create-a-public-oauth-application) for how to create one.

```bash
export SENTRY_CLIENT_ID=your-oauth-client-id
```

### `SENTRY_CONFIG_DIR`

Override the directory where the CLI stores its database (credentials, caches, defaults). Defaults to `~/.sentry/`.

```bash
export SENTRY_CONFIG_DIR=/path/to/config
```

### `SENTRY_VERSION`

Pin a specific version for the [install script](./getting-started/#install-script). Accepts a version number (e.g., `0.19.0`) or `nightly`. The `--version` flag takes precedence if both are set.

```bash
SENTRY_VERSION=nightly curl https://cli.sentry.dev/install -fsS | bash
```

This is useful in CI/CD pipelines and Dockerfiles where you want reproducible installations without inline flags.

### `SENTRY_PLAIN_OUTPUT`

Force plain text output (no colors or ANSI formatting). Takes precedence over `NO_COLOR`.

```bash
export SENTRY_PLAIN_OUTPUT=1
```

### `NO_COLOR`

Standard convention to disable color output. See [no-color.org](https://no-color.org/). Respected when `SENTRY_PLAIN_OUTPUT` is not set.

```bash
export NO_COLOR=1
```

### `SENTRY_CLI_NO_TELEMETRY`

Disable CLI telemetry (error tracking for the CLI itself). The CLI sends anonymized error reports to help improve reliability — set this to opt out.

```bash
export SENTRY_CLI_NO_TELEMETRY=1
```

### `SENTRY_LOG_LEVEL`

Controls the verbosity of diagnostic output. Defaults to `info`.

Valid values: `error`, `warn`, `log`, `info`, `debug`, `trace`

```bash
export SENTRY_LOG_LEVEL=debug
```

Equivalent to passing `--log-level debug` on the command line. CLI flags take precedence over the environment variable.

### `SENTRY_CLI_NO_UPDATE_CHECK`

Disable the automatic update check that runs periodically in the background.

```bash
export SENTRY_CLI_NO_UPDATE_CHECK=1
```

### `SENTRY_INSTALL_DIR`

Override the directory where the CLI binary is installed. Used by the install script and `sentry cli upgrade` to control the binary location.

```bash
export SENTRY_INSTALL_DIR=/usr/local/bin
```

### `SENTRY_NO_CACHE`

Disable API response caching. When set, the CLI will not cache API responses and will always make fresh requests.

```bash
export SENTRY_NO_CACHE=1
```

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

:::note
The `sentry api` command also uses `--verbose` to show full HTTP request/response details. When used with `sentry api`, it serves both purposes (debug logging + HTTP output).
:::

## Credential Storage

We store credentials and caches in a SQLite database (`cli.db`) inside the config directory (`~/.sentry/` by default, overridable via `SENTRY_CONFIG_DIR`). The database file and its WAL side-files are created with restricted permissions (mode 600) so that only the current user can read them. The database also caches:

- Organization and project defaults
- DSN resolution results
- Region URL mappings
- Project aliases (for monorepo support)

See [Credential Storage](./commands/auth/#credential-storage) in the auth command docs for more details.
