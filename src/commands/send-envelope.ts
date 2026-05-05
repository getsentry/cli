/**
 * `sentry send-envelope` — Send a pre-built Sentry envelope file.
 *
 * Reads one or more envelope files from disk and POSTs them to the Sentry
 * ingest endpoint via DSN-based authentication.
 *
 * Envelope files use the Sentry envelope format:
 *   https://develop.sentry.dev/sdk/envelopes/
 *
 * No `sentry auth login` required — provide a DSN via --dsn or SENTRY_DSN.
 */

import { parseEnvelope, serializeEnvelope } from "@sentry/core";
import type { SentryContext } from "../context.js";
import { buildCommand } from "../lib/command.js";
import { requireDsn, sendEnvelopeRequest } from "../lib/envelope/transport.js";
import { ValidationError } from "../lib/errors.js";
import { CommandOutput } from "../lib/formatters/output.js";

type SendEnvelopeResult = {
  file: string;
};

function formatSendEnvelopeHuman(result: SendEnvelopeResult): string {
  return `Envelope from ${result.file} dispatched`;
}

export const sendEnvelopeCommand = buildCommand({
  docs: {
    brief: "Send a Sentry envelope file",
    fullDescription: `\
Send a pre-built Sentry envelope file to the ingest pipeline.

No login required — provide a DSN via --dsn or the SENTRY_DSN environment variable.

Envelope files follow the Sentry envelope format (newline-delimited JSON headers
followed by item payloads). These are typically produced by Sentry SDKs in
offline/buffered mode, or captured for debugging purposes.

## Examples

\`\`\`
# Send a single envelope file
sentry send-envelope ./captured.envelope

# Send without parsing (useful for binary envelopes or debugging)
sentry send-envelope --raw ./captured.envelope

# Send multiple envelope files
sentry send-envelope ./a.envelope ./b.envelope
\`\`\`
`,
  },
  auth: "dsn",
  output: {
    human: formatSendEnvelopeHuman,
  },
  parameters: {
    positional: {
      kind: "array",
      parameter: {
        brief: "Path(s) to envelope file(s) to send",
        parse: String,
        placeholder: "path",
      },
    },
    flags: {
      dsn: {
        kind: "parsed",
        parse: String,
        brief: "DSN to send envelopes to (overrides SENTRY_DSN env var)",
        optional: true,
      },
      raw: {
        kind: "boolean",
        brief: "Send file bytes without parsing or validating the envelope",
        default: false,
        optional: true,
      },
    },
  },
  async *func(
    this: SentryContext,
    flags: { dsn?: string; raw?: boolean },
    ...files: string[]
  ) {
    if (files.length === 0) {
      throw new ValidationError(
        "At least one envelope file path is required.",
        "path"
      );
    }

    const dsn = requireDsn(flags, this.cwd);

    for (const file of files) {
      let body: string | Uint8Array;

      let fileBytes: ArrayBuffer;
      try {
        fileBytes = await Bun.file(file).arrayBuffer();
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === "ENOENT") {
          throw new ValidationError(`File not found: ${file}`, "path");
        }
        throw new ValidationError(
          `Cannot read file ${file}: ${(err as Error).message}`,
          "path"
        );
      }

      if (flags.raw) {
        body = new Uint8Array(fileBytes);
      } else {
        const text = new TextDecoder().decode(fileBytes);
        // Parse to validate, then re-serialize to normalize
        try {
          const envelope = parseEnvelope(text);
          body = serializeEnvelope(envelope);
        } catch (err) {
          throw new ValidationError(
            `Failed to parse envelope from ${file}: ${(err as Error).message}`,
            "path"
          );
        }
      }

      await sendEnvelopeRequest(dsn, body);
      yield new CommandOutput<SendEnvelopeResult>({ file });
    }
  },
});
