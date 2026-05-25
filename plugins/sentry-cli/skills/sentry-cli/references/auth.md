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

**Examples:**

```bash
sentry auth login

sentry auth login --token YOUR_SENTRY_API_TOKEN

# OAuth login to a self-hosted instance (requires --url on first use)
sentry auth login --url https://sentry.example.com

# Token-based auth with self-hosted
sentry auth login --token YOUR_TOKEN --url https://sentry.example.com

# Force re-authentication (skip "already logged in" prompt)
sentry auth login --force

# Set a custom timeout for the OAuth flow (default: 900 seconds)
sentry auth login --timeout 300
```

### `sentry auth logout`

Log out of Sentry

**Examples:**

```bash
sentry auth logout
```

### `sentry auth refresh`

Refresh your authentication token

**Flags:**
- `--force - Force refresh even if token is still valid`

**Examples:**

```bash
sentry auth refresh
```

### `sentry auth status`

View authentication status

**Flags:**
- `--show-token - Show the stored token (masked by default)`
- `-f, --fresh - Bypass cache, re-detect projects, and fetch fresh data`

**Examples:**

```bash
sentry auth status

# Show the raw token
sentry auth status --show-token

# View current user
sentry auth whoami
```

### `sentry auth token`

Print the stored authentication token

**Examples:**

```bash
sentry auth token
```

### `sentry auth whoami`

Show the currently authenticated identity

**Flags:**
- `-f, --fresh - Bypass cache, re-detect projects, and fetch fresh data`

All commands also support `--json`, `--fields`, `--help`, `--log-level`, and `--verbose` flags.
