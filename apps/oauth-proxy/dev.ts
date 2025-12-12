/**
 * Local development server
 *
 * This file wraps the Hono app for local testing with Bun.
 * In production, the app is deployed to Vercel as a serverless function.
 */

import { Hono } from "hono";
import { cors } from "hono/cors";

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

const PORT = Number(process.env.PORT) || 8723;

const SENTRY_OAUTH_AUTHORIZE = "https://sentry.io/oauth/authorize/";
const SENTRY_OAUTH_TOKEN = "https://sentry.io/oauth/token/";

const CLIENT_ID = process.env.SRY_CLIENT_ID ?? "";
const CLIENT_SECRET = process.env.SRY_CLIENT_SECRET ?? "";

const DEVICE_CODE_EXPIRES_IN = 900;
const POLLING_INTERVAL = 5;

const SCOPES = [
  "project:read",
  "project:write",
  "org:read",
  "event:read",
  "event:write",
  "member:read",
  "team:read",
].join(" ");

// ─────────────────────────────────────────────────────────────────────────────
// Validate config
// ─────────────────────────────────────────────────────────────────────────────

if (!(CLIENT_ID && CLIENT_SECRET)) {
  console.error(
    "❌ Missing SRY_CLIENT_ID or SRY_CLIENT_SECRET. Create a .env file in the project root."
  );
  process.exit(1);
}

// ─────────────────────────────────────────────────────────────────────────────
// Storage
// ─────────────────────────────────────────────────────────────────────────────

type DeviceFlowState = {
  deviceCode: string;
  userCode: string;
  expiresAt: number;
  token?: {
    access_token: string;
    token_type: string;
    expires_in: number;
    refresh_token?: string;
    scope?: string;
  };
};

const deviceFlows = new Map<string, DeviceFlowState>();
const userCodeToDeviceCode = new Map<string, string>();

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────

function generateDeviceCode(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(16).padStart(2, "0")).join("");
}

function generateUserCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const nums = "0123456789";
  let code = "";
  for (let i = 0; i < 4; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  code += "-";
  for (let i = 0; i < 4; i++) {
    code += nums[Math.floor(Math.random() * nums.length)];
  }
  return code;
}

function cleanupExpiredFlows(): void {
  const now = Date.now();
  for (const [deviceCode, state] of deviceFlows) {
    if (state.expiresAt < now) {
      deviceFlows.delete(deviceCode);
      userCodeToDeviceCode.delete(state.userCode);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HTML Templates
// ─────────────────────────────────────────────────────────────────────────────

const HTML_STYLE = `
	body {
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 100vh;
		margin: 0;
		background: #1a1a2e;
		color: #eee;
	}
	.container {
		text-align: center;
		padding: 2rem;
		max-width: 400px;
	}
	h1 { color: #fff; margin-bottom: 0.5rem; }
	.subtitle { color: #888; margin-bottom: 2rem; }
	input {
		font-size: 1.5rem;
		padding: 0.75rem 1rem;
		border: 2px solid #333;
		border-radius: 8px;
		background: #0d0d1a;
		color: #fff;
		text-align: center;
		letter-spacing: 0.2em;
		width: 200px;
		text-transform: uppercase;
	}
	input:focus {
		outline: none;
		border-color: #7c3aed;
	}
	button {
		font-size: 1rem;
		padding: 0.75rem 2rem;
		border: none;
		border-radius: 8px;
		background: #7c3aed;
		color: #fff;
		cursor: pointer;
		margin-top: 1rem;
		width: 100%;
	}
	button:hover { background: #6d28d9; }
	.error { color: #ff6b6b; margin-top: 1rem; }
	.success { color: #51cf66; }
	h1.success { color: #51cf66; }
	h1.error { color: #ff6b6b; }
`;

function authorizePage(error?: string): string {
  return `<!DOCTYPE html>
<html>
<head>
	<title>sry CLI - Authorize</title>
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<style>${HTML_STYLE}</style>
</head>
<body>
	<div class="container">
		<h1>🔐 sry CLI</h1>
		<p class="subtitle">Enter the code shown in your terminal</p>
		<form method="GET" action="/device/verify">
			<input type="text" name="user_code" placeholder="XXXX-0000" maxlength="9" required autofocus>
			<button type="submit">Continue</button>
		</form>
		${error ? `<p class="error">${error}</p>` : ""}
	</div>
</body>
</html>`;
}

function successPage(): string {
  return `<!DOCTYPE html>
<html>
<head>
	<title>sry CLI - Success</title>
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<style>${HTML_STYLE}</style>
</head>
<body>
	<div class="container">
		<h1 class="success">✓ Authorization Successful</h1>
		<p class="subtitle">You can close this window and return to your terminal.</p>
	</div>
</body>
</html>`;
}

function errorPage(message: string): string {
  return `<!DOCTYPE html>
<html>
<head>
	<title>sry CLI - Error</title>
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<style>${HTML_STYLE}</style>
</head>
<body>
	<div class="container">
		<h1 class="error">✗ Authorization Failed</h1>
		<p class="subtitle">${message}</p>
		<p>Please try again from your terminal.</p>
	</div>
</body>
</html>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Hono App
// ─────────────────────────────────────────────────────────────────────────────

const app = new Hono();

app.use("*", cors());

app.get("/", (c) =>
  c.json({ status: "ok", service: "sry-oauth-proxy", mode: "development" })
);

app.post("/device/code", (c) => {
  cleanupExpiredFlows();

  const deviceCode = generateDeviceCode();
  const userCode = generateUserCode();
  const expiresAt = Date.now() + DEVICE_CODE_EXPIRES_IN * 1000;

  const state: DeviceFlowState = { deviceCode, userCode, expiresAt };

  deviceFlows.set(deviceCode, state);
  userCodeToDeviceCode.set(userCode, deviceCode);

  console.log(
    `[device/code] Created: ${userCode} -> ${deviceCode.slice(0, 8)}...`
  );

  return c.json({
    device_code: deviceCode,
    user_code: userCode,
    verification_uri: `http://127.0.0.1:${PORT}/device/authorize`,
    expires_in: DEVICE_CODE_EXPIRES_IN,
    interval: POLLING_INTERVAL,
  });
});

app.get("/device/authorize", (c) => c.html(authorizePage()));

app.get("/device/verify", (c) => {
  const userCode = c.req.query("user_code")?.toUpperCase().trim();

  if (!userCode) {
    return c.html(authorizePage("Please enter a code"));
  }

  const deviceCode = userCodeToDeviceCode.get(userCode);
  if (!deviceCode) {
    return c.html(authorizePage("Invalid or expired code. Please try again."));
  }

  const state = deviceFlows.get(deviceCode);
  if (!state || state.expiresAt < Date.now()) {
    userCodeToDeviceCode.delete(userCode);
    if (deviceCode) deviceFlows.delete(deviceCode);
    return c.html(authorizePage("Code has expired. Please start over."));
  }

  console.log(`[device/verify] Code verified: ${userCode}`);

  const callbackUrl = `http://127.0.0.1:${PORT}/callback`;
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: "code",
    redirect_uri: callbackUrl,
    scope: SCOPES,
    state: deviceCode,
  });

  return c.redirect(`${SENTRY_OAUTH_AUTHORIZE}?${params.toString()}`);
});

app.get("/callback", async (c) => {
  const code = c.req.query("code");
  const deviceCode = c.req.query("state");
  const error = c.req.query("error");
  const errorDescription = c.req.query("error_description");

  if (error) {
    console.error(`[callback] Error: ${error} - ${errorDescription}`);
    return c.html(errorPage(errorDescription ?? error));
  }

  if (!(code && deviceCode)) {
    return c.html(errorPage("Missing authorization code or state"));
  }

  const state = deviceFlows.get(deviceCode);
  if (!state) {
    return c.html(errorPage("Invalid or expired device code"));
  }

  const callbackUrl = `http://127.0.0.1:${PORT}/callback`;

  try {
    console.log("[callback] Exchanging code for token...");

    const tokenResponse = await fetch(SENTRY_OAUTH_TOKEN, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code,
        redirect_uri: callbackUrl,
      }),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error(`[callback] Token exchange failed: ${errorText}`);
      return c.html(errorPage("Failed to exchange code for token"));
    }

    const tokenData = (await tokenResponse.json()) as {
      access_token: string;
      token_type: string;
      expires_in: number;
      refresh_token?: string;
      scope?: string;
    };

    state.token = tokenData;
    userCodeToDeviceCode.delete(state.userCode);

    console.log(`[callback] ✓ Token received for ${state.userCode}`);

    return c.html(successPage());
  } catch (err) {
    console.error("[callback] Error:", err);
    return c.html(errorPage("An error occurred during authorization"));
  }
});

app.post("/device/token", async (c) => {
  let deviceCode: string | undefined;

  const contentType = c.req.header("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const body = (await c.req.json()) as { device_code?: string };
    deviceCode = body.device_code;
  } else {
    const body = await c.req.parseBody();
    deviceCode = body.device_code as string | undefined;
  }

  if (!deviceCode) {
    return c.json(
      { error: "invalid_request", error_description: "Missing device_code" },
      400
    );
  }

  const state = deviceFlows.get(deviceCode);

  if (!state) {
    return c.json(
      { error: "invalid_grant", error_description: "Invalid device code" },
      400
    );
  }

  if (state.expiresAt < Date.now()) {
    deviceFlows.delete(deviceCode);
    userCodeToDeviceCode.delete(state.userCode);
    return c.json(
      { error: "expired_token", error_description: "Device code has expired" },
      400
    );
  }

  if (!state.token) {
    return c.json({
      error: "authorization_pending",
      error_description: "Waiting for user authorization",
    });
  }

  const token = state.token;
  deviceFlows.delete(deviceCode);

  console.log("[device/token] ✓ Token delivered");

  return c.json({
    access_token: token.access_token,
    token_type: token.token_type,
    expires_in: token.expires_in,
    refresh_token: token.refresh_token,
    scope: token.scope,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Start Server
// ─────────────────────────────────────────────────────────────────────────────

console.log(`
🚀 OAuth Proxy running at http://127.0.0.1:${PORT}

Endpoints:
  POST /device/code      - Start device flow
  GET  /device/authorize - User enters code
  GET  /callback         - Sentry OAuth callback
  POST /device/token     - CLI polls for token

To test with the CLI:
  cd packages/cli
  SRY_OAUTH_PROXY_URL=http://127.0.0.1:${PORT} bun run src/bin.ts auth login
`);

export default {
  port: PORT,
  fetch: app.fetch,
};
