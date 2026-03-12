---
title: auth
description: Authentication commands for the Sentry CLI
---

Manage authentication for the Sentry CLI.

## Commands

### `sentry auth login`

Authenticate with Sentry.

```bash
# OAuth device flow (recommended)
sentry auth login

# Using an API token
sentry auth login --token YOUR_TOKEN
```

**Options:**

| Option | Description |
|--------|-------------|
| `--token <token>` | Use an API token instead of OAuth |

**OAuth Flow:**

1. Run `sentry auth login`
2. A URL and code will be displayed
3. Open the URL in your browser
4. Enter the code when prompted
5. Authorize the application
6. The CLI automatically receives your token

**Self-Hosted Sentry (26.1.0+):**

For self-hosted instances, set `SENTRY_URL` and `SENTRY_CLIENT_ID` (from a public OAuth application you create on your instance):

```bash
SENTRY_URL=https://sentry.example.com SENTRY_CLIENT_ID=your-client-id sentry auth login
```

On older versions or without an OAuth application, use an API token instead:

```bash
SENTRY_URL=https://sentry.example.com sentry auth login --token YOUR_TOKEN
```

See [Self-Hosted Sentry](../self-hosted/) for full setup details.

### `sentry auth logout`

Remove stored credentials.

```bash
sentry auth logout
```

### `sentry auth status`

Check your authentication status.

```bash
sentry auth status
```

**Output:**

```
Authenticated as: username
Organization: my-org
Token expires: 2024-12-31
```

### `sentry auth refresh`

Refresh your OAuth token.

```bash
sentry auth refresh
```

This is typically handled automatically when tokens expire.

## Credential Storage

We store credentials in a SQLite database at `~/.sentry/cli.db` with restricted file permissions (mode 600). The database uses a single-row `auth` table with the following columns:

| Column | Type | Description |
|--------|------|-------------|
| `token` | TEXT | OAuth access token |
| `refresh_token` | TEXT | OAuth refresh token |
| `expires_at` | INTEGER | Token expiry (ms since epoch) |
| `issued_at` | INTEGER | Token issue time (ms since epoch) |
| `updated_at` | INTEGER | Last modification time (ms since epoch) |

### Environment Variable Precedence

The CLI checks for auth tokens in the following order, using the first one found:

1. `SENTRY_AUTH_TOKEN` environment variable
2. `SENTRY_TOKEN` environment variable (legacy)
3. The `auth` table in the SQLite database

When a token comes from an environment variable, the CLI skips expiry checks and automatic refresh.

### Reading the Token Externally

Other tools can read the stored token directly from the database. The config directory defaults to `~/.sentry/` but can be overridden with the `SENTRY_CONFIG_DIR` environment variable.

```bash
sqlite3 ~/.sentry/cli.db "SELECT token FROM auth WHERE id = 1;"
```

Keep in mind a few caveats when accessing the database from outside the CLI:

- **Token expiry** — Check `expires_at` before using the token. The CLI automatically refreshes tokens when they are close to expiring, but an external reader will not trigger a refresh.
- **WAL mode** — The database uses SQLite WAL (Write-Ahead Logging). Open it in read-only mode to avoid lock contention with a running CLI process.
- **Env var precedence** — If `SENTRY_AUTH_TOKEN` or `SENTRY_TOKEN` is set, the CLI uses that instead of the database value. We recommend following the same precedence in external tools.
