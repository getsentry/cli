

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

## Token Precedence

By default, the CLI checks for auth tokens in the following order:

1. The stored OAuth token in the SQLite database (from `sentry auth login`)
2. `SENTRY_AUTH_TOKEN` environment variable
3. `SENTRY_TOKEN` environment variable (legacy alias)

The stored OAuth token takes priority because it supports automatic refresh. To override this and force environment tokens to win, set `SENTRY_FORCE_ENV_TOKEN=1`.

When a token comes from an environment variable, the CLI skips expiry checks and automatic refresh.
