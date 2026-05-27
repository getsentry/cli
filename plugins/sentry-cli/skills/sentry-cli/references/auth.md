---
name: sentry-cli-auth
version: 0.35.0-dev.0
description: Authenticate with Sentry
requires:
  bins: ["sentry"]
  auth: true
---

# Auth Commands

Authenticate with Sentry

### `sentry auth login`

Authenticate with Sentry

**Flags:**
- `--token <value> - Authenticate using an API token instead of OAuth`
- `--timeout <value> - Timeout for OAuth flow in seconds (default: 900) - (default: "900")`
- `--force - Re-authenticate without prompting`
- `--url <value> - Sentry instance URL to authenticate against (e.g. https://sentry.example.com). Required for self-hosted; defaults to SaaS (https://sentry.io).`

### `sentry auth logout`

Log out of Sentry

### `sentry auth refresh`

Refresh your authentication token

**Flags:**
- `--force - Force refresh even if token is still valid`

### `sentry auth status`

View authentication status

**Flags:**
- `--show-token - Show the stored token (masked by default)`
- `-f, --fresh - Bypass cache, re-detect projects, and fetch fresh data`

### `sentry auth token`

Print the stored authentication token

### `sentry auth whoami`

Show the currently authenticated identity

**Flags:**
- `-f, --fresh - Bypass cache, re-detect projects, and fetch fresh data`

All commands also support `--json`, `--fields`, `--help`, `--log-level`, and `--verbose` flags.
