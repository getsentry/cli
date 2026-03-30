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

### OAuth login (recommended)

```bash
sentry auth login
```

1. A URL and device code will be displayed
2. Open the URL in your browser
3. Enter the code when prompted
4. Authorize the application
5. The CLI automatically receives your token

### Token login

```bash
sentry auth login --token YOUR_SENTRY_API_TOKEN
```

### Self-hosted Sentry

```bash
SENTRY_URL=https://sentry.example.com sentry auth login
```

For token-based auth with self-hosted:

```bash
SENTRY_URL=https://sentry.example.com sentry auth login --token YOUR_TOKEN
```

See [Self-Hosted Sentry](../self-hosted/) for details.

### Logout

```bash
sentry auth logout
```

### Refresh token

```bash
sentry auth refresh
```

### Print stored token

```bash
sentry auth token
```

### Check auth status

```bash
sentry auth status
```

```
Authenticated as: username
Organization: my-org
Token expires: 2024-12-31
```

```bash
# Show the raw token
sentry auth status --show-token

# View current user
sentry auth whoami
```

## Credential Storage

Auth tokens are stored in a SQLite database at `~/.sentry/cli.db` with restricted file permissions.

## Environment Variable Precedence

The CLI checks for auth tokens in the following order, using the first one found:

1. `SENTRY_AUTH_TOKEN` environment variable
2. `SENTRY_TOKEN` environment variable (legacy alias)
3. The stored OAuth token in the SQLite database

When a token comes from an environment variable, the CLI skips expiry checks and automatic refresh.
