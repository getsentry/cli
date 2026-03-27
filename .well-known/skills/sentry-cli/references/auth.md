---
name: sentry-cli-auth
version: 0.22.0
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
sentry auth login

sentry auth login --token YOUR_SENTRY_API_TOKEN

SENTRY_URL=https://sentry.example.com sentry auth login

SENTRY_URL=https://sentry.example.com sentry auth login --token YOUR_TOKEN
```

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

### `sentry auth whoami`

Show the currently authenticated user

**Flags:**
- `-f, --fresh - Bypass cache, re-detect projects, and fetch fresh data`

All commands also support `--json`, `--fields`, `--help`, `--log-level`, and `--verbose` flags.
