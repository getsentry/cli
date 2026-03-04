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

## Configuration

Credentials are stored in `~/.sentry/config.json` with restricted file permissions (mode 600).

**Config structure:**

```json
{
  "auth": {
    "token": "...",
    "refreshToken": "...",
    "expiresAt": "2024-12-31T00:00:00Z"
  }
}
```
