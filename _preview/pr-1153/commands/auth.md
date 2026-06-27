---
title: "auth"
description: "Auth commands for the Sentry CLI"
url: "https://cli.sentry.dev/_preview/pr-1153/commands/auth/"
---

# auth

Authenticate with Sentry

## Commands

[Section titled “Commands”](#commands)

### `sentry auth login`

[Section titled “sentry auth login”](#sentry-auth-login)

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

[Section titled “sentry auth logout”](#sentry-auth-logout)

Log out of Sentry

### `sentry auth refresh`

[Section titled “sentry auth refresh”](#sentry-auth-refresh)

Refresh your authentication token

**Options:**

| Option | Description |
| --- | --- |
| `--force` | Force refresh even if token is still valid |
| `--read-only` | Re-authenticate with read-only OAuth scopes (project:read, org:read, event:read, member:read, team:read) |
| `-s, --scope <scope>...` | Re-authenticate with specific OAuth scopes (repeatable, comma-separated). E.g. --scope project:read --scope org:read |

### `sentry auth status`

[Section titled “sentry auth status”](#sentry-auth-status)

View authentication status

**Options:**

| Option | Description |
| --- | --- |
| `--show-token` | Show the stored token (masked by default) |
| `-f, --fresh` | Bypass cache, re-detect projects, and fetch fresh data |

### `sentry auth token`

[Section titled “sentry auth token”](#sentry-auth-token)

Print the stored authentication token

### `sentry auth whoami`

[Section titled “sentry auth whoami”](#sentry-auth-whoami)

Show the currently authenticated identity

**Options:**

| Option | Description |
| --- | --- |
| `-f, --fresh` | Bypass cache, re-detect projects, and fetch fresh data |

All commands support `--json` for machine-readable output and `--fields` to select specific JSON fields.

## Examples

[Section titled “Examples”](#examples)

### OAuth login (recommended)

[Section titled “OAuth login (recommended)”](#oauth-login-recommended)
Terminal window

```
sentry auth login
```


1. A URL and device code will be displayed
2. Open the URL in your browser
3. Enter the code when prompted
4. Authorize the application
5. The CLI automatically receives your token

### Token login

[Section titled “Token login”](#token-login)
Terminal window

```
sentry auth login --token YOUR_SENTRY_API_TOKEN
```


### Self-hosted Sentry

[Section titled “Self-hosted Sentry”](#self-hosted-sentry)
Terminal window

```
SENTRY_URL=https://sentry.example.com sentry auth login
```


For token-based auth with self-hosted:

Terminal window

```
SENTRY_URL=https://sentry.example.com sentry auth login --token YOUR_TOKEN
```


See [Self-Hosted Sentry](https://cli.sentry.dev/_preview/pr-1153/commands/self-hosted.md) for details.

### Logout

[Section titled “Logout”](#logout)
Terminal window

```
sentry auth logout
```


### Refresh token

[Section titled “Refresh token”](#refresh-token)
Terminal window

```
sentry auth refresh
```


### Print stored token

[Section titled “Print stored token”](#print-stored-token)
Terminal window

```
sentry auth token
```


### Check auth status

[Section titled “Check auth status”](#check-auth-status)
Terminal window

```
sentry auth status
```


```
Authenticated as: usernameOrganization: my-orgToken expires: 2024-12-31
```


Terminal window

```
# Show the raw tokensentry auth status --show-token
# View current usersentry auth whoami
```


## Credential Storage

[Section titled “Credential Storage”](#credential-storage)

Auth tokens are stored in a SQLite database at `~/.sentry/cli.db` with restricted file permissions.

## Token Precedence

[Section titled “Token Precedence”](#token-precedence)

By default, the CLI checks for auth tokens in the following order:

1. The stored OAuth token in the SQLite database (from `sentry auth login`)
2. `SENTRY_AUTH_TOKEN` environment variable
3. `SENTRY_TOKEN` environment variable (legacy alias)

The stored OAuth token takes priority because it supports automatic refresh. To override this and force environment tokens to win, set `SENTRY_FORCE_ENV_TOKEN=1`.

When a token comes from an environment variable, the CLI skips expiry checks and automatic refresh.
