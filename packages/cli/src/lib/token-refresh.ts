/**
 * Token Refresh
 *
 * Proactively refreshes OAuth tokens before they expire.
 * This runs in the background on every CLI command to ensure
 * users don't get unexpectedly logged out.
 */

import { readConfig, setAuthToken } from "./config.js";
import { refreshAccessToken } from "./oauth.js";

// Threshold: 5 days in milliseconds
// If token expires within this time, we'll refresh it
const REFRESH_THRESHOLD_MS = 5 * 24 * 60 * 60 * 1000;

/**
 * Check if token needs refresh and refresh it in the background.
 *
 * This function is designed to be called fire-and-forget.
 * It silently succeeds or fails without affecting the caller.
 *
 * @example
 * // At CLI startup (fire-and-forget)
 * maybeRefreshTokenInBackground().catch(() => {});
 */
export async function maybeRefreshTokenInBackground(): Promise<void> {
  const config = await readConfig();

  // Skip if no auth configured
  if (!config.auth?.token) {
    return;
  }

  // Skip if no refresh token (e.g., API token auth, not OAuth)
  if (!config.auth.refreshToken) {
    return;
  }

  // Skip if no expiration info (shouldn't happen, but be safe)
  if (!config.auth.expiresAt) {
    return;
  }

  // Check if token expires within 5 days
  const timeUntilExpiry = config.auth.expiresAt - Date.now();
  if (timeUntilExpiry > REFRESH_THRESHOLD_MS) {
    return; // Token is still fresh, no action needed
  }

  // Token needs refresh - do it
  const tokenResponse = await refreshAccessToken(config.auth.refreshToken);

  // Save the new token
  await setAuthToken(
    tokenResponse.access_token,
    tokenResponse.expires_in,
    tokenResponse.refresh_token
  );
}
