// biome-ignore lint/performance/noNamespaceImport: Sentry SDK recommends namespace import
import * as Sentry from "@sentry/bun";
import { buildCommand, numberParser } from "@stricli/core";
import type { SentryContext } from "../../context.js";
import { getCurrentUser } from "../../lib/api-client.js";
import { openBrowser } from "../../lib/browser.js";
import { setupCopyKeyListener } from "../../lib/clipboard.js";
import { clearAuth, isAuthenticated, setAuthToken } from "../../lib/db/auth.js";
import { getDbPath } from "../../lib/db/index.js";
import { setUserInfo } from "../../lib/db/user.js";
import { AuthError } from "../../lib/errors.js";
import { muted, success } from "../../lib/formatters/colors.js";
import { formatDuration } from "../../lib/formatters/human.js";
import { completeOAuthFlow, performDeviceFlow } from "../../lib/oauth.js";
import { generateQRCode } from "../../lib/qrcode.js";
import type { SentryUser } from "../../types/index.js";

type LoginFlags = {
  readonly token?: string;
  readonly timeout: number;
};

export const loginCommand = buildCommand({
  docs: {
    brief: "Authenticate with Sentry",
    fullDescription:
      "Log in to Sentry using OAuth or an API token.\n\n" +
      "The OAuth flow uses a device code - you'll be given a code to enter at a URL.\n" +
      "Alternatively, use --token to authenticate with an existing API token.",
  },
  parameters: {
    flags: {
      token: {
        kind: "parsed",
        parse: String,
        brief: "Authenticate using an API token instead of OAuth",
        optional: true,
      },
      timeout: {
        kind: "parsed",
        parse: numberParser,
        brief: "Timeout for OAuth flow in seconds (default: 900)",
        // Stricli requires string defaults (raw CLI input); numberParser converts to number
        default: "900",
      },
    },
  },
  async func(this: SentryContext, flags: LoginFlags): Promise<void> {
    const { stdout } = this;

    // Check if already authenticated
    if (await isAuthenticated()) {
      stdout.write(
        "You are already authenticated. Use 'sentry auth logout' first to re-authenticate.\n"
      );
      return;
    }

    // Token-based authentication
    if (flags.token) {
      // Save token first, then validate by fetching user info
      await setAuthToken(flags.token);

      // Validate token and fetch user info in one call
      let user: SentryUser;
      try {
        user = await getCurrentUser();
        setUserInfo({
          userId: user.id,
          email: user.email,
          username: user.username,
        });
      } catch {
        // Token is invalid - clear it and throw
        await clearAuth();
        throw new AuthError(
          "invalid",
          "Invalid API token. Please check your token and try again."
        );
      }

      stdout.write(`${success("✓")} Authenticated with API token\n`);
      stdout.write(
        `  Logged in as ${muted(`${user.username} <${user.email}>`)}\n`
      );
      stdout.write(`  Config saved to: ${getDbPath()}\n`);
      return;
    }

    // Device Flow OAuth
    stdout.write("Starting authentication...\n\n");

    let urlToCopy = "";
    // Object wrapper needed for TypeScript control flow analysis with async callbacks
    const keyListener = { cleanup: null as (() => void) | null };
    const stdin = process.stdin;

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
        flags.timeout * 1000
      );

      // Clear the polling dots
      stdout.write("\n\n");

      // Store the token
      await completeOAuthFlow(tokenResponse);

      // Fetch and store user info for telemetry
      let user: SentryUser | undefined;
      try {
        user = await getCurrentUser();
        setUserInfo({
          userId: user.id,
          email: user.email,
          username: user.username,
        });
      } catch (error) {
        // Report to Sentry but don't block auth - user info is not critical
        Sentry.captureException(error);
      }

      stdout.write(`${success("✓")} Authentication successful!\n`);
      if (user) {
        stdout.write(
          `  Logged in as ${muted(`${user.username} <${user.email}>`)}\n`
        );
      }
      stdout.write(`  Config saved to: ${getDbPath()}\n`);

      if (tokenResponse.expires_in) {
        stdout.write(
          `  Token expires in: ${formatDuration(tokenResponse.expires_in)}\n`
        );
      }
    } finally {
      // Always cleanup keyboard listener
      keyListener.cleanup?.();
    }
  },
});
