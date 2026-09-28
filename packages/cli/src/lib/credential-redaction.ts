/**
 * Stateless credential redaction for CLI diagnostics and telemetry.
 * Kept separate from API data formatting so successful responses stay intact.
 */

import { type Envelope, normalize } from "@sentry/core";

const INVALID_BEARER_HEADER_START =
  /(\bHeaders\.(?:set|append):[ \t]*)(\\*["'])Bearer[ \t]+/gi;
const INVALID_HEADER_END = /(?<!\\)(\\*["']) is an invalid header value/gi;
// Header validation errors quote the entire value, including invalid newlines.
// The end-of-string alternative also covers messages truncated by the SDK.
const QUOTED_CREDENTIAL =
  /(?<!\\)(\\*["'])(Bearer[ \t]+|sntry[su]_)[\s\S]*?(?:\1|$)/gi;
// An explicit Bearer context can contain opaque tokens with punctuation.
// Quotes (including JSON-escaped quotes) delimit the diagnostic string.
const BEARER_CREDENTIAL =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: malformed credentials can contain control characters.
  /\bBearer[ \t]+(?:\\+(?:[nrtbfv]|u00[01][\da-f]|u007f|u202[89])[ \t]*|\\+[^"'\s\\]|[^\s"'\\])+(?:(?:\r\n|(?! )[\s\x00-\x1f\x7f-\x9f])[ \t]*(?:\\+(?:[nrtbfv]|u00[01][\da-f]|u007f|u202[89])[ \t]*|\\+[^"'\s\\]|[^\s"'\\])+)*/gi;
const SENTRY_CREDENTIAL =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: malformed credentials can contain control characters.
  /\bsntry[su]_[A-Za-z0-9._~+/=-]+(?:(?:\r\n|(?! )[\s\x00-\x1f\x7f-\x9f]|\\+(?:[nrtbfv]|u00[01][\da-f]|u007f|u202[89]))[ \t]*[A-Za-z0-9._~+/=-]+)*/gi;

/**
 * Use the runtime's final delimiter because an invalid token can contain quotes.
 * Index suffixes once so repeated header prefixes cannot cause quadratic scans.
 */
function redactInvalidBearerHeaders(text: string): string {
  const lastEnds = new Map<string, number>();
  for (const match of text.matchAll(INVALID_HEADER_END)) {
    const quote = match[1];
    if (quote) {
      lastEnds.set(quote, match.index);
    }
  }
  if (lastEnds.size === 0) {
    return text;
  }

  const parts: string[] = [];
  let cursor = 0;
  for (const match of text.matchAll(INVALID_BEARER_HEADER_START)) {
    if (match.index < cursor) {
      continue;
    }
    const [, prefix, quote] = match;
    if (!(prefix && quote)) {
      continue;
    }
    const end = lastEnds.get(quote);
    if (end === undefined || end < match.index + match[0].length) {
      continue;
    }
    parts.push(
      text.slice(cursor, match.index),
      `${prefix}${quote}Bearer [REDACTED]${quote}`
    );
    cursor = end + quote.length;
  }
  parts.push(text.slice(cursor));
  return parts.join("");
}

/** Remove recognizable credentials from diagnostics without retaining secrets. */
export function redactCredentialText(text: string): string {
  return redactInvalidBearerHeaders(text)
    .replace(QUOTED_CREDENTIAL, (_match, quote: string, prefix: string) =>
      prefix.toLowerCase().startsWith("bearer")
        ? `${quote}Bearer [REDACTED]${quote}`
        : `${quote}[REDACTED]${quote}`
    )
    .replace(BEARER_CREDENTIAL, "Bearer [REDACTED]")
    .replace(SENTRY_CREDENTIAL, "[REDACTED]");
}

/** Materialize the same JSON as the SDK before redacting a detached copy. */
function redactJson<T>(value: T): T {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value);
  } catch {
    // This is the SDK's envelope serialization fallback for cycles and BigInt.
    serialized = JSON.stringify(normalize(value));
  }
  const copy: T = JSON.parse(serialized ?? "null");
  if (typeof copy === "string") {
    return redactCredentialText(copy) as T;
  }
  const pending: unknown[] = [copy];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === null || typeof current !== "object") {
      continue;
    }
    for (const [key, nested] of Object.entries(current)) {
      if (typeof nested === "string") {
        (current as Record<string, unknown>)[key] =
          redactCredentialText(nested);
      } else {
        pending.push(nested);
      }
    }
  }
  return copy;
}

/**
 * Scrub the final envelope, after SDK metadata and log attributes are resolved.
 * JSON materialization preserves boxed values/toJSON without mutating live
 * scopes, client options, or caller-owned objects. Binary attachments stay intact.
 */
export function redactTelemetryEnvelope(envelope: Envelope): Envelope {
  return [
    redactJson(envelope[0]),
    envelope[1].map(([headers, payload]) => {
      const safeHeaders = redactJson(headers);
      const safePayload =
        payload instanceof Uint8Array ? payload : redactJson(payload);
      if (typeof safePayload === "string" && headers.length !== undefined) {
        safeHeaders.length = Buffer.byteLength(safePayload, "utf8");
      }
      return [safeHeaders, safePayload];
    }),
  ] as Envelope;
}
