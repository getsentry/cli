/**
 * Constructs a Sentry Event from `sentry send-event` CLI flags.
 *
 * Mirrors the behaviour of the old Rust sentry-cli `send-event` command:
 * tags/extras as KEY:VALUE pairs, user fields with known routing
 * (id, email, ip_address, username → top-level; everything else → user.data),
 * environment variables optionally included as `extra.environ`.
 */

import type { Event, SeverityLevel, User } from "@sentry/core";
import { uuid4 } from "@sentry/core";
import { ValidationError } from "../errors.js";

/** CLI flags accepted by `sentry send-event`. */
export type SendEventFlags = {
  message?: string[];
  "message-arg"?: string[];
  level?: string;
  release?: string;
  dist?: string;
  env?: string;
  platform?: string;
  tag?: string[];
  extra?: string[];
  user?: string[];
  fingerprint?: string[];
  timestamp?: string;
  "no-environ"?: boolean;
};

const KNOWN_USER_FIELDS = new Set(["id", "email", "ip_address", "username"]);

/**
 * Parse a single KEY:VALUE string, splitting on the first colon.
 *
 * Values may contain colons (e.g. `url:https://example.com`).
 * Throws ValidationError if the format is wrong.
 */
export function parseKeyValue(pair: string): [string, string] {
  const idx = pair.indexOf(":");
  if (idx <= 0) {
    throw new ValidationError(
      `Expected KEY:VALUE format, got: ${JSON.stringify(pair)}`,
      "tag/extra"
    );
  }
  return [pair.slice(0, idx), pair.slice(idx + 1)];
}

/**
 * Parse an array of KEY:VALUE strings into a plain object.
 */
function parseKeyValuePairs(
  pairs: string[] | undefined
): Record<string, string> {
  if (!pairs?.length) {
    return {};
  }
  return Object.fromEntries(pairs.map(parseKeyValue));
}

/**
 * Parse `--user` KEY:VALUE pairs into a Sentry User object.
 *
 * Known fields (id, email, ip_address, username) map directly to User
 * properties. Unknown keys go into `user.data` for custom attributes.
 */
export function parseUserFields(pairs: string[]): User {
  const user: User & { data?: Record<string, string> } = {};
  for (const pair of pairs) {
    const [key, value] = parseKeyValue(pair);
    if (KNOWN_USER_FIELDS.has(key)) {
      (user as Record<string, string>)[key] = value;
    } else {
      user.data ??= {};
      user.data[key] = value;
    }
  }
  return user;
}

/**
 * Parse a timestamp string into a Unix epoch float (seconds).
 *
 * Accepts: Unix integer/float, ISO 8601, RFC 2822.
 * Returns undefined for falsy input (caller uses Date.now()).
 */
function parseTimestamp(ts: string | undefined): number | undefined {
  if (!ts) {
    return;
  }
  // Unix numeric
  const num = Number(ts);
  if (!Number.isNaN(num) && num > 0) {
    return num;
  }
  // ISO / RFC 2822
  const parsed = Date.parse(ts);
  if (!Number.isNaN(parsed)) {
    return parsed / 1000;
  }
  return;
}

/**
 * Build a Sentry Event from CLI flag values.
 *
 * The returned object is ready to be wrapped in an EventEnvelope and
 * serialized for posting to the ingest endpoint.
 */
export function buildEventFromFlags(flags: SendEventFlags): Event {
  const tags = parseKeyValuePairs(flags.tag);
  const extra: Record<string, unknown> = {
    ...parseKeyValuePairs(flags.extra),
    ...(flags["no-environ"] ? {} : { environ: process.env }),
  };

  return {
    event_id: uuid4(),
    level: (flags.level ?? "error") as SeverityLevel,
    platform: flags.platform ?? "other",
    timestamp: parseTimestamp(flags.timestamp) ?? Date.now() / 1000,
    release: flags.release,
    dist: flags.dist,
    environment: flags.env,
    logentry:
      flags.message && flags.message.length > 0
        ? {
            message: flags.message.join("\n"),
            ...(flags["message-arg"]?.length
              ? { params: flags["message-arg"] as unknown[] }
              : {}),
          }
        : undefined,
    tags: Object.keys(tags).length > 0 ? tags : undefined,
    extra: Object.keys(extra).length > 0 ? extra : undefined,
    user: flags.user?.length ? parseUserFields(flags.user) : undefined,
    fingerprint: flags.fingerprint,
  };
}
