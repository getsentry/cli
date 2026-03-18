/**
 * Interactive Login Flow
 *
 * Reusable OAuth device flow with UI for interactive terminals.
 * Used by both the `auth login` command and auto-auth in bin.ts.
 */

// biome-ignore lint/performance/noNamespaceImport: Sentry SDK recommends namespace import
import * as Sentry from "@sentry/bun";
import { openBrowser } from "./browser.js";
import { setupCopyKeyListener } from "./clipboard.js";
import { getDbPath } from "./db/index.js";
import { setUserInfo } from "./db/user.js";
import { formatError } from "./errors.js";
import { muted } from "./formatters/colors.js";
import { logger } from "./logger.js";
import { completeOAuthFlow, performDeviceFlow } from "./oauth.js";
import { generateQRCode } from "./qrcode.js";

const log = logger.withTag("auth.login");

/** Structured result returned on successful authentication. */
export type LoginResult = {
  /** Authentication method used. */
  method: "oauth" | "token";
  /** User identity if available. */
  user?: { name?: string; email?: string; username?: string; id?: string };
  /** Path where credentials are stored. */
  configPath: string;
  /** Token lifetime in seconds, if known. */
  expiresIn?: number;
};

/** Options for the interactive login flow */
export type InteractiveLoginOptions = {
  /** Timeout for OAuth flow in milliseconds (default: 900000 = 15 minutes) */
  timeout?: number;
};

/**
 * Run the interactive OAuth device flow login.
 *
 * Handles the full device flow including:
 * - Displaying verification URL and user code
 * - Opening browser automatically (or showing QR code as fallback)
 * - Setting up keyboard listener for copying URL
 * - Storing the token and user info on success
 *
 * All UI output goes to stderr via the logger, keeping stdout clean for
 * structured command output. A spinner replaces raw polling dots for a
 * cleaner interactive experience.
 *
 * @param options - Optional configuration
 * @returns Structured login result on success, or null on failure/cancellation
 */
export async function runInteractiveLogin(
  options?: InteractiveLoginOptions
): Promise<LoginResult | null> {
  const timeout = options?.timeout ?? 900_000; // 15 minutes default

  log.info("Starting authentication...");

  let urlToCopy = "";
  // Object wrapper needed for TypeScript control flow analysis with async callbacks
  const keyListener = { cleanup: null as (() => void) | null };

  try {
    const tokenResponse = await performDeviceFlow(
      {
        onUserCode: async (
          userCode,
          verificationUri,
          verificationUriComplete
        ) => {
          urlToCopy = verificationUriComplete;

          // Try to open browser (best effort)
          const browserOpened = await openBrowser(verificationUriComplete);

          if (browserOpened) {
            log.info("Opening in browser...");
          } else {
            // Show QR code as fallback when browser can't open
            log.info("Scan this QR code or visit the URL below:");
            const qr = await generateQRCode(verificationUriComplete);
            log.log(qr);
          }

          log.info(`URL: ${verificationUri}`);
          log.info(`Code: ${userCode}`);
          const stdin = process.stdin;
          const copyHint = stdin.isTTY ? ` ${muted("(c to copy)")}` : "";
          log.info(
            `Browser didn't open? Use the url above to sign in${copyHint}`
          );

          // Use a spinner for the "waiting" state instead of raw polling dots
          log.start("Waiting for authorization...");

          // Setup keyboard listener for 'c' to copy URL
          if (stdin.isTTY) {
            keyListener.cleanup = setupCopyKeyListener(
              stdin as NodeJS.ReadStream & { fd: 0 },
              () => urlToCopy
            );
          }
        },
      },
      timeout
    );

    // Stop the spinner
    log.success("Authorization received!");

    // Store the token
    await completeOAuthFlow(tokenResponse);

    // Store user info from token response for telemetry and display
    const user = tokenResponse.user;
    if (user) {
      try {
        setUserInfo({
          userId: user.id,
          email: user.email,
          name: user.name,
        });
      } catch (error) {
        // Report to Sentry but don't block auth - user info is not critical
        Sentry.captureException(error);
      }
    }

    const result: LoginResult = {
      method: "oauth",
      configPath: getDbPath(),
      expiresIn: tokenResponse.expires_in,
    };
    if (user) {
      result.user = user;
    }
    return result;
  } catch (err) {
    log.fail("Authorization failed");
    log.error(formatError(err));
    return null;
  } finally {
    // Always cleanup keyboard listener
    keyListener.cleanup?.();
  }
}
