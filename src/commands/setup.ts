import { isatty } from "node:tty";
import type { SentryContext } from "../context.js";
import { buildCommand } from "../lib/command.js";
import {
  checkPiAuth,
  createSetupSession,
  runSetupRepl,
} from "../lib/setup/agent.js";
import { fetchSentrySkills } from "../lib/setup/skills.js";

/**
 * Top-level `sentry setup` command.
 *
 * Launches an interactive AI assistant that helps developers set up or improve
 * Sentry SDK instrumentation in their project. The assistant detects the project
 * language and framework, recommends appropriate Sentry features, and guides the
 * user through implementation via a REPL loop backed by a model provider.
 *
 * Requires an interactive terminal (TTY) and at least one model provider API key
 * (Anthropic, Google, or OpenAI) to be configured in the environment.
 */
export const setupCommand = buildCommand({
  docs: {
    brief: "Set up Sentry in your project",
    fullDescription:
      "Launch an interactive AI assistant that helps set up or improve Sentry SDK\n" +
      "instrumentation in your project.\n\n" +
      "The assistant detects your project's language and framework, recommends\n" +
      "appropriate Sentry features, and guides you through implementation.\n\n" +
      "Requires a model provider API key (Anthropic, Google, OpenAI, etc.).\n" +
      "Set one via environment variable or run `pi` to configure.\n\n" +
      "Examples:\n" +
      "  sentry setup    # Start the setup wizard in your project",
  },
  parameters: {
    flags: {},
  },
  // biome-ignore lint/suspicious/noExplicitAny: empty flags type
  async func(this: SentryContext, _flags: any) {
    const { stdout, stderr, cwd } = this;

    if (!isatty(0)) {
      stderr.write("Error: sentry setup requires an interactive terminal.\n");
      this.process.exitCode = 1;
      return;
    }

    if (!(await checkPiAuth())) {
      stderr.write(
        "No AI model provider configured.\n\n" +
          "To use sentry setup, you need an API key for a model provider.\n" +
          "Set one of these environment variables:\n\n" +
          "  ANTHROPIC_API_KEY    (Claude)\n" +
          "  GEMINI_API_KEY       (Gemini)\n" +
          "  OPENAI_API_KEY       (GPT)\n\n" +
          "Or run `pi` to configure a provider interactively.\n"
      );
      this.process.exitCode = 1;
      return;
    }

    const skillPaths = await fetchSentrySkills(stderr);

    const session = await createSetupSession(cwd, skillPaths);

    stdout.write("Setting up Sentry for your project...\n\n");

    await runSetupRepl(session, this.stdin, stdout, stderr);

    stdout.write("\nGoodbye!\n");
  },
});
