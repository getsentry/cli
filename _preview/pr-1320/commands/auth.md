---
title: "auth"
description: "Auth commands for the Sentry CLI"
url: "https://cli.sentry.dev/_preview/pr-1320/commands/auth/"
---

# auth

Authenticate with Sentry

## Commands

### `sentry auth login`

Authenticate with Sentry

**Options:**

| Option | Description |
| --- | --- |
| `--token <token>` | Authenticate using an API token instead of OAuth |
| `--timeout <timeout>` | Timeout for OAuth flow in seconds (default: 900) |
| `--force` | Re-authenticate without prompting |
| `--url <url>` | Sentry instance URL to authenticate against (e.g. [https://sentry.example.com](https://sentry.example.com)). Required for self-hosted; defaults to SaaS ([https://sentry.io](https://sentry.io)). |
| `--read-only` | Request only read-only OAuth scopes (project:read, org:read, event:read, member:read, team:read). Useful for handing tokens to AI agents or CI jobs that should not be able to mutate Sentry state. |
| `-s, --scope <scope>...` | Request specific OAuth scopes (repeatable, comma-separated). E.g. --scope project:read --scope org:read. Overrides the default scope set. |

### `sentry auth logout`

Log out of Sentry

### `sentry auth refresh`

Refresh your OAuth access token

**Options:**

| Option | Description |
| --- | --- |
| `--force` | Force refresh even if the access token is still valid |
| `--read-only` | Re-authenticate with read-only OAuth scopes (project:read, org:read, event:read, member:read, team:read) |
| `-s, --scope <scope>...` | Re-authenticate with specific OAuth scopes (repeatable, comma-separated). E.g. --scope project:read --scope org:read |

### `sentry auth status`

View authentication status

**Options:**

| Option | Description |
| --- | --- |
| `--show-token` | Show the stored token (masked by default) |
| `-f, --fresh` | Bypass cache, re-detect projects, and fetch fresh data |

### `sentry auth token`

Print the stored authentication token

### `sentry auth whoami`

Show the currently authenticated identity

**Options:**

| Option | Description |
| --- | --- |
| `-f, --fresh` | Bypass cache, re-detect projects, and fetch fresh data |

All commands support `--json` for machine-readable output and `--fields` to select specific JSON fields.

## Examples

### OAuth login (recommended)

```bash
sentry auth login
```


1. A URL and device code will be displayed
2. Open the URL in your browser
3. Enter the code when prompted
4. Authorize the application
5. The CLI stores the OAuth credentials and, when the server provides a refresh
   token, automatically refreshes the access token

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


See [Self-Hosted Sentry](https://cli.sentry.dev/_preview/pr-1320/commands/self-hosted.md) for details.

### Logout

```bash
sentry auth logout
```


### Refresh the OAuth access token

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


```plaintext
✓ Authenticated
User: username
Access token expires: in 4 weeks
Automatic refresh: enabled
```


```bash
# Show the raw token
sentry auth status --show-token


# View current user
sentry auth whoami
```


## Credential Storage

Auth tokens are stored in the Sentry CLI configuration directory (`~/.sentry/` by default, overridable with `SENTRY_CONFIG_DIR`) with restricted file permissions.

OAuth access tokens expire. When the server provides a refresh token, the CLI stores it and refreshes the access token automatically. Persist the configuration directory across runs to keep automatic refresh working. For ephemeral CI jobs or sandboxes that cannot persist stored credentials, provide an API token with `sentry auth login --token` or `SENTRY_AUTH_TOKEN`.

## Token Precedence

By default, the CLI checks for auth tokens in the following order:

1. The stored credential from `sentry auth login`
2. `SENTRY_AUTH_TOKEN` environment variable
3. `SENTRY_TOKEN` environment variable (legacy alias)

The stored credential takes priority. Stored OAuth credentials support automatic refresh; manually provided API tokens do not use a refresh token. To override this precedence and force environment tokens to win, set `SENTRY_FORCE_ENV_TOKEN=1`.

When a token comes from an environment variable, the CLI skips expiry checks and automatic refresh.

## Navigation

- [Docs home](https://cli.sentry.dev/_preview/pr-1320/index.md)
- [Parent: Commands](https://cli.sentry.dev/_preview/pr-1320/commands.md)
- [Previous: api](https://cli.sentry.dev/_preview/pr-1320/commands/api.md)
- [Next: build](https://cli.sentry.dev/_preview/pr-1320/commands/build.md)
