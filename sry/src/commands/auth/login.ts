import { buildCommand, numberParser } from "@stricli/core";
import type { SryContext } from "../../context.js";
import { getConfigPath, isAuthenticated } from "../../lib/config.js";
import {
  completeOAuthFlow,
  performOAuthFlow,
  setApiToken,
} from "../../lib/oauth.js";

type LoginFlags = {
  readonly token?: string;
  readonly timeout: number;
};

export const loginCommand = buildCommand({
  docs: {
    brief: "Authenticate with Sentry",
    fullDescription:
      "Log in to Sentry using OAuth or an API token. " +
      "The OAuth flow will open your browser for authentication. " +
      "Alternatively, use --token to authenticate with an existing API token.\n\n" +
      "For OAuth, set these environment variables:\n" +
      "  SRY_CLIENT_ID     - Your Sentry OAuth app client ID\n" +
      "  SRY_CLIENT_SECRET - Your Sentry OAuth app client secret",
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
        brief: "Timeout for OAuth flow in seconds (default: 300)",
        default: 300,
      },
    },
  },
  async func(this: SryContext, flags: LoginFlags): Promise<void> {
    const { process } = this;

    // Check if already authenticated
    if (isAuthenticated()) {
      process.stdout.write(
        "You are already authenticated. Use 'sry auth logout' first to re-authenticate.\n"
      );
      return;
    }

    // Token-based authentication
    if (flags.token) {
      setApiToken(flags.token);
      process.stdout.write("✓ Authenticated with API token\n");
      process.stdout.write(`  Config saved to: ${getConfigPath()}\n`);
      return;
    }

    // OAuth Authorization Code flow
    process.stdout.write("Starting OAuth authentication...\n\n");

    try {
      process.stdout.write("Opening browser for Sentry authorization...\n");
      process.stdout.write(
        `Waiting for authorization (timeout: ${flags.timeout}s)...\n\n`
      );

      // Perform the full OAuth flow
      const tokenResponse = await performOAuthFlow();

      // Store the token
      await completeOAuthFlow(tokenResponse);

      process.stdout.write("\n✓ Authentication successful!\n");
      process.stdout.write(`  Config saved to: ${getConfigPath()}\n`);

      if (tokenResponse.expires_in) {
        const hours = Math.round(tokenResponse.expires_in / 3600);
        process.stdout.write(`  Token expires in: ${hours} hours\n`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`\n✗ Authentication failed: ${message}\n`);
      process.exitCode = 1;
    }
  },
});
