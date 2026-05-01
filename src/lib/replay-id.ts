import type { SentryEvent } from "../types/index.js";
import { normalizeHexId } from "./hex-id.js";

const REPLAY_ID_RE = /^[0-9a-f]{32}$/;

/**
 * Normalize a replay ID to the canonical 32-character lowercase hex form.
 *
 * Accepts both bare hex IDs and UUID-style IDs with dashes.
 */
export function normalizeReplayId(
  value: string | null | undefined
): string | undefined {
  if (!value) {
    return;
  }

  const normalized = normalizeHexId(value.trim());
  return REPLAY_ID_RE.test(normalized) ? normalized : undefined;
}

function getReplayIdFromReplayContext(
  event: Pick<SentryEvent, "contexts">
): string | undefined {
  const replayContext = event.contexts?.replay;
  if (!replayContext || typeof replayContext !== "object") {
    return;
  }

  const replayId = (replayContext as { replay_id?: unknown }).replay_id;
  return typeof replayId === "string" ? replayId : undefined;
}

/**
 * Extract the best replay ID from an event's known replay linkage fields.
 */
export function getReplayIdFromEvent(
  event: Pick<SentryEvent, "contexts" | "tags">
): string | undefined {
  const tagReplayId = event.tags?.find(
    (tag) => tag.key === "replayId" || tag.key === "replay.id"
  )?.value;

  return collectReplayIds([
    tagReplayId,
    getReplayIdFromReplayContext(event),
  ])[0];
}

/**
 * Normalize and deduplicate replay IDs while preserving first-seen order.
 */
export function collectReplayIds(
  values: Iterable<string | null | undefined>
): string[] {
  const seen = new Set<string>();
  const replayIds: string[] = [];

  for (const value of values) {
    const replayId = normalizeReplayId(value);
    if (!replayId || seen.has(replayId)) {
      continue;
    }

    seen.add(replayId);
    replayIds.push(replayId);
  }

  return replayIds;
}
