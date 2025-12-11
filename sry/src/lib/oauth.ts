import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { TokenResponse } from "../types/index.js";
import { setAuthToken } from "./config.js";

// OAuth configuration for Sentry
const SENTRY_OAUTH_AUTHORIZE = "https://sentry.io/oauth/authorize/";
const SENTRY_OAUTH_TOKEN = "https://sentry.io/oauth/token/";
const CALLBACK_PORT = 8723;
const CALLBACK_URL = `http://127.0.0.1:${CALLBACK_PORT}/callback`;

// Client credentials from environment variables
const CLIENT_ID = process.env.SRY_CLIENT_ID || "";
const CLIENT_SECRET = process.env.SRY_CLIENT_SECRET || "";

interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  scopes: string[];
}

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

/**
 * Generate a random state parameter for CSRF protection
 */
function generateState(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, (byte) => byte.toString(16).padStart(2, "0")).join(
    ""
  );
}

/**
 * Build the authorization URL for Sentry OAuth
 */
export function buildAuthorizationUrl(
  state: string,
  config: Partial<OAuthConfig> = {}
): string {
  const { clientId, scopes } = { ...defaultConfig, ...config };

  if (!clientId) {
    throw new Error(
      "Client ID not configured. Set SRY_CLIENT_ID environment variable."
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

/**
 * Exchange authorization code for access token
 */
export async function exchangeCodeForToken(
  code: string,
  config: Partial<OAuthConfig> = {}
): Promise<TokenResponse> {
  const { clientId, clientSecret } = { ...defaultConfig, ...config };

  if (!(clientId && clientSecret)) {
    throw new Error(
      "OAuth credentials not configured. Set SRY_CLIENT_ID and SRY_CLIENT_SECRET environment variables."
    );
  }

  const response = await fetch(SENTRY_OAUTH_TOKEN, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
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
 * Start a local HTTP server to receive the OAuth callback
 * Returns the authorization code when received
 */
export function startCallbackServer(
  expectedState: string,
  timeout = 300_000 // 5 minutes default
): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url || "", `http://127.0.0.1:${CALLBACK_PORT}`);

      if (url.pathname === "/callback") {
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        const error = url.searchParams.get("error");
        const errorDescription = url.searchParams.get("error_description");

        // Send response to browser
        res.writeHead(200, { "Content-Type": "text/html" });

        if (error) {
          res.end(`
            <!DOCTYPE html>
            <html>
              <head>
                <title>Authentication Failed</title>
                <style>
                  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
                         display: flex; align-items: center; justify-content: center; height: 100vh; 
                         margin: 0; background: #1a1a2e; color: #eee; }
                  .container { text-align: center; padding: 2rem; }
                  h1 { color: #ff6b6b; }
                  p { color: #aaa; }
                </style>
              </head>
              <body>
                <div class="container">
                  <h1>✗ Authentication Failed</h1>
                  <p>${errorDescription || error}</p>
                  <p>You can close this window.</p>
                </div>
              </body>
            </html>
          `);
          server.close();
          reject(new Error(errorDescription || error));
          return;
        }

        if (!code) {
          res.end(`
            <!DOCTYPE html>
            <html>
              <head>
                <title>Authentication Failed</title>
                <style>
                  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
                         display: flex; align-items: center; justify-content: center; height: 100vh; 
                         margin: 0; background: #1a1a2e; color: #eee; }
                  .container { text-align: center; padding: 2rem; }
                  h1 { color: #ff6b6b; }
                </style>
              </head>
              <body>
                <div class="container">
                  <h1>✗ Authentication Failed</h1>
                  <p>No authorization code received.</p>
                  <p>You can close this window.</p>
                </div>
              </body>
            </html>
          `);
          server.close();
          reject(new Error("No authorization code received"));
          return;
        }

        if (state !== expectedState) {
          res.end(`
            <!DOCTYPE html>
            <html>
              <head>
                <title>Authentication Failed</title>
                <style>
                  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
                         display: flex; align-items: center; justify-content: center; height: 100vh; 
                         margin: 0; background: #1a1a2e; color: #eee; }
                  .container { text-align: center; padding: 2rem; }
                  h1 { color: #ff6b6b; }
                </style>
              </head>
              <body>
                <div class="container">
                  <h1>✗ Authentication Failed</h1>
                  <p>State mismatch - possible CSRF attack.</p>
                  <p>You can close this window.</p>
                </div>
              </body>
            </html>
          `);
          server.close();
          reject(new Error("State mismatch - possible CSRF attack"));
          return;
        }

        // Success!
        res.end(`
          <!DOCTYPE html>
          <html>
            <head>
              <title>Authentication Successful</title>
              <style>
                body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
                       display: flex; align-items: center; justify-content: center; height: 100vh; 
                       margin: 0; background: #1a1a2e; color: #eee; }
                .container { text-align: center; padding: 2rem; }
                h1 { color: #51cf66; }
                p { color: #aaa; }
              </style>
            </head>
            <body>
              <div class="container">
                <h1>✓ Authentication Successful</h1>
                <p>You can close this window and return to the terminal.</p>
              </div>
            </body>
          </html>
        `);
        server.close();
        resolve(code);
      } else {
        res.writeHead(404);
        res.end("Not found");
      }
    });

    // Handle server errors
    server.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        reject(
          new Error(
            `Port ${CALLBACK_PORT} is already in use. Please close any other application using this port.`
          )
        );
      } else {
        reject(err);
      }
    });

    // Set timeout
    const timeoutId = setTimeout(() => {
      server.close();
      reject(new Error("Authentication timed out. Please try again."));
    }, timeout);

    server.on("close", () => {
      clearTimeout(timeoutId);
    });

    // Start listening
    server.listen(CALLBACK_PORT, "127.0.0.1", () => {
      // Server is ready
    });
  });
}

/**
 * Complete the OAuth flow and store the token
 */
export async function completeOAuthFlow(
  tokenResponse: TokenResponse
): Promise<void> {
  setAuthToken(
    tokenResponse.access_token,
    tokenResponse.expires_in,
    tokenResponse.refresh_token
  );
}

/**
 * Perform the full OAuth Authorization Code flow
 */
export async function performOAuthFlow(
  config: Partial<OAuthConfig> = {}
): Promise<TokenResponse> {
  const { clientId, clientSecret } = { ...defaultConfig, ...config };

  if (!(clientId && clientSecret)) {
    throw new Error(
      "OAuth credentials not configured.\n\n" +
        "Please set the following environment variables:\n" +
        "  export SRY_CLIENT_ID='your-client-id'\n" +
        "  export SRY_CLIENT_SECRET='your-client-secret'\n\n" +
        "Or use --token flag to authenticate with an API token:\n" +
        "  sry auth login --token YOUR_API_TOKEN"
    );
  }

  // Generate state for CSRF protection
  const state = generateState();

  // Build authorization URL
  const authUrl = buildAuthorizationUrl(state, config);

  // Start callback server (will wait for the redirect)
  const codePromise = startCallbackServer(state);

  // Open browser
  await openBrowser(authUrl);

  // Wait for authorization code
  const code = await codePromise;

  // Exchange code for token
  const tokenResponse = await exchangeCodeForToken(code, config);

  return tokenResponse;
}

/**
 * Refresh an access token using a refresh token
 */
export async function refreshAccessToken(
  refreshToken: string,
  config: Partial<OAuthConfig> = {}
): Promise<TokenResponse> {
  const { clientId, clientSecret } = { ...defaultConfig, ...config };

  if (!(clientId && clientSecret)) {
    throw new Error(
      "OAuth credentials not configured. Set SRY_CLIENT_ID and SRY_CLIENT_SECRET environment variables."
    );
  }

  const response = await fetch(SENTRY_OAUTH_TOKEN, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
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

/**
 * Open a URL in the user's default browser
 */
export async function openBrowser(url: string): Promise<void> {
  const { platform } = process;

  let command: string;
  let args: string[];

  if (platform === "darwin") {
    command = "open";
    args = [url];
  } else if (platform === "win32") {
    command = "cmd";
    args = ["/c", "start", "", url];
  } else {
    // Linux and others
    command = "xdg-open";
    args = [url];
  }

  const { spawn } = await import("node:child_process");

  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      detached: true,
      stdio: "ignore",
    });

    proc.on("error", (err) => {
      reject(new Error(`Failed to open browser: ${err.message}`));
    });

    proc.unref();
    // Give the browser a moment to start
    setTimeout(resolve, 500);
  });
}

/**
 * Alternative: Token-based auth (for users who have an API token)
 * This is simpler than OAuth for personal use
 */
export function setApiToken(token: string): void {
  // API tokens don't expire, so we don't set an expiration
  setAuthToken(token);
}
