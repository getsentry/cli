import { buildCommand } from "@stricli/core";
import type { SryContext } from "../../context.js";
import { detectDSN } from "../../lib/dsn-finder.js";

interface DetectFlags {
  readonly json: boolean;
  readonly save: boolean;
}

export const detectCommand = buildCommand({
  docs: {
    brief: "Detect Sentry DSN in current project",
    fullDescription:
      "Scan your project files to find Sentry DSN configurations. " +
      "This searches common configuration files like .env, sentry.*.config.js, " +
      "and source files for DSN patterns. Use --save to store the detected " +
      "project as your default.",
  },
  parameters: {
    flags: {
      json: {
        kind: "boolean",
        brief: "Output as JSON",
        default: false,
      },
      save: {
        kind: "boolean",
        brief: "Save detected project as default",
        default: false,
      },
    },
  },
  async func(this: SryContext, flags: DetectFlags): Promise<void> {
    const { process } = this;
    const cwd = process.cwd();

    process.stdout.write(`Scanning for Sentry DSN in ${cwd}...\n\n`);

    try {
      const result = await detectDSN(cwd);

      if (!result) {
        process.stdout.write("No Sentry DSN found in this project.\n\n");
        process.stdout.write("Looked in:\n");
        process.stdout.write("  - .env, .env.local, .env.production\n");
        process.stdout.write("  - sentry.*.config.js/ts\n");
        process.stdout.write("  - next.config.js\n");
        process.stdout.write("  - sentry.properties\n");
        process.stdout.write("  - package.json\n");
        process.stdout.write(
          "  - Common source directories (src/, lib/, app/)\n"
        );
        return;
      }

      if (flags.json) {
        process.stdout.write(JSON.stringify(result, null, 2) + "\n");
        return;
      }

      process.stdout.write("✓ Found Sentry DSN!\n\n");
      process.stdout.write(`Source:     ${result.source}\n`);
      process.stdout.write(`File:       ${result.filePath}\n`);
      process.stdout.write(`DSN:        ${result.dsn}\n\n`);

      process.stdout.write("Parsed DSN:\n");
      process.stdout.write(`  Protocol:   ${result.parsed.protocol}\n`);
      process.stdout.write(`  Public Key: ${result.parsed.publicKey}\n`);
      process.stdout.write(`  Host:       ${result.parsed.host}\n`);
      process.stdout.write(`  Project ID: ${result.parsed.projectId}\n`);

      // Note: To fully resolve org/project slugs, we'd need to call the Sentry API
      // For now, we just display the DSN info

      if (flags.save) {
        // We can't easily save org/project without an API call to resolve them
        // from the DSN. For now, just inform the user.
        process.stdout.write(
          "\nNote: To save defaults, you'll need to specify org/project explicitly:\n"
        );
        process.stdout.write(
          "  sry config set defaults.organization <org-slug>\n"
        );
        process.stdout.write(
          "  sry config set defaults.project <project-slug>\n"
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`Error detecting DSN: ${message}\n`);
      process.exitCode = 1;
    }
  },
});
