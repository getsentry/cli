# Development Guide

This guide explains how to develop and test the sry CLI and OAuth proxy locally.

## Prerequisites

- [Bun](https://bun.sh/) installed
- A Sentry OAuth application (create one at https://sentry.io/settings/account/api/applications/)

## Project Structure

```
sry/
├── apps/
│   └── oauth-proxy/     # Hono server for device flow OAuth
└── packages/
    └── cli/             # The sry CLI
```

## Setup

1. Install dependencies:

```bash
bun install
```

2. Create a `.env` file in the project root:

```
SRY_CLIENT_ID=your-sentry-oauth-client-id
SRY_CLIENT_SECRET=your-sentry-oauth-client-secret
```

Get these from your Sentry OAuth application settings.

## Running Locally

Open two terminal windows:

**Terminal 1 - OAuth Proxy:**

```bash
cd apps/oauth-proxy
bun run dev
```

This starts the proxy on `http://127.0.0.1:8723` (matching your Sentry OAuth app's redirect URI).

**Terminal 2 - CLI:**

```bash
cd packages/cli
SRY_OAUTH_PROXY_URL=http://127.0.0.1:8723 bun run src/bin.ts auth login
```

## Testing the Device Flow

1. Start the OAuth proxy (see above)

2. Run the CLI login command:

```bash
cd packages/cli
SRY_OAUTH_PROXY_URL=http://127.0.0.1:8723 bun run src/bin.ts auth login
```

3. You'll see output like:

```
Starting authentication...

To authenticate, visit:
  http://127.0.0.1:8723/device/authorize

And enter code: ABCD-1234

Waiting for authorization (press Ctrl+C to cancel)...
```

4. Open the URL in your browser and enter the code

5. You'll be redirected to Sentry to authorize

6. After authorizing, the CLI will receive the token and save it

## Sentry OAuth App Configuration

When creating your Sentry OAuth application, set:

- **Redirect URI**:

  - For local development: `http://127.0.0.1:8723/callback`
  - For production: `https://your-vercel-app.vercel.app/callback`

- **Scopes**: Select the scopes your CLI needs:
  - `project:read`, `project:write`
  - `org:read`
  - `event:read`, `event:write`
  - `member:read`
  - `team:read`

## Environment Variables

### OAuth Proxy

| Variable            | Description                    |
| ------------------- | ------------------------------ |
| `SRY_CLIENT_ID`     | Sentry OAuth app client ID     |
| `SRY_CLIENT_SECRET` | Sentry OAuth app client secret |

### CLI

| Variable              | Description     | Default                        |
| --------------------- | --------------- | ------------------------------ |
| `SRY_OAUTH_PROXY_URL` | OAuth proxy URL | `https://sry-oauth.vercel.app` |

## Deploying the OAuth Proxy

```bash
cd apps/oauth-proxy
bunx vercel

# Set environment variables in Vercel dashboard or via CLI:
bunx vercel env add SRY_CLIENT_ID
bunx vercel env add SRY_CLIENT_SECRET
```

After deployment, update the default `OAUTH_PROXY_URL` in `packages/cli/src/lib/oauth.ts` to your Vercel URL.
