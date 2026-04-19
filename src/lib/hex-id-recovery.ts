/**
 * Hex ID Recovery
 *
 * Attempts to recover from malformed hex ID inputs that `validateHexId`
 * rejects. Follows the AGENTS.md UX principle: "do the intent, gently nudge".
 *
 * Three recovery paths (cheapest first):
 *
 * 1. **Syntactic strip** — `<32hex><non-hex junk>` → strip junk and return
 *    the 32-hex prefix. Purely local, no API calls. Example: the CLI-1A8
 *    case `c0a5a9d4dce44358ab4231fc3bios` → `c0a5a9d4dce44358ab4231fc3b...`
 *    (wait — that example has only 26 hex chars, so it falls through to
 *    the fuzzy path. Pure strip handles cases like `<full-32-hex>ios`).
 *
 * 2. **Fuzzy prefix lookup** — when the input has a hex prefix of ≥8 chars
 *    (matching Sentry's UI truncation via `getShortEventId`), query the API
 *    to find matching IDs. Handles the common case of users copy-pasting
 *    8-12 char truncated IDs from the Sentry web UI. Also handles
 *    middle-ellipsis forms (`abc123...def456`) via a suffix filter.
 *
 * 3. **Cross-entity auto-resolve** — when the input is a valid ID of a
 *    different entity type (e.g., a 16-char span ID passed to
 *    `trace view`), look up the parent/related entity and redirect.
 *
 * On unrecoverable input, returns a structured failure with classification
 * (sentinel leak, looks-like-slug, too-short, no-matches, multiple-matches,
 * over-nested, api-error) so the command layer can produce a targeted error.
 *
 * All adapters use the existing API modules (listSpans, listTransactions,
 * listLogs, resolveEventInOrg). Wildcard queries on ID fields may not be
 * supported server-side — scan-and-filter is the primary strategy.
 *
 * See docs/plan at `.opencode/plans/*quiet-planet.md` for the full taxonomy
 * of malformed inputs and rationale.
 */

import type { SpanListItem, TransactionListItem } from "../types/index.js";
import { listSpans, listTransactions } from "./api-client.js";

import { AuthError, ResolutionError, ValidationError } from "./errors.js";
import {
  HEX_ID_RE,
  normalizeHexId,
  SPAN_ID_RE,
  UUID_DASH_RE,
} from "./hex-id.js";
import { logger } from "./logger.js";

/** Entity types this module recovers. */
export type HexEntityType = "event" | "trace" | "log" | "span";

/**
 * Extracted prefix/suffix from a raw malformed input.
 * `suffix` is only populated when the input contained a middle ellipsis
 * (ASCII `...` or Unicode `…`).
 */
export type HexCandidate = {
  prefix: string;
  suffix?: string;
};

/** Why recovery failed (for targeted error messages). */
export type RecoveryFailureReason =
  | "too-short"
  | "no-matches"
  | "multiple-matches"
  | "api-error"
  | "sentinel-leak"
  | "looks-like-slug"
  | "over-nested";

/**
 * Result of attempting to recover a malformed hex ID.
 *
 * - `stripped`: input was `<valid-id><trailing-junk>`; returned the valid ID.
 * - `fuzzy`: input was a hex prefix; found exactly one match via API.
 * - `redirect`: input was a valid ID of a different entity type; the command
 *   layer should re-target (e.g., 16-char span ID passed to `trace view` →
 *   use the span's parent trace).
 * - `failed`: recovery not possible; `reason` classifies why and `candidates`
 *   lists ambiguous matches (for `multiple-matches`).
 */
export type RecoveryResult =
  | { kind: "stripped"; id: string; original: string; stripped: string }
  | {
      kind: "fuzzy";
      id: string;
      original: string;
      prefix: string;
      suffix?: string;
    }
  | {
      kind: "redirect";
      id: string;
      original: string;
      fromEntity: HexEntityType;
      toEntity: HexEntityType;
    }
  | {
      kind: "failed";
      original: string;
      reason: RecoveryFailureReason;
      candidates?: string[];
      hint?: string;
    };

/** Context for adapter API calls. */
export type LookupContext = {
  org: string;
  /** When present, scopes the scan to a single project. */
  project?: string;
  /** Required for span lookup (spans are unique only within a trace). */
  traceId?: string;
  /** Override for the default scan window (e.g. "90d", "7d"). */
  period?: string;
  signal?: AbortSignal;
};

/** Minimum hex prefix length to attempt a fuzzy API lookup. */
export const MIN_FUZZY_PREFIX = 8;

/** Sentinel strings produced by common shell/pipeline leaks. */
const SENTINEL_VALUES = new Set([
  "null",
  "undefined",
  "nan",
  "none",
  "nil",
  "latest",
  "@latest",
  "get",
  "false",
  "true",
  "n/a",
]);

/** URL-fragment prefixes that precede a raw ID in Sentry URLs. */
const URL_FRAGMENT_PREFIXES = ["span-", "txn-", "event-", "trace-"];

/** Log adapter retrieves page(s) of recent log IDs and filters client-side. */
const LOG_SCAN_LIMIT = 1000;

/** How wide a scan to attempt per entity during fuzzy recovery. */
const DEFAULT_PERIODS: Record<HexEntityType, string> = {
  event: "90d",
  trace: "30d",
  log: "30d",
  span: "30d",
};

/** Hex prefix starting at string beginning (used in normalization). */
const LEADING_HEX_RE = /^[0-9a-f]+/;

/** First char of string is a hex digit. */
const LEADING_HEX_CHAR_RE = /^[0-9a-f]/;

/** Middle-ellipsis pattern (ASCII `...` or Unicode `…`) flanked by hex. */
const MIDDLE_ELLIPSIS_RE = /^([0-9a-f]*)(?:\.\.\.|…)([0-9a-f]*)$/;

/** Pure hex string (case-insensitive). */
const PURE_HEX_RE = /^[0-9a-f]+$/i;

/** Segment with 2+ alphabetic chars (for slug detection). */
const ALPHA_SEGMENT_RE = /[a-z]{2,}/i;

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Pre-normalize a raw input before further analysis.
 *
 * Detects shell/pipeline sentinel leaks (`null`, `latest`, etc.) and returns
 * the offending value so the caller can fail fast with a targeted error.
 *
 * Otherwise strips URL fragment prefixes (`span-`, `txn-`, etc.), trims,
 * lowercases, and strips dashes. UUID dashes on full UUIDs are handled by
 * `normalizeHexId`; here we strip dashes on *partial* inputs so a user can
 * paste the first group of a UUID (`abc12345-6789`) and still get a
 * recoverable hex prefix.
 */
export function preNormalize(input: string): {
  cleaned: string;
  sentinel?: string;
} {
  const trimmed = input.trim();
  const lowered = trimmed.toLowerCase();
  if (SENTINEL_VALUES.has(lowered)) {
    return { cleaned: lowered, sentinel: lowered };
  }

  let cleaned = lowered;
  for (const prefix of URL_FRAGMENT_PREFIXES) {
    if (cleaned.startsWith(prefix)) {
      cleaned = cleaned.slice(prefix.length);
      break;
    }
  }

  // If the input is a full UUID (8-4-4-4-12), delegate to normalizeHexId.
  if (UUID_DASH_RE.test(cleaned)) {
    return { cleaned: cleaned.replace(/-/g, "") };
  }

  // Strip dashes on partial inputs so `abc12345-6789` → `abc123456789`.
  // This is conservative: we only strip when the result still looks hex-ish.
  if (cleaned.includes("-")) {
    const dashless = cleaned.replace(/-/g, "");
    // Only accept if the result has at least one hex char at the start
    if (LEADING_HEX_CHAR_RE.test(dashless)) {
      cleaned = dashless;
    }
  }

  return { cleaned };
}

/**
 * Strip trailing non-hex chars from an input and return the hex prefix
 * **only when** the result matches `expectedLen` exactly.
 *
 * Returns null when:
 * - the input is already `expectedLen` chars (no stripping needed);
 * - the leading hex run is shorter than `expectedLen` (falls through to
 *   fuzzy lookup);
 * - the input starts with a non-hex char.
 *
 * @example
 * stripTrailingNonHex("c0a5a9d4dce44358ab4231fc3bead7e9ios", 32)
 * // → { hex: "c0a5a9d4dce44358ab4231fc3bead7e9", stripped: "ios" }
 */
export function stripTrailingNonHex(
  input: string,
  expectedLen: 32 | 16
): { hex: string; stripped: string } | null {
  if (input.length <= expectedLen) {
    return null;
  }
  const match = input.match(LEADING_HEX_RE);
  if (!match) {
    return null;
  }
  const hex = match[0];
  if (hex.length < expectedLen) {
    return null;
  }
  // Take exactly `expectedLen` chars. We don't require `hex.length === expectedLen`
  // because an input like `<40 hex>xyz` could reasonably be "32 hex + 8 of junk
  // that happened to be hex + 3 non-hex". Taking the first `expectedLen` is the
  // safest interpretation for stripping.
  const truncated = hex.slice(0, expectedLen);
  const stripped = input.slice(expectedLen);
  return { hex: truncated, stripped };
}

/**
 * Extract a prefix (and optional suffix from middle ellipsis) from the input.
 *
 * Handles:
 * - plain leading hex runs (`abc12345` → `{prefix: "abc12345"}`);
 * - middle ellipsis (`abc123...def456` → `{prefix: "abc123", suffix: "def456"}`);
 * - unicode ellipsis (`abc123…def456` → same).
 *
 * Returns null when the input contains no hex at all.
 */
export function extractHexCandidate(input: string): HexCandidate | null {
  // Detect middle ellipsis (ASCII `...` or Unicode `…`)
  const ellipsisMatch = input.match(MIDDLE_ELLIPSIS_RE);
  if (ellipsisMatch) {
    const [, prefix = "", suffix = ""] = ellipsisMatch;
    if (!(prefix || suffix)) {
      return null;
    }
    return suffix.length > 0 ? { prefix, suffix } : { prefix };
  }

  // Plain leading hex run
  const prefixMatch = input.match(LEADING_HEX_RE);
  if (!prefixMatch || prefixMatch[0].length === 0) {
    return null;
  }
  return { prefix: prefixMatch[0] };
}

/**
 * Heuristic: does the input "look like" a project slug the user mistakenly
 * passed as a hex ID?
 *
 * Slugs typically contain at least one dash AND have segments that are
 * mostly alphabetic (like `human-interfaces`, `apacta-2-wttd`, `uts-patient-app-7d`).
 * Pure hex short prefixes (`b092b5d6`) should NOT match since they're
 * recoverable via fuzzy lookup.
 */
export function looksLikeSlug(input: string): boolean {
  const trimmed = input.trim();
  if (trimmed.length < 3 || !trimmed.includes("-")) {
    return false;
  }
  // Must have at least one segment with 2+ alphabetic chars (rules out pure
  // hex inputs with a spurious dash, e.g. "abc-123").
  const segments = trimmed.split("-");
  const hasAlphaSegment = segments.some((s) => ALPHA_SEGMENT_RE.test(s));
  if (!hasAlphaSegment) {
    return false;
  }
  // Reject if the whole thing minus dashes is a valid hex prefix — that
  // means a user might have typed a UUID-dashed form we already handled.
  const dashless = trimmed.replace(/-/g, "");
  if (PURE_HEX_RE.test(dashless) && dashless.length >= MIN_FUZZY_PREFIX) {
    return false;
  }
  return true;
}

/**
 * Detect over-nested paths like `<org>/<project>/<extra>/<id>`.
 * Returns true when there are 3 or more slash-separated non-empty segments.
 */
export function isOverNestedPath(input: string): boolean {
  const segments = input.split("/").filter(Boolean);
  return segments.length >= 4;
}

// ---------------------------------------------------------------------------
// Per-entity adapters
// ---------------------------------------------------------------------------

/**
 * Adapter interface: given a candidate prefix (optionally with suffix),
 * return a list of full IDs that match. Empty array when no matches.
 *
 * Implementations must:
 * - Propagate {@link AuthError} (never swallow — auth issues are global).
 * - Return `[]` on transient errors (let the caller classify as `api-error`
 *   via a wrapper try/catch if preferred; see `findByPrefix` below).
 */
export type FuzzyLookupAdapter = (
  candidate: HexCandidate,
  ctx: LookupContext
) => Promise<string[]>;

/**
 * Filter candidate IDs by the prefix/suffix from user input. Defensive —
 * wildcard queries may return fuzzy matches beyond pure prefix matches, so
 * we always re-check client-side.
 */
function filterByCandidate(ids: string[], candidate: HexCandidate): string[] {
  let out = ids.filter((id) => id.startsWith(candidate.prefix));
  if (candidate.suffix) {
    const suffix = candidate.suffix;
    out = out.filter((id) => id.endsWith(suffix));
  }
  // Deduplicate while preserving order
  return Array.from(new Set(out));
}

/**
 * Event adapter — scans recent transactions for a matching event ID prefix.
 *
 * Events don't have a dedicated prefix-lookup endpoint. The
 * `/eventids/{event_id}/` endpoint requires an exact 32-char ID. As a
 * pragmatic fallback we scan transactions (which carry the event `id`) in
 * the configured project + window and filter client-side. This covers
 * transaction-event lookups; pure error events without a transaction won't
 * be found this way. A future enhancement could also scan `listIssueEvents`
 * output when an issue context is available.
 */
export const eventAdapter: FuzzyLookupAdapter = async (candidate, ctx) => {
  if (!ctx.project) {
    // Event IDs are globally-ish unique but the Events API requires a
    // project scope for listTransactions. Without a project we can only
    // fall back to cross-org eventids lookup, which doesn't support prefix.
    return [];
  }
  const period = ctx.period ?? DEFAULT_PERIODS.event;
  const txns = await listTransactions(ctx.org, ctx.project, {
    limit: 100,
    statsPeriod: period,
    sort: "date",
  });
  const ids = (txns.data as TransactionListItem[]).map((t) => t.id);
  return filterByCandidate(ids, candidate);
};

/**
 * Trace adapter — scans recent spans and dedupes by trace ID.
 *
 * Uses `listSpans` (dataset=spans) since spans carry the full trace ID
 * and the spans endpoint supports broader filtering than events.
 *
 * When `ctx.project` is absent, returns empty — a truly org-wide prefix
 * scan across all projects is too expensive; the caller should require
 * `<org>/<project>/<prefix>`.
 */
export const traceAdapter: FuzzyLookupAdapter = async (candidate, ctx) => {
  if (!ctx.project) {
    return [];
  }
  const period = ctx.period ?? DEFAULT_PERIODS.trace;
  const spans = await listSpans(ctx.org, ctx.project, {
    limit: 100,
    statsPeriod: period,
    sort: "date",
  });
  const traces = (spans.data as SpanListItem[]).map((s) => s.trace);
  return filterByCandidate(traces, candidate);
};

/**
 * Log adapter — scans recent logs via the Explore/Events API.
 */
export const logAdapter: FuzzyLookupAdapter = async (candidate, ctx) => {
  if (!ctx.project) {
    return [];
  }
  const period = ctx.period ?? DEFAULT_PERIODS.log;
  const { listLogs } = await import("./api-client.js");
  const logs = await listLogs(ctx.org, ctx.project, {
    limit: LOG_SCAN_LIMIT,
    statsPeriod: period,
    sort: "newest",
  });
  const ids = logs.map((l) => l["sentry.item_id"]);
  return filterByCandidate(ids, candidate);
};

/**
 * Span adapter — scans spans within a specific trace.
 *
 * Requires `ctx.traceId`. Filters within the trace's spans; collisions at
 * 8 hex chars within a single trace are vanishingly rare (traces have
 * O(100) to O(10k) spans).
 */
export const spanAdapter: FuzzyLookupAdapter = async (candidate, ctx) => {
  if (!(ctx.traceId && ctx.project)) {
    return [];
  }
  const period = ctx.period ?? DEFAULT_PERIODS.span;
  const spans = await listSpans(ctx.org, ctx.project, {
    limit: 100,
    query: `trace:${ctx.traceId}`,
    statsPeriod: period,
    sort: "date",
  });
  const ids = (spans.data as SpanListItem[]).map((s) => s.id);
  return filterByCandidate(ids, candidate);
};

/** Registry of adapters by entity type. Mutable so tests can stub. */
export const ADAPTERS: Record<HexEntityType, FuzzyLookupAdapter> = {
  event: eventAdapter,
  trace: traceAdapter,
  log: logAdapter,
  span: spanAdapter,
};

// ---------------------------------------------------------------------------
// Class E: cross-entity auto-resolve helpers
// ---------------------------------------------------------------------------

/**
 * Given a valid 16-hex span ID, find its parent trace ID by scanning spans.
 *
 * Returns null when the span isn't found in the configured project/window.
 * Propagates AuthError.
 */
export async function findTraceBySpanId(
  spanId: string,
  ctx: LookupContext
): Promise<string | null> {
  if (!ctx.project) {
    return null;
  }
  const spans = await listSpans(ctx.org, ctx.project, {
    limit: 10,
    query: `id:${spanId}`,
    statsPeriod: ctx.period ?? DEFAULT_PERIODS.span,
  });
  const first = (spans.data as SpanListItem[])[0];
  return first?.trace ?? null;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/** Arguments bundle for {@link tryLocalClassification}. */
type LocalClassificationInput = {
  input: string;
  cleaned: string;
  entityType: HexEntityType;
  expectedLen: 32 | 16;
  sentinel: string | undefined;
};

/**
 * Run the cheap local classifications (sentinel / over-nested / strip).
 * Returns a finished {@link RecoveryResult} when one matches, or null when
 * the input falls through to adapter-backed fuzzy lookup.
 */
function tryLocalClassification(
  args: LocalClassificationInput
): RecoveryResult | null {
  const { input, cleaned, entityType, expectedLen, sentinel } = args;
  if (sentinel) {
    return {
      kind: "failed",
      original: input,
      reason: "sentinel-leak",
      hint: `'${sentinel}' is not a hex ${entityType} ID — this often means a shell variable or pipeline value was empty.`,
    };
  }
  if (isOverNestedPath(cleaned)) {
    return {
      kind: "failed",
      original: input,
      reason: "over-nested",
      hint: "Use exactly <org>/<project>/<id>; extra path segments are not supported.",
    };
  }
  const stripResult = stripTrailingNonHex(cleaned, expectedLen);
  if (stripResult) {
    return {
      kind: "stripped",
      id: stripResult.hex,
      original: input,
      stripped: stripResult.stripped,
    };
  }
  return null;
}

/**
 * Classify a "not long enough" input by looking for slug shape vs bare
 * hex too-short. Shared between the early short-input branch and the
 * defensive fallback.
 */
function classifyShortInput(
  input: string,
  entityType: HexEntityType,
  ctx: LookupContext
): RecoveryResult {
  if (looksLikeSlug(input)) {
    return {
      kind: "failed",
      original: input,
      reason: "looks-like-slug",
      hint: buildSlugHint(input, entityType, ctx.org),
    };
  }
  return {
    kind: "failed",
    original: input,
    reason: "too-short",
    hint: `Need at least ${MIN_FUZZY_PREFIX} hex chars of the ${entityType} ID to attempt recovery.`,
  };
}

/**
 * Call the registered adapter for {@link entityType} and shape its result
 * into a {@link RecoveryResult}. Isolated so {@link recoverHexId} stays
 * readable under Biome's cognitive-complexity cap.
 */
async function runFuzzyLookup(
  input: string,
  entityType: HexEntityType,
  candidate: HexCandidate,
  ctx: LookupContext
): Promise<RecoveryResult> {
  let candidates: string[];
  try {
    candidates = await ADAPTERS[entityType](candidate, ctx);
  } catch (err) {
    if (err instanceof AuthError) {
      throw err;
    }
    logger
      .withTag("hex-id-recovery")
      .debug(
        `Fuzzy ${entityType} lookup failed: ${err instanceof Error ? err.message : String(err)}`
      );
    return { kind: "failed", original: input, reason: "api-error" };
  }

  const filtered = filterByCandidate(candidates, candidate);
  if (filtered.length === 0) {
    return {
      kind: "failed",
      original: input,
      reason: "no-matches",
      hint: buildNoMatchHint(entityType, ctx.period),
    };
  }
  if (filtered.length > 1) {
    return {
      kind: "failed",
      original: input,
      reason: "multiple-matches",
      candidates: filtered.slice(0, 5),
    };
  }
  const id = filtered[0];
  if (!id) {
    return { kind: "failed", original: input, reason: "no-matches" };
  }
  return {
    kind: "fuzzy",
    id,
    original: input,
    prefix: candidate.prefix,
    ...(candidate.suffix ? { suffix: candidate.suffix } : {}),
  };
}

/**
 * Attempt to recover a malformed hex ID.
 *
 * Runs the decision tree documented in the plan file: pre-normalize →
 * sentinel detection → over-nested path detection → syntactic strip →
 * cross-entity redirect → fuzzy lookup (with slug heuristic for short
 * non-hex inputs).
 *
 * Always returns a structured result. The command layer decides how to
 * render warnings and errors based on `result.kind`.
 */
export async function recoverHexId(
  input: string,
  entityType: HexEntityType,
  ctx: LookupContext
): Promise<RecoveryResult> {
  const expectedLen: 32 | 16 = entityType === "span" ? 16 : 32;
  const { cleaned, sentinel } = preNormalize(input);

  const local = tryLocalClassification({
    input,
    cleaned,
    entityType,
    expectedLen,
    sentinel,
  });
  if (local) {
    return local;
  }

  // Class E: cross-entity redirect when cleaned input is a valid ID of the
  // "other" type. Runs before the slug heuristic so valid hex never triggers
  // the slug path.
  const redirect = await tryCrossEntityRedirect(cleaned, entityType, ctx);
  if (redirect) {
    return redirect;
  }

  // Class B/C/D: fuzzy prefix (or prefix+suffix) lookup
  const candidate = extractHexCandidate(cleaned);
  const longEnough =
    candidate !== null &&
    (candidate.prefix.length >= MIN_FUZZY_PREFIX ||
      (candidate.suffix?.length ?? 0) >= MIN_FUZZY_PREFIX);

  if (!(longEnough && candidate)) {
    return classifyShortInput(input, entityType, ctx);
  }

  return runFuzzyLookup(input, entityType, candidate, ctx);
}

/**
 * Try to detect and resolve a cross-entity mismatch.
 *
 * Currently handles:
 * - `trace` command given a valid 16-char span ID → resolve span's parent
 *   trace via `listSpans(query: "id:<span>")`.
 *
 * Returns null when no cross-entity redirect is possible, letting the
 * caller fall through to fuzzy prefix lookup.
 *
 * For `span` commands given a valid 32-hex trace ID, detection happens
 * at the command level (span/view.ts already has a `ContextError` path
 * for this case — we don't want to silently change span view to act like
 * trace view).
 */
async function tryCrossEntityRedirect(
  cleaned: string,
  entityType: HexEntityType,
  ctx: LookupContext
): Promise<RecoveryResult | null> {
  if (entityType !== "trace") {
    return null;
  }
  if (!SPAN_ID_RE.test(cleaned)) {
    return null;
  }
  const normalized = normalizeHexId(cleaned);
  if (HEX_ID_RE.test(normalized)) {
    // Valid trace-length; shouldn't reach recovery.
    return null;
  }
  try {
    const trace = await findTraceBySpanId(cleaned, ctx);
    if (trace) {
      return {
        kind: "redirect",
        id: trace,
        original: cleaned,
        fromEntity: "span",
        toEntity: "trace",
      };
    }
  } catch (err) {
    if (err instanceof AuthError) {
      throw err;
    }
    logger
      .withTag("hex-id-recovery")
      .debug(
        `Cross-entity lookup failed: ${err instanceof Error ? err.message : String(err)}`
      );
  }
  return null;
}

/** Build the "looks like a slug" hint string per entity. */
function buildSlugHint(
  input: string,
  entityType: HexEntityType,
  org: string
): string {
  const orgPart = org ? `${org}/` : "<org>/";
  switch (entityType) {
    case "event":
      return `'${input}' looks like a project slug, not an event ID. Try: sentry issue list ${orgPart}${input}`;
    case "trace":
      return `'${input}' looks like a project slug, not a trace ID. Try: sentry trace list ${orgPart}${input}`;
    case "log":
      return `'${input}' looks like a project slug, not a log ID. Try: sentry log list ${orgPart}${input}`;
    case "span":
      return `'${input}' looks like a project slug, not a span ID. Spans are identified by 16 hex chars within a trace.`;
    default: {
      const _exhaustive: never = entityType;
      return _exhaustive;
    }
  }
}

/** Build the "prefix not found" retention hint per entity. */
function buildNoMatchHint(
  entityType: HexEntityType,
  period: string | undefined
): string {
  const window = period ?? DEFAULT_PERIODS[entityType];
  switch (entityType) {
    case "log":
      return `No log matched this prefix in the last ${window}. Logs are retained for 90 days — older logs cannot be looked up.`;
    case "event":
      return `No event matched this prefix in the last ${window}. Event retention depends on your plan; older events may be unavailable.`;
    case "trace":
      return `No trace matched this prefix in the last ${window}. Trace retention depends on your plan; older traces may be unavailable.`;
    case "span":
      return `No span matched this prefix within the trace. Spans outside the trace's retention window are unavailable.`;
    default: {
      const _exhaustive: never = entityType;
      return _exhaustive;
    }
  }
}

// ---------------------------------------------------------------------------
// Command-layer helper: unwrap a RecoveryResult and emit warnings
// ---------------------------------------------------------------------------

/** Context passed by command code to produce consistent warnings/errors. */
export type HandleRecoveryOptions = {
  /** Entity label for warnings (e.g., "event", "trace"). */
  entityType: HexEntityType;
  /**
   * Canonical command template with `<id>` placeholder. Used in the
   * `multiple-matches` `ResolutionError` and hints.
   * Example: `sentry event view <org>/<project>/<id>`.
   */
  canonicalCommand: string;
  /** Logger tag (e.g., "event.view"). */
  logTag: string;
};

/**
 * Unwrap a {@link RecoveryResult} and produce a validated ID or throw a
 * structured error. Centralizes the warn/error behavior so every command
 * behaves identically.
 *
 * - `stripped` / `fuzzy` / `redirect` → emit a `log.warn` describing the
 *   recovery, return the usable ID.
 * - `failed` → throw the appropriate {@link ValidationError} or
 *   {@link ResolutionError} based on the classification.
 *
 * The caller must import `ValidationError` / `ResolutionError` from
 * `./errors.js`; we don't re-export them.
 */
export function handleRecoveryResult(
  result: RecoveryResult,
  fallbackError: Error,
  options: HandleRecoveryOptions
): string {
  const log = logger.withTag(options.logTag);
  switch (result.kind) {
    case "stripped":
      log.warn(
        `Stripped trailing '${result.stripped}' from ${options.entityType} ID. Using ${result.id}.`
      );
      return result.id;
    case "fuzzy": {
      const via = result.suffix
        ? `prefix ${result.prefix}…${result.suffix}`
        : `prefix ${result.prefix}`;
      log.warn(
        `Interpreting '${result.original}' as ${options.entityType} ${result.id} (matched ${via}).`
      );
      return result.id;
    }
    case "redirect":
      log.warn(
        `'${result.original}' is a ${result.fromEntity} ID, not a ${result.toEntity} ID. ` +
          `Using the associated ${result.toEntity} ${result.id}.`
      );
      return result.id;
    case "failed":
      throw buildRecoveryError(result, fallbackError, options);
    default: {
      const _exhaustive: never = result;
      return _exhaustive;
    }
  }
}

/**
 * Convert a `failed` {@link RecoveryResult} into a user-facing error.
 *
 * - `multiple-matches` → {@link ResolutionError} with candidate suggestions.
 * - `sentinel-leak` / `over-nested` / `looks-like-slug` / `too-short` /
 *   `no-matches` → {@link ValidationError} combining the original
 *   validation message with the recovery hint.
 * - `api-error` → surfaces the original validation error unchanged
 *   (recovery couldn't run, so we fall back to the strict validator's message).
 */
function buildRecoveryError(
  result: Extract<RecoveryResult, { kind: "failed" }>,
  fallbackError: Error,
  options: HandleRecoveryOptions
): Error {
  const hint = result.hint ?? "";

  switch (result.reason) {
    case "multiple-matches": {
      const candidates = result.candidates ?? [];
      const suggestions = candidates.map((c) =>
        options.canonicalCommand.replace("<id>", c)
      );
      return new ResolutionError(
        `${capitalize(options.entityType)} prefix '${result.original}'`,
        `matches ${candidates.length} ${options.entityType}s`,
        `Re-run with more characters or the full ID: ${options.canonicalCommand}`,
        suggestions
      );
    }
    case "sentinel-leak":
    case "over-nested":
    case "looks-like-slug":
    case "too-short":
    case "no-matches": {
      const base = fallbackError.message;
      return new ValidationError(hint ? `${base}\n\n${hint}` : base);
    }
    case "api-error":
      return fallbackError;
    default: {
      const _exhaustive: never = result.reason;
      return _exhaustive;
    }
  }
}

/** Capitalize the first letter of an entity label (for user-facing text). */
function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
