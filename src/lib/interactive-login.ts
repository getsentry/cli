/**
 * Interactive Login Flow
 *
 * Reusable OAuth device flow with UI for interactive terminals.
 * Used by both the `auth login` command and auto-auth in bin.ts.
 */

// biome-ignore lint/performance/noNamespaceImport: Sentry SDK recommends namespace import
import * as Sentry from "@sentry/bun";
import type { Writer } from "../types/index.js";
import { openBrowser } from "./browser.js";
import { setupCopyKeyListener } from "./clipboard.js";
import { getDbPath } from "./db/index.js";
import { setUserInfo } from "./db/user.js";
import { CliError } from "./errors.js";
import { error as errorColor, muted, success } from "./formatters/colors.js";
import { formatDuration, formatUserIdentity } from "./formatters/human.js";
import { completeOAuthFlow, performDeviceFlow } from "./oauth.js";
import { generateQRCode } from "./qrcode.js";

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
 * @param stdout - Output stream for displaying messages
 * @param stdin - Input stream for keyboard listener (must be TTY)
 * @param options - Optional configuration
 * @returns true on successful authentication, false on failure/cancellation
 */
export async function runInteractiveLogin(
  stdout: Writer,
  stdin: NodeJS.ReadStream & { fd: 0 },
  options?: InteractiveLoginOptions
): Promise<boolean> {
  const timeout = options?.timeout ?? 900_000; // 15 minutes default

  stdout.write("Starting authentication...\n\n");

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
            stdout.write("Opening in browser...\n\n");
          } else {
            // Show QR code as fallback when browser can't open
            stdout.write("Scan this QR code or visit the URL below:\n\n");
            const qr = await generateQRCode(verificationUriComplete);
            stdout.write(qr);
            stdout.write("\n");
          }

          stdout.write(`URL: ${verificationUri}\n`);
          stdout.write(`Code: ${userCode}\n\n`);
          const copyHint = stdin.isTTY ? ` ${muted("(c to copy)")}` : "";
          stdout.write(
            `Browser didn't open? Use the url above to sign in${copyHint}\n\n`
          );
          stdout.write("Waiting for authorization...\n");

          // Setup keyboard listener for 'c' to copy URL
          keyListener.cleanup = setupCopyKeyListener(
            stdin,
            () => urlToCopy,
            stdout
          );
        },
        onPolling: () => {
          stdout.write(".");
        },
      },
      timeout
    );

    // Clear the polling dots
    stdout.write("\n");

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

    stdout.write(`${success("✓")} Authentication successful!\n`);
    if (user) {
      stdout.write(`  Logged in as: ${muted(formatUserIdentity(user))}\n`);
    }
    stdout.write(`  Config saved to: ${getDbPath()}\n`);

    if (tokenResponse.expires_in) {
      stdout.write(
        `  Token expires in: ${formatDuration(tokenResponse.expires_in)}\n`
      );
    }

    return true;
  } catch (err) {
    // Show error message to user
    stdout.write("\n");
    if (err instanceof CliError) {
      stdout.write(`${errorColor("Error:")} ${err.format()}\n`);
    } else if (err instanceof Error) {
      stdout.write(`${errorColor("Error:")} ${err.message}\n`);
    }
    return false;
  } finally {
    // Always cleanup keyboard listener
    keyListener.cleanup?.();
  }
}
