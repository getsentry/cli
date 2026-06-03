/**
 * ProGuard/R8 mapping file utilities.
 *
 * The primary export computes the deterministic UUID that Sentry uses to
 * identify a ProGuard/R8 mapping file. This matches the legacy `sentry-cli`
 * (via the `rust-proguard` crate) byte-for-byte: the UUID is a content
 * checksum, computed as a UUIDv5 over the raw file bytes using a namespace
 * itself derived from the DNS namespace and `"guardsquare.com"`.
 *
 * Reference: `rust-proguard` `ProguardMapping::uuid()` —
 *   NAMESPACE = uuidv5(NAMESPACE_DNS, "guardsquare.com")
 *   uuid      = uuidv5(NAMESPACE, <raw file bytes>)
 *
 * Verified against legacy CLI fixtures:
 *   - `void\n` (5 bytes)  → 5db7294d-87fc-5726-a5c0-4a90679657a5
 *   - sample mapping.txt  → c038584d-c366-570c-ad1e-034fa0d194d7
 */

import { createHash } from "node:crypto";

/**
 * RFC 4122 DNS namespace UUID. Used as the parent namespace from which the
 * ProGuard namespace is derived.
 */
const NAMESPACE_DNS = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";

/**
 * RFC 4122 variant nibbles (`10xx`), keyed by the original hex digit at the
 * variant position. Forcing the digit to one of these encodes the variant
 * without bitwise math: `8/9` keep the low bit, `a/b` set it.
 */
const VARIANT_NIBBLE = ["8", "9", "a", "b"] as const;

/**
 * Compute a name-based UUIDv5 (SHA-1) for `name` within `namespace`.
 *
 * Implements RFC 4122 §4.3: SHA-1 over the 16 namespace bytes concatenated
 * with the name bytes; the first 16 digest bytes become the UUID with the
 * version forced to 5 and the variant forced to RFC 4122. Operates on the hex
 * representation (mirroring {@link contentToDebugId}) to avoid bitwise byte
 * manipulation. Safe for arbitrary (non-UTF-8) file content.
 *
 * @param name - The name bytes to hash (file content or a UTF-8 string)
 * @param namespace - Hyphenated namespace UUID string
 * @returns Lowercase hyphenated UUIDv5 string
 */
function uuidV5(name: Buffer, namespace: string): string {
  const namespaceBytes = Buffer.from(namespace.replaceAll("-", ""), "hex");
  const hash = createHash("sha1");
  hash.update(namespaceBytes);
  hash.update(name);
  const hex = hash.digest("hex").slice(0, 32).toLowerCase();

  // Version nibble (5) at hex position 12; variant nibble at position 16,
  // chosen deterministically from the original digit so the result is stable.
  const variant = VARIANT_NIBBLE[Number.parseInt(hex[16] ?? "0", 16) % 4];
  return (
    `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-` +
    `${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`
  );
}

/**
 * The ProGuard namespace UUID, derived as `uuidv5(NAMESPACE_DNS,
 * "guardsquare.com")`. Equals `4f44f30f-24be-53d0-bab6-f47c7120ad6c`.
 */
export const PROGUARD_NAMESPACE = uuidV5(
  Buffer.from("guardsquare.com", "utf-8"),
  NAMESPACE_DNS
);

/**
 * Compute the Sentry debug ID (UUID) for a ProGuard/R8 mapping file.
 *
 * The UUID is a deterministic content checksum: `uuidv5(PROGUARD_NAMESPACE,
 * <raw file bytes>)`. Identical file contents always yield the same UUID,
 * matching the value assigned by `sentry proguard upload` and the legacy
 * `sentry-cli proguard uuid`.
 *
 * @param content - Raw bytes of the mapping file
 * @returns Lowercase hyphenated UUID string
 */
export function computeProguardUuid(content: Buffer): string {
  return uuidV5(content, PROGUARD_NAMESPACE);
}
