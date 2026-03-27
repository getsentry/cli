---
title: auth
description: Auth commands for the Sentry CLI
---

Authenticate with Sentry

## Commands

### `sentry auth login`

Authenticate with Sentry

**Options:**

| Option | Description |
|--------|-------------|
| `--token <token>` | Authenticate using an API token instead of OAuth |
| `--timeout <timeout>` | Timeout for OAuth flow in seconds (default: 900) |
| `--force` | Re-authenticate without prompting |

### `sentry auth logout`

Log out of Sentry

### `sentry auth refresh`

Refresh your authentication token

**Options:**

| Option | Description |
|--------|-------------|
| `--force` | Force refresh even if token is still valid |

### `sentry auth status`

View authentication status

**Options:**

| Option | Description |
|--------|-------------|
| `--show-token` | Show the stored token (masked by default) |
| `-f, --fresh` | Bypass cache, re-detect projects, and fetch fresh data |

### `sentry auth token`

Print the stored authentication token

### `sentry auth whoami`

Show the currently authenticated user

**Options:**

| Option | Description |
|--------|-------------|
| `-f, --fresh` | Bypass cache, re-detect projects, and fetch fresh data |

All commands support `--json` for machine-readable output and `--fields` to select specific JSON fields.

<!-- GENERATED:END -->

## Examples

```bash
# OAuth login (recommended)
sentry auth login

# Login with an API token
sentry auth login --token YOUR_SENTRY_API_TOKEN

# Check auth status
sentry auth status

# Show the raw token
sentry auth status --show-token

# View current user
sentry auth whoami
```

## Credential Storage

Auth tokens are stored securely in a local SQLite database at `~/.sentry/config.db`.
