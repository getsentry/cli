import type { InitEvent } from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isWizardOutput(value: unknown): boolean {
  return isRecord(value);
}

/**
 * Validate a streamed init event before the wizard runner consumes it.
 */
export function assertInitEvent(raw: unknown): InitEvent {
  if (!isRecord(raw) || typeof raw.type !== "string") {
    throw new Error("Invalid init event");
  }

  switch (raw.type) {
    case "status":
      if (typeof raw.message !== "string") {
        throw new Error("Invalid status event");
      }
      return raw as InitEvent;
    case "action_request":
      if (
        typeof raw.actionId !== "string" ||
        (raw.kind !== "tool" && raw.kind !== "prompt") ||
        typeof raw.name !== "string"
      ) {
        throw new Error("Invalid action_request event");
      }
      return raw as InitEvent;
    case "action_result":
      if (typeof raw.actionId !== "string" || typeof raw.ok !== "boolean") {
        throw new Error("Invalid action_result event");
      }
      return raw as InitEvent;
    case "warning":
      if (typeof raw.message !== "string") {
        throw new Error("Invalid warning event");
      }
      return raw as InitEvent;
    case "summary":
      if (!isWizardOutput(raw.output)) {
        throw new Error("Invalid summary event");
      }
      return raw as InitEvent;
    case "error":
      if (typeof raw.message !== "string") {
        throw new Error("Invalid error event");
      }
      return raw as InitEvent;
    case "done":
      if (typeof raw.ok !== "boolean") {
        throw new Error("Invalid done event");
      }
      return raw as InitEvent;
    case "heartbeat":
      // Server-side stream keepalive (see InitHeartbeatEvent). No
      // payload to validate; the runner advances `nextStartIndex` and
      // otherwise ignores it.
      return raw as InitEvent;
    default:
      throw new Error(`Unknown init event type: ${String(raw.type)}`);
  }
}

/**
 * Read the CLI progress stream as NDJSON and invoke `onEvent` for each
 * typed event. Returns the number of events processed.
 */
export async function readNdjsonStream(
  response: Response,
  onEvent: (event: InitEvent) => Promise<void>
): Promise<number> {
  if (!response.body) {
    throw new Error("Init stream response had no body");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let eventCount = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      let newlineIndex = buffer.indexOf("\n");

      while (newlineIndex !== -1) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (line) {
          await onEvent(assertInitEvent(JSON.parse(line)));
          eventCount += 1;
        }
        newlineIndex = buffer.indexOf("\n");
      }
    }

    buffer += decoder.decode();
    const trailing = buffer.trim();
    if (trailing) {
      await onEvent(assertInitEvent(JSON.parse(trailing)));
      eventCount += 1;
    }
  } finally {
    reader.releaseLock();
  }

  return eventCount;
}
