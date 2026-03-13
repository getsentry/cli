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
import { formatDuration, formatUserIdentity } from "./formatters/human.js";
import { logger } from "./logger.js";
import { completeOAuthFlow, performDeviceFlow } from "./oauth.js";
import { generateQRCode } from "./qrcode.js";

const log = logger.withTag("auth.login");

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
 * structured command output.
 *
 * @param stdin - Input stream for keyboard listener (must be TTY)
 * @param options - Optional configuration
 * @returns true on successful authentication, false on failure/cancellation
 */
export async function runInteractiveLogin(
  stdin: NodeJS.ReadStream & { fd: 0 },
  options?: InteractiveLoginOptions
): Promise<boolean> {
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
          const copyHint = stdin.isTTY ? ` ${muted("(c to copy)")}` : "";
          log.info(
            `Browser didn't open? Use the url above to sign in${copyHint}`
          );
          log.info("Waiting for authorization...");

          // Setup keyboard listener for 'c' to copy URL
          keyListener.cleanup = setupCopyKeyListener(stdin, () => urlToCopy);
        },
        onPolling: () => {
          // Dots append on the same line without newlines — logger can't do this
          process.stderr.write(".");
        },
      },
      timeout
    );

    // Clear the polling dots
    process.stderr.write("\n");

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

    log.success("Authentication successful!");
    if (user) {
      log.info(`Logged in as: ${muted(formatUserIdentity(user))}`);
    }
    log.info(`Config saved to: ${getDbPath()}`);

    if (tokenResponse.expires_in) {
      log.info(`Token expires in: ${formatDuration(tokenResponse.expires_in)}`);
    }

    return true;
  } catch (err) {
    process.stderr.write("\n");
    log.error(formatError(err));
    return false;
  } finally {
    // Always cleanup keyboard listener
    keyListener.cleanup?.();
  }
}
