---
title: Self-Hosted Sentry
description: Using the Sentry CLI with a self-hosted Sentry instance
---

The CLI works with self-hosted Sentry instances. Set the `SENTRY_HOST` (or `SENTRY_URL`) environment variable to point at your instance:

```bash
export SENTRY_HOST=https://sentry.example.com
```

## Authenticating

### With OAuth (Sentry 26.1.0+)

The OAuth device flow requires **Sentry 26.1.0 or later** and a public OAuth application registered on your instance.

#### 1. Create a Public OAuth Application

1. In your Sentry instance, go to **Settings → Developer Settings → Applications → Create New Application** (or visit `https://sentry.example.com/settings/account/api/applications/`)
2. Select **Public** as the application type
3. Fill in the required fields (name, redirect URL — can be any placeholder URL)
3. Save the application and copy the **Client ID**

#### 2. Log In

Pass your instance URL and the client ID:

```bash
SENTRY_HOST=https://sentry.example.com SENTRY_CLIENT_ID=your-client-id sentry auth login
```

:::tip
You can export both variables in your shell profile so every CLI invocation picks them up:

```bash
export SENTRY_HOST=https://sentry.example.com
export SENTRY_CLIENT_ID=your-client-id
```
:::

### With an API Token

If your instance is on an older version or you prefer not to create an OAuth application, you can use an API token instead:

1. Go to **Settings → Developer Settings → Personal Tokens** in your Sentry instance (or visit `https://sentry.example.com/settings/account/api/auth-tokens/new-token/`)
2. Create a new token with the following scopes:
<!-- GENERATED:START oauth-scopes -->
`project:read`, `project:write`, `project:admin`, `org:read`, `event:read`, `event:write`, `member:read`, `team:read`, `team:write`
<!-- GENERATED:END oauth-scopes -->
3. Pass it to the CLI:

```bash
SENTRY_HOST=https://sentry.example.com sentry auth login --token YOUR_TOKEN
```

## After Login

Once authenticated, the CLI stores your instance URL — you don't need to set `SENTRY_URL` on every command. All subsequent commands automatically use the correct instance:

```bash
sentry issue list
sentry org list
```

If you pass a self-hosted Sentry URL as a command argument (e.g., an issue or event URL), the CLI detects the instance automatically.

## Proxy / IAP Configuration

If your self-hosted instance is behind a reverse proxy, identity-aware proxy (IAP), or requires custom authentication headers, use the `SENTRY_CUSTOM_HEADERS` environment variable to inject headers into every CLI request (including OAuth flows):

```bash
export SENTRY_CUSTOM_HEADERS="X-Custom-Auth:my-token,X-Forwarded-For:10.0.0.1"
```

Headers are specified as comma-separated `key:value` pairs.

## `.sentryclirc` Config File

You can also configure your self-hosted instance using a `.sentryclirc` file instead of environment variables. This is especially useful for teams sharing a repository:

```ini
[defaults]
org = my-org
project = my-project
url = https://sentry.example.com

[auth]
token = sntrys_...
```

The `[defaults] url` field is equivalent to `SENTRY_HOST`. The `[auth] token` field is equivalent to `SENTRY_AUTH_TOKEN`. See [Configuration](./configuration/#configuration-file-sentryclirc) for details on config file resolution.

## Multi-Region

Multi-region fan-out (automatic routing to `us.sentry.io`, `de.sentry.io`, etc.) is **disabled** for self-hosted instances. All API requests are sent directly to the configured `SENTRY_HOST` URL.

## Token Precedence

When both a stored OAuth token (from `sentry auth login`) and an environment variable token (`SENTRY_AUTH_TOKEN`) exist, the stored OAuth token takes priority by default because it supports automatic refresh. To force the environment variable token to be used instead, set:

```bash
export SENTRY_FORCE_ENV_TOKEN=1
```

This is useful in CI pipelines or when switching between self-hosted instances.

## Relevant Environment Variables

| Variable | Description |
|----------|-------------|
| `SENTRY_HOST` | Base URL of your Sentry instance (takes precedence over `SENTRY_URL`) |
| `SENTRY_URL` | Alias for `SENTRY_HOST` |
| `SENTRY_CLIENT_ID` | Client ID of your public OAuth application |
| `SENTRY_CUSTOM_HEADERS` | Custom HTTP headers for proxy/IAP (comma-separated `key:value` pairs) |
| `SENTRY_FORCE_ENV_TOKEN` | Force env token over stored OAuth token |
| `SENTRY_ORG` | Default organization slug |
| `SENTRY_PROJECT` | Default project slug (supports `org/project` format) |

See [Configuration](./configuration/) for the full environment variable reference.
