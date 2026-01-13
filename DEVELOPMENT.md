# Development Guide

## Prerequisites

- [Bun](https://bun.sh/) installed
- A Sentry OAuth application (create one at https://sentry.io/settings/account/api/applications/)

## Project Structure

```
sentry-cli-next/
└── packages/
    └── cli/             # The Sentry CLI
```

## Setup

1. Install dependencies:

```bash
bun install
```

2. Create a `.env.local` file in the project root:

```
SENTRY_CLIENT_ID=your-sentry-oauth-client-id
```

Get the client ID from your Sentry OAuth application settings.

**Note:** No client secret is needed - the CLI uses OAuth 2.0 Device Authorization Grant (RFC 8628) which is designed for public clients.

## Running Locally

```bash
cd packages/cli
bun run --env-file=../../.env.local src/bin.ts auth login
```

## Testing the Device Flow

1. Run the CLI login command:

```bash
cd packages/cli
bun run --env-file=../../.env.local src/bin.ts auth login
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

When creating your Sentry OAuth application:

- **Redirect URI**: Not required for device flow
- **Scopes**: The CLI requests these scopes:
  - `project:read`, `project:write`
  - `org:read`
  - `event:read`, `event:write`
  - `member:read`
  - `team:read`

## Environment Variables

| Variable           | Description                          | Default              |
| ------------------ | ------------------------------------ | -------------------- |
| `SENTRY_CLIENT_ID` | Sentry OAuth app client ID           | (required)           |
| `SENTRY_URL`       | Sentry instance URL (for self-hosted)| `https://sentry.io`  |

## Building

```bash
cd packages/cli
bun run build
```

## Architecture

The CLI uses the OAuth 2.0 Device Authorization Grant ([RFC 8628](https://datatracker.ietf.org/doc/html/rfc8628)) for authentication. This flow is designed for CLI tools and other devices that can't easily handle browser redirects:

1. CLI requests a device code from Sentry
2. User is shown a code and URL to visit
3. CLI polls Sentry until the user authorizes
4. CLI receives access token and stores it locally

No proxy server is needed - the CLI communicates directly with Sentry.
