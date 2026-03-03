# Auth Commands

Authenticate with Sentry

## `sentry auth login`

Authenticate with Sentry

**OAuth Flow:**

1. Run `sentry auth login`
2. A URL and code will be displayed
3. Open the URL in your browser
4. Enter the code when prompted
5. Authorize the application
6. The CLI automatically receives your token

**Flags:**
- `--token <value> - Authenticate using an API token instead of OAuth`
- `--timeout <value> - Timeout for OAuth flow in seconds (default: 900) - (default: "900")`

**Examples:**

```bash
# OAuth device flow (recommended)
sentry auth login

# Using an API token
sentry auth login --token YOUR_TOKEN
```

## `sentry auth logout`

Log out of Sentry

**Examples:**

```bash
sentry auth logout
```

## `sentry auth refresh`

Refresh your authentication token

**Flags:**
- `--json - Output result as JSON`
- `--force - Force refresh even if token is still valid`

**Examples:**

```bash
sentry auth refresh
```

## `sentry auth status`

View authentication status

**Flags:**
- `--show-token - Show the stored token (masked by default)`

**Examples:**

```bash
sentry auth status
```

**Expected output:**

```
Authenticated as: username
Organization: my-org
Token expires: 2024-12-31
```

## `sentry auth token`

Print the stored authentication token

## `sentry auth whoami`

Show the currently authenticated user

**Flags:**
- `--json - Output as JSON`

## Shortcuts

- `sentry whoami` → shortcut for `sentry auth whoami` (accepts the same flags)

## Workflows

### First-time setup
1. Install: `curl https://cli.sentry.dev/install -fsS | bash`
2. Authenticate: `sentry auth login`
3. Verify: `sentry auth status`
4. Explore: `sentry org list`

### CI/CD authentication
1. Create an API token at https://sentry.io/settings/account/api/auth-tokens/
2. Set token: `sentry auth login --token $SENTRY_TOKEN`
3. Verify: `sentry auth status`
