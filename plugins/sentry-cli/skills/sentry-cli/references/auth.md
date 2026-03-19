---
name: sentry-cli-auth
version: 0.18.1
description: Authenticate with Sentry via OAuth or API tokens
requires:
  bins: ["sentry"]
  auth: true
---

# Authentication Commands

Authenticate with Sentry

### `sentry auth login`

Authenticate with Sentry

**Flags:**
- `--token <value> - Authenticate using an API token instead of OAuth`
- `--timeout <value> - Timeout for OAuth flow in seconds (default: 900) - (default: "900")`
- `--force - Re-authenticate without prompting`

**Examples:**

```bash
# OAuth device flow (recommended)
sentry auth login

# Using an API token
sentry auth login --token YOUR_TOKEN

SENTRY_URL=https://sentry.example.com SENTRY_CLIENT_ID=your-client-id sentry auth login

SENTRY_URL=https://sentry.example.com sentry auth login --token YOUR_TOKEN
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
```

### `sentry auth token`

Print the stored authentication token

### `sentry auth whoami`

Show the currently authenticated user

**Flags:**
- `-f, --fresh - Bypass cache, re-detect projects, and fetch fresh data`

All commands also support `--json`, `--fields`, `--help`, `--log-level`, and `--verbose` flags.
