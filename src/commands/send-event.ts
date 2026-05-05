/**
 * `sentry send-event` — Send a Sentry event from CLI flags or a JSON file.
 *
 * Unlike most commands, this authenticates via a DSN (not a Bearer token),
 * so no `sentry auth login` is required. The DSN can be provided via:
 *   1. --dsn flag
 *   2. SENTRY_DSN environment variable
 */

import type { DsnComponents, Event } from "@sentry/core";
import { createEventEnvelope, makeDsn, serializeEnvelope } from "@sentry/core";
import type { SentryContext } from "../context.js";
import { buildCommand } from "../lib/command.js";
import {
  buildEventFromFlags,
  type SendEventFlags,
} from "../lib/envelope/event-builder.js";
import { requireDsn, sendEnvelopeRequest } from "../lib/envelope/transport.js";
import { ConfigError, ValidationError } from "../lib/errors.js";
import { CommandOutput } from "../lib/formatters/output.js";

/** Shape of the data yielded to the output layer. */
type SendEventResult = {
  eventId: string;
  file?: string;
};

function formatSendEventHuman(result: SendEventResult): string {
  if (result.file) {
    return `Event from ${result.file} dispatched: ${result.eventId}`;
  }
  return `Event dispatched.\nEvent ID: ${result.eventId}`;
}

/**
 * Build the envelope body and extract the event ID for a file-based send.
 *
 * In raw mode the file bytes are sent as-is; in normal mode the JSON is
 * parsed, wrapped in an EventEnvelope, and re-serialized.
 */
async function buildFilePayload(
  file: string,
  raw: boolean,
  dsnComponents: DsnComponents
): Promise<{ body: string | Uint8Array; eventId: string }> {
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

  if (raw) {
    const bytes = new Uint8Array(fileBytes);
    // Best-effort: extract event_id from the first line (envelope header JSON).
    // Decode the already-read bytes instead of re-reading the file.
    let eventId = "";
    try {
      const firstLine = new TextDecoder().decode(bytes).split("\n")[0] ?? "{}";
      const header = JSON.parse(firstLine) as Record<string, unknown>;
      eventId = (header.event_id as string) ?? "";
    } catch {
      // Non-critical — event_id is informational only
    }
    return { body: bytes, eventId };
  }

  let event: Event;
  try {
    event = JSON.parse(new TextDecoder().decode(fileBytes)) as Event;
  } catch (err) {
    throw new ValidationError(
      `Failed to parse JSON from ${file}: ${(err as Error).message}`,
      "path"
    );
  }
  const envelope = createEventEnvelope(event, dsnComponents);
  return { body: serializeEnvelope(envelope), eventId: event.event_id ?? "" };
}

export const sendEventCommand = buildCommand({
  docs: {
    brief: "Send a Sentry event",
    fullDescription: `\
Send a Sentry event to the ingest pipeline using DSN-based authentication.

No login required — provide a DSN via --dsn or the SENTRY_DSN environment variable.

## Building an event from flags

\`\`\`
sentry send-event -m "Something went wrong" -l error --tag env:prod
\`\`\`

## Sending from a JSON file

The JSON file must be a valid serialized Sentry Event object:

\`\`\`
sentry send-event ./event.json
\`\`\`

Use --raw to skip JSON parsing and send the file bytes directly to the ingest endpoint.

When file arguments are provided, flags like -m/--message are ignored — the event is
built entirely from the file contents.

## Common flags

| Flag | Description |
|------|-------------|
| \`--dsn\` | DSN to send to (overrides SENTRY_DSN) |
| \`-m\` / \`--message\` | Event message (repeat for multi-line) |
| \`-l\` / \`--level\` | Severity: debug, info, warning, error, fatal |
| \`-r\` / \`--release\` | Release version |
| \`-E\` / \`--env\` | Environment name |
| \`-t\` / \`--tag\` | Tag as KEY:VALUE (repeat for multiple) |
| \`-e\` / \`--extra\` | Extra data as KEY:VALUE |
| \`-u\` / \`--user\` | User info as KEY:VALUE (id, email, username, ip_address) |
| \`-f\` / \`--fingerprint\` | Custom fingerprint parts (repeat) |
`,
  },
  auth: "dsn",
  output: {
    human: formatSendEventHuman,
  },
  parameters: {
    positional: {
      kind: "array",
      parameter: {
        brief: "Path(s) to JSON event file(s) to send",
        parse: String,
        optional: true,
      },
    },
    flags: {
      dsn: {
        kind: "parsed",
        parse: String,
        brief: "DSN to send events to (overrides SENTRY_DSN env var)",
        optional: true,
      },
      message: {
        kind: "parsed",
        parse: String,
        brief: "Event message (repeat for multi-line)",
        variadic: true,
        optional: true,
      },
      "message-arg": {
        kind: "parsed",
        parse: String,
        brief: "Arguments for message template (repeat for multiple)",
        variadic: true,
        optional: true,
      },
      level: {
        kind: "enum",
        values: ["debug", "info", "warning", "error", "fatal"],
        brief: "Event severity level",
        default: "error",
        optional: true,
      },
      release: {
        kind: "parsed",
        parse: String,
        brief: "Release version",
        optional: true,
      },
      dist: {
        kind: "parsed",
        parse: String,
        brief: "Distribution identifier",
        optional: true,
      },
      env: {
        kind: "parsed",
        parse: String,
        brief: "Environment name (e.g. production, staging)",
        optional: true,
      },
      platform: {
        kind: "parsed",
        parse: String,
        brief: "Platform identifier (default: other)",
        optional: true,
      },
      tag: {
        kind: "parsed",
        parse: String,
        brief: "Tag as KEY:VALUE (repeat for multiple)",
        variadic: true,
        optional: true,
      },
      extra: {
        kind: "parsed",
        parse: String,
        brief: "Extra data as KEY:VALUE (repeat for multiple)",
        variadic: true,
        optional: true,
      },
      user: {
        kind: "parsed",
        parse: String,
        brief:
          "User info as KEY:VALUE — id, email, username, ip_address, or custom",
        variadic: true,
        optional: true,
      },
      fingerprint: {
        kind: "parsed",
        parse: String,
        brief: "Custom fingerprint part (repeat for multiple)",
        variadic: true,
        optional: true,
      },
      timestamp: {
        kind: "parsed",
        parse: String,
        brief: "Event timestamp (Unix epoch, ISO 8601, or RFC 2822)",
        optional: true,
      },
      "no-environ": {
        kind: "boolean",
        brief: "Do not include environment variables in the event",
        default: false,
        optional: true,
      },
      raw: {
        kind: "boolean",
        brief: "Send file contents as-is without parsing",
        default: false,
        optional: true,
      },
    },
    aliases: {
      m: "message",
      a: "message-arg",
      l: "level",
      r: "release",
      d: "dist",
      E: "env",
      p: "platform",
      t: "tag",
      e: "extra",
      u: "user",
      f: "fingerprint",
    },
  },
  async *func(
    this: SentryContext,
    flags: SendEventFlags & {
      dsn?: string;
      raw?: boolean;
      json?: boolean;
    },
    ...files: string[]
  ) {
    const dsn = requireDsn(flags, this.cwd);
    const dsnComponents = makeDsn(dsn);
    if (!dsnComponents) {
      throw new ValidationError(`Invalid DSN: ${dsn}`, "dsn");
    }

    if (files.length > 0) {
      for (const file of files) {
        const { body, eventId } = await buildFilePayload(
          file,
          flags.raw ?? false,
          dsnComponents
        );
        await sendEnvelopeRequest(dsn, body);
        yield new CommandOutput<SendEventResult>({ eventId, file });
      }
    } else {
      if (flags.raw) {
        throw new ValidationError(
          "--raw requires a file argument (raw bytes cannot be built from inline flags)",
          "raw"
        );
      }
      if (!flags.message?.length) {
        throw new ConfigError(
          "Provide a message via -m/--message or a JSON event file as a positional argument.",
          "sentry send-event -m 'My message'"
        );
      }
      const event = buildEventFromFlags(flags);
      const envelope = createEventEnvelope(event, dsnComponents);
      await sendEnvelopeRequest(dsn, serializeEnvelope(envelope));
      yield new CommandOutput<SendEventResult>({
        eventId: event.event_id ?? "",
      });
    }
  },
});
