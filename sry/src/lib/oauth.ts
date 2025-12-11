/**
 * OAuth Authentication
 *
 * Implements Sentry OAuth 2.0 Authorization Code flow.
 */

import {
	createServer,
	type IncomingMessage,
	type Server,
	type ServerResponse,
} from "node:http";
import type { TokenResponse } from "../types/index.js";
import { setAuthToken } from "./config.js";

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

const SENTRY_OAUTH_AUTHORIZE = "https://sentry.io/oauth/authorize/";
const SENTRY_OAUTH_TOKEN = "https://sentry.io/oauth/token/";
const CALLBACK_PORT = 8723;
const CALLBACK_URL = `http://127.0.0.1:${CALLBACK_PORT}/callback`;

// Client credentials from environment variables
const CLIENT_ID = process.env.SRY_CLIENT_ID ?? "";
const CLIENT_SECRET = process.env.SRY_CLIENT_SECRET ?? "";

type OAuthConfig = {
	clientId: string;
	clientSecret: string;
	scopes: string[];
};

const defaultConfig: OAuthConfig = {
	clientId: CLIENT_ID,
	clientSecret: CLIENT_SECRET,
	scopes: [
		"project:read",
		"project:write",
		"org:read",
		"event:read",
		"event:write",
		"member:read",
		"team:read",
	],
};

// ─────────────────────────────────────────────────────────────────────────────
// HTML Templates
// ─────────────────────────────────────────────────────────────────────────────

const HTML_STYLE = `
  body { 
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
    display: flex; align-items: center; justify-content: center; height: 100vh; 
    margin: 0; background: #1a1a2e; color: #eee; 
  }
  .container { text-align: center; padding: 2rem; }
  h1.success { color: #51cf66; }
  h1.error { color: #ff6b6b; }
  p { color: #aaa; }
`;

function htmlPage(title: string, isSuccess: boolean, message: string): string {
	const titleClass = isSuccess ? "success" : "error";
	const icon = isSuccess ? "✓" : "✗";
	return `<!DOCTYPE html>
<html>
<head><title>${title}</title><style>${HTML_STYLE}</style></head>
<body>
  <div class="container">
    <h1 class="${titleClass}">${icon} ${title}</h1>
    <p>${message}</p>
    <p>You can close this window.</p>
  </div>
</body>
</html>`;
}

const SUCCESS_PAGE = htmlPage(
	"Authentication Successful",
	true,
	"Return to the terminal to continue.",
);

function errorPage(message: string): string {
	return htmlPage("Authentication Failed", false, message);
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate a random state parameter for CSRF protection
 */
function generateState(): string {
	const array = new Uint8Array(32);
	crypto.getRandomValues(array);
	return Array.from(array, (byte) => byte.toString(16).padStart(2, "0")).join(
		"",
	);
}

/**
 * Merge config with defaults
 */
function mergeConfig(config: Partial<OAuthConfig>): OAuthConfig {
	return { ...defaultConfig, ...config };
}

/**
 * Validate OAuth credentials are configured
 */
function validateCredentials(clientId: string, clientSecret: string): void {
	if (!(clientId && clientSecret)) {
		throw new Error(
			"OAuth credentials not configured.\n\n" +
				"Please set the following environment variables:\n" +
				"  export SRY_CLIENT_ID='your-client-id'\n" +
				"  export SRY_CLIENT_SECRET='your-client-secret'\n\n" +
				"Or use --token flag to authenticate with an API token:\n" +
				"  sry auth login --token YOUR_API_TOKEN",
		);
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Authorization URL
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build the authorization URL for Sentry OAuth
 */
export function buildAuthorizationUrl(
	state: string,
	config: Partial<OAuthConfig> = {},
): string {
	const { clientId, scopes } = mergeConfig(config);

	if (!clientId) {
		throw new Error(
			"Client ID not configured. Set SRY_CLIENT_ID environment variable.",
		);
	}

	const params = new URLSearchParams({
		client_id: clientId,
		response_type: "code",
		redirect_uri: CALLBACK_URL,
		scope: scopes.join(" "),
		state,
	});

	return `${SENTRY_OAUTH_AUTHORIZE}?${params.toString()}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Token Exchange
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Exchange authorization code for access token
 */
export async function exchangeCodeForToken(
	code: string,
	config: Partial<OAuthConfig> = {},
): Promise<TokenResponse> {
	const { clientId, clientSecret } = mergeConfig(config);
	validateCredentials(clientId, clientSecret);

	const response = await fetch(SENTRY_OAUTH_TOKEN, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			grant_type: "authorization_code",
			client_id: clientId,
			client_secret: clientSecret,
			code,
			redirect_uri: CALLBACK_URL,
		}),
	});

	if (!response.ok) {
		const error = await response.text();
		throw new Error(`Failed to exchange code for token: ${error}`);
	}

	return response.json() as Promise<TokenResponse>;
}

/**
 * Refresh an access token using a refresh token
 */
export async function refreshAccessToken(
	refreshToken: string,
	config: Partial<OAuthConfig> = {},
): Promise<TokenResponse> {
	const { clientId, clientSecret } = mergeConfig(config);
	validateCredentials(clientId, clientSecret);

	const response = await fetch(SENTRY_OAUTH_TOKEN, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			grant_type: "refresh_token",
			client_id: clientId,
			client_secret: clientSecret,
			refresh_token: refreshToken,
		}),
	});

	if (!response.ok) {
		const error = await response.text();
		throw new Error(`Failed to refresh token: ${error}`);
	}

	return response.json() as Promise<TokenResponse>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Callback Server
// ─────────────────────────────────────────────────────────────────────────────

type CallbackResult =
	| { success: true; code: string }
	| { success: false; error: string };

type CallbackHandlers = {
	resolve: (code: string) => void;
	reject: (error: Error) => void;
};

/**
 * Parse callback request and validate state
 */
function parseCallbackRequest(url: URL, expectedState: string): CallbackResult {
	const code = url.searchParams.get("code");
	const state = url.searchParams.get("state");
	const error = url.searchParams.get("error");
	const errorDescription = url.searchParams.get("error_description");

	if (error) {
		return { success: false, error: errorDescription ?? error };
	}

	if (!code) {
		return { success: false, error: "No authorization code received" };
	}

	if (state !== expectedState) {
		return { success: false, error: "State mismatch - possible CSRF attack" };
	}

	return { success: true, code };
}

/**
 * Send response and close server
 */
function sendResponseAndClose(
	res: ServerResponse,
	server: Server,
	html: string,
): void {
	res.writeHead(200, { "Content-Type": "text/html" });
	res.end(html);
	server.close();
}

/**
 * Create callback request handler
 */
function createCallbackHandler(
	expectedState: string,
	server: Server,
	handlers: CallbackHandlers,
): (req: IncomingMessage, res: ServerResponse) => void {
	return (req, res) => {
		const url = new URL(req.url ?? "", `http://127.0.0.1:${CALLBACK_PORT}`);

		if (url.pathname !== "/callback") {
			res.writeHead(404);
			res.end("Not found");
			return;
		}

		const result = parseCallbackRequest(url, expectedState);

		if (!result.success) {
			sendResponseAndClose(res, server, errorPage(result.error));
			handlers.reject(new Error(result.error));
			return;
		}

		sendResponseAndClose(res, server, SUCCESS_PAGE);
		handlers.resolve(result.code);
	};
}

/**
 * Start a local HTTP server to receive the OAuth callback
 */
export function startCallbackServer(
	expectedState: string,
	timeout = 300_000,
): Promise<string> {
	return new Promise((resolve, reject) => {
		const handlers: CallbackHandlers = { resolve, reject };

		const server = createServer();
		server.on(
			"request",
			createCallbackHandler(expectedState, server, handlers),
		);

		server.on("error", (err: NodeJS.ErrnoException) => {
			const message =
				err.code === "EADDRINUSE"
					? `Port ${CALLBACK_PORT} is already in use. Please close any other application using this port.`
					: err.message;
			reject(new Error(message));
		});

		const timeoutId = setTimeout(() => {
			server.close();
			reject(new Error("Authentication timed out. Please try again."));
		}, timeout);

		server.on("close", () => clearTimeout(timeoutId));

		server.listen(CALLBACK_PORT, "127.0.0.1");
	});
}

// ─────────────────────────────────────────────────────────────────────────────
// Browser
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Open a URL in the user's default browser
 */
export async function openBrowser(url: string): Promise<void> {
	const { platform } = process;
	const { spawn } = await import("node:child_process");

	let command: string;
	let args: string[];

	if (platform === "darwin") {
		command = "open";
		args = [url];
	} else if (platform === "win32") {
		command = "cmd";
		args = ["/c", "start", "", url];
	} else {
		command = "xdg-open";
		args = [url];
	}

	return new Promise((resolve, reject) => {
		const proc = spawn(command, args, { detached: true, stdio: "ignore" });

		proc.on("error", (err) => {
			reject(new Error(`Failed to open browser: ${err.message}`));
		});

		proc.unref();
		setTimeout(resolve, 500);
	});
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Complete the OAuth flow and store the token
 */
export function completeOAuthFlow(tokenResponse: TokenResponse): void {
	setAuthToken(
		tokenResponse.access_token,
		tokenResponse.expires_in,
		tokenResponse.refresh_token,
	);
}

/**
 * Perform the full OAuth Authorization Code flow
 */
export async function performOAuthFlow(
	config: Partial<OAuthConfig> = {},
): Promise<TokenResponse> {
	const { clientId, clientSecret } = mergeConfig(config);
	validateCredentials(clientId, clientSecret);

	const state = generateState();
	const authUrl = buildAuthorizationUrl(state, config);
	const codePromise = startCallbackServer(state);

	await openBrowser(authUrl);

	const code = await codePromise;
	return exchangeCodeForToken(code, config);
}

/**
 * Alternative: Token-based auth (for users who have an API token)
 */
export function setApiToken(token: string): void {
	setAuthToken(token);
}
