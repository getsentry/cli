# Development Guide

## Prerequisites

- [Bun](https://bun.sh/) installed

## Setup

1. Install dependencies:

```bash
bun install
```

2. Optional: create a `.env.local` file in the project root to override the bundled development OAuth client ID:

```
SENTRY_CLIENT_ID=your-sentry-oauth-client-id
```

Get the client ID from your Sentry OAuth application settings if you need a custom app or self-hosted instance.

**Note:** No client secret is needed - the CLI uses OAuth 2.0 Device Authorization Grant (RFC 8628) which is designed for public clients.

## Running Locally

```bash
bun run dev auth login
```

## Testing the Device Flow

1. Run the CLI login command:

```bash
bun run dev auth login
```

2. You'll see output like:

```
Starting authentication...

Opening browser...
If it doesn't open, visit: https://sentry.io/oauth/device/
Code: ABCD-EFGH

Waiting for authorization...
```

3. The browser will open to Sentry's device authorization page
4. Enter the code and authorize the application
5. The CLI will automatically receive the token and save it

## Sentry OAuth App Configuration

You only need to create a Sentry OAuth application when overriding the bundled development client ID or testing against self-hosted Sentry. When creating your OAuth application:

- **Redirect URI**: Not required for device flow
- **Scopes**: The CLI requests these scopes:
<!-- GENERATED:START oauth-scopes -->
  - `project:read`, `project:write`, `project:admin`
  - `org:read`
  - `event:read`, `event:write`
  - `member:read`
  - `team:read`, `team:write`
<!-- GENERATED:END oauth-scopes -->

## Environment Variables

The table below lists the most common development variables. For the complete reference, see the generated [Configuration](https://cli.sentry.dev/configuration/) page.

<!-- GENERATED:START dev-env-vars -->
| Variable | Description | Default |
|----------|-------------|---------|
| `SENTRY_AUTH_TOKEN` | API token for non-interactive use (lower priority than stored OAuth by default) | — |
| `SENTRY_FORCE_ENV_TOKEN` | Force env token to take priority over stored OAuth token | — |
| `SENTRY_HOST` | Sentry instance URL (for self-hosted, takes precedence) | `https://sentry.io` |
| `SENTRY_URL` | Alias for `SENTRY_HOST` | `https://sentry.io` |
| `SENTRY_CLIENT_ID` | Sentry OAuth app client ID | bundled development client ID |
| `SENTRY_CONFIG_DIR` | Override credentials/cache directory | `~/.sentry/` |
| `SENTRY_LOG_LEVEL` | Diagnostic log level (`error`, `warn`, `log`, `info`, `debug`, `trace`) | `info` |
| `SENTRY_CLI_NO_TELEMETRY` | Disable CLI telemetry (error tracking) | — |
<!-- GENERATED:END dev-env-vars -->

## Building

```bash
bun run build
```

## Architecture

The CLI uses the OAuth 2.0 Device Authorization Grant ([RFC 8628](https://datatracker.ietf.org/doc/html/rfc8628)) for authentication. This flow is designed for CLI tools and other devices that can't easily handle browser redirects:

1. CLI requests a device code from Sentry
2. User is shown a code and URL to visit
3. CLI polls Sentry until the user authorizes
4. CLI receives access token and stores it locally

No proxy server is needed - the CLI communicates directly with Sentry.
