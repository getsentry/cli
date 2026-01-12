/**
 * OAuth Proxy Server
 *
 * Implements a Device Flow pattern on top of Sentry's OAuth.
 * This allows the CLI to authenticate without exposing the client secret.
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { handle } from "hono/vercel";

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

const SENTRY_OAUTH_AUTHORIZE = "https://sentry.io/oauth/authorize/";
const SENTRY_OAUTH_TOKEN = "https://sentry.io/oauth/token/";

// These are set in Vercel environment variables
const CLIENT_ID = process.env.SENTRY_CLIENT_ID ?? "";
const CLIENT_SECRET = process.env.SENTRY_CLIENT_SECRET ?? "";

// Device flow configuration
const DEVICE_CODE_EXPIRES_IN = 900; // 15 minutes
const POLLING_INTERVAL = 5; // seconds

// OAuth scopes for the CLI
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
// In-Memory Storage (use Vercel KV for production)
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

// Map: deviceCode -> state
const deviceFlows = new Map<string, DeviceFlowState>();
// Map: userCode -> deviceCode (for lookup during authorization)
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
  // Generate a human-friendly code like "ABCD-1234"
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // No I, O to avoid confusion
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

function getBaseUrl(url: string): string {
  const parsed = new URL(url);
  return `${parsed.protocol}//${parsed.host}`;
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
	<title>Sentry CLI - Authorize</title>
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<style>${HTML_STYLE}</style>
</head>
<body>
	<div class="container">
		<h1>🔐 Sentry CLI</h1>
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
	<title>Sentry CLI - Success</title>
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
	<title>Sentry CLI - Error</title>
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

// Enable CORS for CLI requests
app.use("*", cors());

// Health check
app.get("/", (c) => c.json({ status: "ok", service: "sentry-oauth-proxy" }));

// ─────────────────────────────────────────────────────────────────────────────
// Device Flow Endpoints
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /device/code
 *
 * CLI calls this to initiate the device flow.
 * Returns device_code, user_code, and verification URL.
 */
app.post("/device/code", (c) => {
  cleanupExpiredFlows();

  const deviceCode = generateDeviceCode();
  const userCode = generateUserCode();
  const expiresAt = Date.now() + DEVICE_CODE_EXPIRES_IN * 1000;

  const state: DeviceFlowState = {
    deviceCode,
    userCode,
    expiresAt,
  };

  deviceFlows.set(deviceCode, state);
  userCodeToDeviceCode.set(userCode, deviceCode);

  const baseUrl = getBaseUrl(c.req.url);

  return c.json({
    device_code: deviceCode,
    user_code: userCode,
    verification_uri: `${baseUrl}/device/authorize`,
    verification_uri_complete: `${baseUrl}/device/verify?user_code=${userCode}`,
    expires_in: DEVICE_CODE_EXPIRES_IN,
    interval: POLLING_INTERVAL,
  });
});

/**
 * GET /device/authorize
 *
 * User visits this page to enter their user_code.
 */
app.get("/device/authorize", (c) => c.html(authorizePage()));

/**
 * GET /device/verify
 *
 * Validates user_code and redirects to Sentry OAuth.
 */
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

  // Build Sentry OAuth URL
  // We encode the deviceCode in the state parameter
  const baseUrl = getBaseUrl(c.req.url);
  const callbackUrl = `${baseUrl}/callback`;

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: "code",
    redirect_uri: callbackUrl,
    scope: SCOPES,
    state: deviceCode, // Use deviceCode as state for simplicity
  });

  return c.redirect(`${SENTRY_OAUTH_AUTHORIZE}?${params.toString()}`);
});

/**
 * GET /callback
 *
 * Sentry OAuth callback. Exchanges code for token and stores it.
 */
app.get("/callback", async (c) => {
  const code = c.req.query("code");
  const deviceCode = c.req.query("state"); // We used deviceCode as state
  const error = c.req.query("error");
  const errorDescription = c.req.query("error_description");

  if (error) {
    return c.html(errorPage(errorDescription ?? error));
  }

  if (!(code && deviceCode)) {
    return c.html(errorPage("Missing authorization code or state"));
  }

  const state = deviceFlows.get(deviceCode);
  if (!state) {
    return c.html(errorPage("Invalid or expired device code"));
  }

  // Exchange code for token
  const baseUrl = getBaseUrl(c.req.url);
  const callbackUrl = `${baseUrl}/callback`;

  try {
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
      console.error("Token exchange failed:", errorText);
      return c.html(errorPage("Failed to exchange code for token"));
    }

    const tokenData = (await tokenResponse.json()) as {
      access_token: string;
      token_type: string;
      expires_in: number;
      refresh_token?: string;
      scope?: string;
    };

    // Store token in the device flow state
    state.token = tokenData;

    // Clean up user code mapping (it's been used)
    userCodeToDeviceCode.delete(state.userCode);

    return c.html(successPage());
  } catch (err) {
    console.error("Token exchange error:", err);
    return c.html(errorPage("An error occurred during authorization"));
  }
});

/**
 * POST /device/token
 *
 * CLI polls this endpoint to check if authorization is complete.
 */
app.post("/device/token", async (c) => {
  let deviceCode: string | undefined;

  // Handle both JSON and form-encoded bodies
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

  // Token is ready - return it and clean up
  const token = state.token;
  deviceFlows.delete(deviceCode);

  return c.json({
    access_token: token.access_token,
    token_type: token.token_type,
    expires_in: token.expires_in,
    refresh_token: token.refresh_token,
    scope: token.scope,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Export for Vercel
// ─────────────────────────────────────────────────────────────────────────────

export default handle(app);
