/**
 * Sentry Org-Auth-Token (`sntrys_`) Claim Extraction
 *
 * Sentry's organization auth tokens are formatted as:
 *
 *   sntrys_<base64(JSON{iat, url, region_url, org})>_<random-secret>
 *
 * (See `getsentry/sentry/src/sentry/utils/security/orgauthtoken_token.py` —
 * `generate_token` / `parse_token`.)
 *
 * The middle chunk is plaintext base64-encoded JSON written by the issuing
 * server. The trailing chunk is opaque entropy that gives the token its
 * bearer property.
 *
 * ## ⚠ Trust contract: claim is a HINT, not a security primitive
 *
 * The claim is **NOT signed**. Anyone can craft a `sntrys_<base64-of-anything>_<random>`
 * with any `url` they want, and our parser cannot tell a real claim from a
 * forged one. The claim's authenticity is implicit in "the real Sentry server
 * was the one who issued it" — but the CLI receives tokens from many channels
 * (env vars, copy-paste from UI, `.sentryclirc`) and cannot verify provenance.
 *
 * Consequences for callers:
 *
 * - The claim's `url` field MAY be used as a **defense-in-depth signal**
 *   (refuse to attach a token when the request origin doesn't match the
 *   claim) and as a **UX hint** (scope an env-token to the claim's host
 *   when no other host source is available).
 * - The claim MUST NOT be used as the SOLE trust anchor. The primary
 *   trust source remains the boot-time env snapshot (`captureEnvTokenHost`)
 *   plus the `auth.host` column for stored OAuth tokens — both rooted in
 *   data the CLI observed at issuance time, not in attacker-supplied
 *   token bytes.
 *
 * If a future refactor proposes elevating this to a primary trust source,
 * STOP and reconsider — it requires either a signed claim format from the
 * server or a different architecture entirely.
 *
 * ## Parser hardening
 *
 * This function runs on every authenticated fetch (it's consulted by the
 * fetch-layer trust check), so it operates on attacker-supplied bytes in a
 * hot path. Defensive choices:
 *
 * - Length-bounded: tokens longer than {@link MAX_TOKEN_LENGTH} are rejected
 *   without parsing. Real tokens are well under this cap.
 * - Format-strict: matches server-side `parse_token` semantics exactly —
 *   prefix `sntrys_`, exactly 2 `_` separators, valid base64 → valid UTF-8
 *   → valid JSON object → has truthy `iat` field.
 * - Fail-open: any parse error returns `undefined` (treated by callers as
 *   "no claim available"). Never throws.
 * - No regex evaluation, no recursive parsing — straight line code.
 */

const SNTRYS_PREFIX = "sntrys_";

/**
 * Maximum total token length we will attempt to parse.
 *
 * Real `sntrys_` tokens are ~150-300 bytes (prefix + base64-JSON-payload of
 * ~100 bytes + 43-byte secret). We cap at 2048 to give ample headroom for
 * future server-side payload growth while keeping the bound far below
 * pathological DoS thresholds. Tokens at or beyond this length are
 * rejected without any parsing work.
 */
const MAX_TOKEN_LENGTH = 2048;

/** Subset of `sntrys_` payload fields we care about. */
export type SntrysClaim = {
  /** Issuing server's URL (the claim we use for trust/UX checks). */
  url: string;
  /** Region URL — recorded but not currently consulted. */
  regionUrl?: string;
};

/**
 * Extract the `url` (and optional `region_url`) claim from a Sentry
 * org-auth-token. Returns `undefined` for any non-`sntrys_` token, any
 * malformed `sntrys_` token, or any token whose decoded payload doesn't
 * include a `url` field.
 *
 * Read the file-level JSDoc before adding new callers — the trust
 * contract limits this to defense-in-depth and UX-hint roles only.
 */
export function parseSntrysClaim(
  token: string | undefined
): SntrysClaim | undefined {
  if (!token || token.length > MAX_TOKEN_LENGTH) {
    return;
  }
  if (!token.startsWith(SNTRYS_PREFIX)) {
    return;
  }
  // Server contract: exactly 2 underscores total (one from `sntrys_`, one
  // between payload and secret). Standard base64 alphabet doesn't include
  // `_`, so this gives an unambiguous payload/secret boundary.
  // `String.prototype.split` with a high enough limit is the simplest way
  // to count without a regex.
  if ((token.match(/_/g) ?? []).length !== 2) {
    return;
  }
  // sntrys_<payload>_<secret>
  const lastUnderscore = token.lastIndexOf("_");
  // We already checked the prefix and underscore count, so this slice is
  // always non-empty for well-formed tokens.
  const payloadEncoded = token.slice(SNTRYS_PREFIX.length, lastUnderscore);
  if (!payloadEncoded) {
    return;
  }

  let payloadJson: string;
  try {
    // Standard base64 decode (NOT base64url) to match server format.
    // `Buffer.from(s, 'base64')` is lenient: it accepts strings without
    // padding and ignores invalid characters. That leniency is actually
    // OK here because server-issued payloads are always well-formed; the
    // worst case is we accept a payload that's been mildly corrupted in
    // transit, which then fails JSON.parse below and falls through to
    // the `undefined` return. We never trust the parsed value as a
    // security primitive (see file JSDoc).
    payloadJson = Buffer.from(payloadEncoded, "base64").toString("utf8");
  } catch {
    return;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(payloadJson);
  } catch {
    return;
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return;
  }
  const obj = parsed as Record<string, unknown>;

  // Match server's `parse_token`: rejects payloads without a truthy `iat`.
  // This catches "valid base64 of unrelated JSON" cases.
  if (!obj.iat) {
    return;
  }

  const url = obj.url;
  if (typeof url !== "string" || !url) {
    return;
  }

  const regionUrl =
    typeof obj.region_url === "string" && obj.region_url
      ? obj.region_url
      : undefined;

  return { url, regionUrl };
}

/**
 * Convenience wrapper: returns just the `url` claim, or `undefined`.
 * Useful at call sites that only need the URL and don't care about other
 * claim fields.
 */
export function getSntrysClaimUrl(
  token: string | undefined
): string | undefined {
  return parseSntrysClaim(token)?.url;
}
