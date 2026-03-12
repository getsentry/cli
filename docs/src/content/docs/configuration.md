---
title: Configuration
description: Environment variables and configuration options for the Sentry CLI
---

The Sentry CLI can be configured through environment variables and a local database. Most users don't need to set any of these — the CLI auto-detects your project from your codebase and stores credentials locally after `sentry auth login`.

## Environment Variables

### `SENTRY_URL`

Base URL of your Sentry instance. **Only needed for [self-hosted Sentry](./self-hosted/).** SaaS users (sentry.io) should not set this.

```bash
export SENTRY_URL=https://sentry.example.com
```

When set, all API requests (including OAuth login) are directed to this URL instead of `https://sentry.io`. The CLI also sets this automatically when you pass a self-hosted Sentry URL as a command argument.

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

Other tools can query the database directly to inspect stored credentials and cached data. See [Credential Storage](./commands/auth/#credential-storage) in the auth command docs for the full schema and access details.
