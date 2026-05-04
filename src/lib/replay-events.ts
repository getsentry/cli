/**
 * Normalized Session Replay event extraction.
 *
 * Converts rrweb frames and Sentry custom replay frames into stable,
 * agent-readable rows. The normalized shape intentionally preserves evidence
 * pointers (segment/frame/offset) while avoiding raw payloads unless callers
 * explicitly request them.
 */

import type {
  ReplayDetails,
  ReplayEvent,
  ReplayEventKind,
  ReplayRecordingSegments,
} from "../types/index.js";
import { ValidationError } from "./errors.js";
import { getReplayUrlParts, replayUrlPathMatches } from "./replay-search.js";
import { parseRelativeParts, UNIT_SECONDS } from "./time-range.js";

type RecordValue = Record<string, unknown>;

type EventContext = {
  replayStartMs: number | null;
  replayId: string;
  includeRaw: boolean;
  currentUrl?: string;
};

type FrameLocation = {
  ctx: EventContext;
  frame: RecordValue;
  segmentIndex: number;
  frameIndex: number;
};

export type ReplayEventFilters = {
  kinds?: readonly ReplayEventKind[];
  url?: string;
  path?: string;
  contains?: string;
  selector?: string;
  fromMs?: number;
  toMs?: number;
};

const RRWEB_EVENT_TYPES: Record<number, string> = {
  0: "DomContentLoaded",
  1: "Load",
  2: "FullSnapshot",
  3: "IncrementalSnapshot",
  4: "Meta",
  5: "Custom",
  6: "Plugin",
};

const RRWEB_INCREMENTAL_SOURCES: Record<number, string> = {
  0: "Mutation",
  1: "MouseMove",
  2: "MouseInteraction",
  3: "Scroll",
  4: "ViewportResize",
  5: "Input",
  6: "TouchMove",
  7: "MediaInteraction",
  8: "StyleSheetRule",
  9: "CanvasMutation",
  10: "Font",
  11: "Log",
  12: "Drag",
  13: "StyleDeclaration",
  14: "Selection",
};

const RRWEB_MOUSE_INTERACTIONS: Record<number, string> = {
  0: "MouseUp",
  1: "MouseDown",
  2: "Click",
  3: "ContextMenu",
  4: "DblClick",
  5: "Focus",
  6: "Blur",
  7: "TouchStart",
  8: "TouchMove",
  9: "TouchEnd",
};

const CLICK_LIKE_CUSTOM_TAGS = new Set(["click", "deadClick", "rageClick"]);
const MASKED_INPUT_RE = /^\*+$/;
const SECONDS_OFFSET_RE = /^\d+(\.\d+)?$/;

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null;
}

function firstString(...values: unknown[]): string | undefined {
  return values.find(
    (value): value is string => typeof value === "string" && value.length > 0
  );
}

function firstNumber(...values: unknown[]): number | undefined {
  return values.find(
    (value): value is number =>
      typeof value === "number" && Number.isFinite(value)
  );
}

function timestampToMillis(value: unknown): number | null {
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }

  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  // rrweb timestamps are epoch milliseconds. Some Sentry payloads use epoch
  // seconds, so normalize realistic second values as a fallback.
  if (value > 1_000_000_000 && value < 10_000_000_000) {
    return Math.round(value * 1000);
  }

  return Math.round(value);
}

function eventTimeFields(
  frame: RecordValue,
  replayStartMs: number | null
): Pick<ReplayEvent, "offsetMs" | "timestamp"> {
  const timestampMs = timestampToMillis(frame.timestamp);
  return {
    offsetMs:
      timestampMs !== null && replayStartMs !== null
        ? Math.max(0, timestampMs - replayStartMs)
        : null,
    timestamp:
      timestampMs !== null ? new Date(timestampMs).toISOString() : null,
  };
}

function buildBaseEvent(params: {
  ctx: EventContext;
  frame: RecordValue;
  segmentIndex: number;
  frameIndex: number;
  kind: ReplayEventKind;
  category: string;
  label?: string;
  message?: string;
  url?: string;
  selector?: string;
  nodeId?: string | number;
  rawType?: string;
  rawSource?: string;
  data?: RecordValue;
}): ReplayEvent {
  const { ctx, frame, segmentIndex, frameIndex, ...event } = params;
  const url = event.url ?? ctx.currentUrl ?? null;
  const urlParts = getReplayUrlParts(url);
  return {
    replayId: ctx.replayId,
    segmentIndex,
    frameIndex,
    ...eventTimeFields(frame, ctx.replayStartMs),
    kind: event.kind,
    category: event.category,
    label: event.label ?? null,
    message: event.message ?? null,
    url,
    urlPath: urlParts?.path ?? null,
    urlQuery: urlParts?.query ?? null,
    selector: event.selector ?? null,
    nodeId: event.nodeId ?? null,
    rawType: event.rawType ?? null,
    rawSource: event.rawSource ?? null,
    ...(event.data ? { data: event.data } : {}),
    ...(ctx.includeRaw ? { raw: frame } : {}),
  };
}

function summarizeMutationData(data: RecordValue): RecordValue {
  return {
    adds: Array.isArray(data.adds) ? data.adds.length : undefined,
    removes: Array.isArray(data.removes) ? data.removes.length : undefined,
    texts: Array.isArray(data.texts) ? data.texts.length : undefined,
    attributes: Array.isArray(data.attributes)
      ? data.attributes.length
      : undefined,
  };
}

function normalizeMouseInteraction(
  location: FrameLocation,
  data: RecordValue
): ReplayEvent | null {
  const interactionType = firstNumber(data.type);
  const interactionName =
    interactionType !== undefined
      ? (RRWEB_MOUSE_INTERACTIONS[interactionType] ?? String(interactionType))
      : undefined;

  let kind: ReplayEventKind | null = null;
  if (interactionName === "Click" || interactionName === "DblClick") {
    kind = "click";
  } else if (
    interactionName === "TouchStart" ||
    interactionName === "TouchEnd"
  ) {
    kind = "tap";
  } else if (interactionName === "Focus") {
    kind = "focus";
  } else if (interactionName === "Blur") {
    kind = "blur";
  }

  if (!kind) {
    return null;
  }

  const selector = firstString(data.selector);
  const nodeId = firstNumber(data.id);
  return buildBaseEvent({
    ...location,
    kind,
    category: "interaction",
    label: selector ?? interactionName,
    selector,
    nodeId,
    rawType: "IncrementalSnapshot",
    rawSource: interactionName ?? "MouseInteraction",
    data: {
      x: firstNumber(data.x),
      y: firstNumber(data.y),
      interaction: interactionName,
    },
  });
}

function normalizeIncrementalFrame(
  ctx: EventContext,
  frame: RecordValue,
  segmentIndex: number,
  frameIndex: number
): ReplayEvent | null {
  const location = { ctx, frame, segmentIndex, frameIndex };
  const data = isRecord(frame.data) ? frame.data : {};
  const source = firstNumber(data.source);
  const sourceName =
    source !== undefined
      ? (RRWEB_INCREMENTAL_SOURCES[source] ?? String(source))
      : undefined;

  switch (sourceName) {
    case "Mutation":
      return buildBaseEvent({
        ...location,
        kind: "mutation",
        category: "dom",
        label: "mutation",
        rawType: "IncrementalSnapshot",
        rawSource: sourceName,
        data: summarizeMutationData(data),
      });
    case "MouseInteraction":
      return normalizeMouseInteraction(location, data);
    case "Scroll":
      return buildBaseEvent({
        ...location,
        kind: "scroll",
        category: "interaction",
        nodeId: firstNumber(data.id),
        rawType: "IncrementalSnapshot",
        rawSource: sourceName,
        data: { x: firstNumber(data.x), y: firstNumber(data.y) },
      });
    case "ViewportResize":
      return buildBaseEvent({
        ...location,
        kind: "viewport",
        category: "viewport",
        label: "resize",
        rawType: "IncrementalSnapshot",
        rawSource: sourceName,
        data: {
          width: firstNumber(data.width),
          height: firstNumber(data.height),
        },
      });
    case "Input":
      return buildBaseEvent({
        ...location,
        kind: "input",
        category: "input",
        nodeId: firstNumber(data.id),
        rawType: "IncrementalSnapshot",
        rawSource: sourceName,
        data: {
          textLength:
            typeof data.text === "string" ? data.text.length : undefined,
          isChecked:
            typeof data.isChecked === "boolean" ? data.isChecked : undefined,
          masked:
            typeof data.text === "string" && MASKED_INPUT_RE.test(data.text),
        },
      });
    case "Log": {
      const level = firstString(data.level);
      const message = Array.isArray(data.payload)
        ? data.payload.map(String).join(" ")
        : firstString(data.payload, data.message);
      return buildBaseEvent({
        ...location,
        kind: level === "error" ? "error" : "console",
        category: "console",
        label: level ?? "console",
        message,
        rawType: "IncrementalSnapshot",
        rawSource: sourceName,
        data: { level },
      });
    }
    default:
      return null;
  }
}

function breadcrumbKind(payload: RecordValue): ReplayEventKind {
  const category = firstString(payload.category)?.toLowerCase() ?? "";
  const type = firstString(payload.type)?.toLowerCase() ?? "";
  const level = firstString(payload.level)?.toLowerCase() ?? "";

  if (
    category.includes("fetch") ||
    category.includes("xhr") ||
    category.includes("http") ||
    type === "http"
  ) {
    return "network";
  }
  if (category.includes("console")) {
    return level === "error" ? "error" : "console";
  }
  if (category.includes("exception") || category.includes("error")) {
    return "error";
  }
  if (category.includes("navigation")) {
    return "navigation";
  }
  return "breadcrumb";
}

function normalizeBreadcrumbCustomFrame(
  location: FrameLocation,
  payload: RecordValue
): ReplayEvent {
  const { ctx } = location;
  const nestedData = isRecord(payload.data) ? payload.data : {};
  const kind = breadcrumbKind(payload);
  const url = firstString(payload.url, nestedData.url, nestedData.to);
  if (kind === "navigation" && url) {
    ctx.currentUrl = url;
  }

  return buildBaseEvent({
    ...location,
    kind,
    category: kind === "breadcrumb" ? "breadcrumb" : kind,
    label: firstString(payload.category, payload.type) ?? kind,
    message: firstString(payload.message),
    url,
    rawType: "Custom",
    rawSource: "breadcrumb",
    data: {
      level: firstString(payload.level),
      statusCode: firstNumber(nestedData.status_code, nestedData.status),
      method: firstString(nestedData.method),
    },
  });
}

function normalizeClickCustomFrame(
  location: FrameLocation,
  tag: string,
  payload: RecordValue
): ReplayEvent {
  const selector = firstString(payload.selector);
  const label = firstString(payload.label) ?? tag;
  return buildBaseEvent({
    ...location,
    kind: "click",
    category: "interaction",
    label,
    selector,
    rawType: "Custom",
    rawSource: tag,
    data: {
      interaction: tag,
      isDeadClick: tag === "deadClick",
      isRageClick: tag === "rageClick",
    },
  });
}

function normalizePerformanceSpanCustomFrame(
  location: FrameLocation,
  payload: RecordValue
): ReplayEvent {
  const nestedData = isRecord(payload.data) ? payload.data : {};
  const op = firstString(payload.op);
  const description = firstString(payload.description);
  return buildBaseEvent({
    ...location,
    kind: "span",
    category: "performance",
    label: op ?? "performanceSpan",
    message: description,
    rawType: "Custom",
    rawSource: "performanceSpan",
    data: {
      op,
      description,
      durationMs: firstNumber(nestedData.duration, payload.duration),
    },
  });
}

function normalizeCustomFrame(
  ctx: EventContext,
  frame: RecordValue,
  segmentIndex: number,
  frameIndex: number
): ReplayEvent | null {
  const location = { ctx, frame, segmentIndex, frameIndex };
  const data = isRecord(frame.data) ? frame.data : {};
  const tag = firstString(data.tag);
  const payload = isRecord(data.payload) ? data.payload : {};

  if (!tag) {
    const href = firstString(data.href);
    if (!href) {
      return null;
    }
    ctx.currentUrl = href;
    return buildBaseEvent({
      ...location,
      kind: "navigation",
      category: "navigation",
      label: "page.view",
      url: href,
      rawType: "Custom",
      rawSource: "href",
    });
  }

  if (tag === "breadcrumb") {
    return normalizeBreadcrumbCustomFrame(location, payload);
  }

  if (CLICK_LIKE_CUSTOM_TAGS.has(tag)) {
    return normalizeClickCustomFrame(location, tag, payload);
  }

  if (tag === "performanceSpan") {
    return normalizePerformanceSpanCustomFrame(location, payload);
  }

  const kindByTag: Record<string, ReplayEventKind> = {
    memory: "memory",
    mobile: "mobile",
    navigation: "navigation",
    video: "video",
    webVital: "web-vital",
  };
  const kind = kindByTag[tag] ?? "unknown";
  return buildBaseEvent({
    ...location,
    kind,
    category: kind === "unknown" ? "custom" : kind,
    label: tag,
    message: firstString(payload.message, payload.description),
    rawType: "Custom",
    rawSource: tag,
    data: payload,
  });
}

function normalizeFrame(
  ctx: EventContext,
  frame: unknown,
  segmentIndex: number,
  frameIndex: number
): ReplayEvent | null {
  if (!isRecord(frame)) {
    return null;
  }

  const type = firstNumber(frame.type);
  const typeName =
    type !== undefined ? (RRWEB_EVENT_TYPES[type] ?? String(type)) : undefined;

  if (typeName === "FullSnapshot") {
    return buildBaseEvent({
      ctx,
      frame,
      segmentIndex,
      frameIndex,
      kind: "dom-snapshot",
      category: "dom",
      label: "full-snapshot",
      rawType: typeName,
    });
  }

  if (typeName === "Meta") {
    const data = isRecord(frame.data) ? frame.data : {};
    const href = firstString(data.href);
    if (!href) {
      return null;
    }
    ctx.currentUrl = href;
    return buildBaseEvent({
      ctx,
      frame,
      segmentIndex,
      frameIndex,
      kind: "navigation",
      category: "navigation",
      label: "page.view",
      url: href,
      rawType: typeName,
    });
  }

  if (typeName === "IncrementalSnapshot") {
    return normalizeIncrementalFrame(ctx, frame, segmentIndex, frameIndex);
  }

  if (typeName === "Custom" || isRecord(frame.data)) {
    return normalizeCustomFrame(ctx, frame, segmentIndex, frameIndex);
  }

  return null;
}

export function extractNormalizedReplayEvents(
  replay: ReplayDetails,
  segments: ReplayRecordingSegments,
  options: { includeRaw?: boolean } = {}
): ReplayEvent[] {
  const replayStartMs = timestampToMillis(replay.started_at);
  const ctx: EventContext = {
    replayId: replay.id,
    replayStartMs,
    includeRaw: options.includeRaw ?? false,
  };

  const events: ReplayEvent[] = [];
  for (const [segmentIndex, segment] of segments.entries()) {
    for (const [frameIndex, frame] of segment.entries()) {
      const normalized = normalizeFrame(ctx, frame, segmentIndex, frameIndex);
      if (normalized) {
        events.push(normalized);
      }
    }
  }

  return events.sort((a, b) => {
    if (a.offsetMs === null && b.offsetMs === null) {
      return a.segmentIndex - b.segmentIndex || a.frameIndex - b.frameIndex;
    }
    if (a.offsetMs === null) {
      return 1;
    }
    if (b.offsetMs === null) {
      return -1;
    }
    return a.offsetMs - b.offsetMs;
  });
}

function textMatches(event: ReplayEvent, needle: string): boolean {
  const normalizedNeedle = needle.toLowerCase();
  const haystack = [
    event.kind,
    event.category,
    event.label,
    event.message,
    event.url,
    event.selector,
    event.rawType,
    event.rawSource,
    event.data ? JSON.stringify(event.data) : undefined,
  ]
    .filter((value): value is string => typeof value === "string")
    .join("\n")
    .toLowerCase();
  return haystack.includes(normalizedNeedle);
}

function eventMatchesTextFilters(
  event: ReplayEvent,
  filters: ReplayEventFilters,
  contains: string | undefined
): boolean {
  if (filters.url && !(event.url ?? "").includes(filters.url)) {
    return false;
  }
  if (filters.path && !replayUrlPathMatches(event.url, filters.path)) {
    return false;
  }
  if (filters.selector && !(event.selector ?? "").includes(filters.selector)) {
    return false;
  }
  if (contains && !textMatches(event, contains)) {
    return false;
  }
  return true;
}

function eventMatchesOffsetWindow(
  event: ReplayEvent,
  filters: ReplayEventFilters
): boolean {
  if (
    filters.fromMs !== undefined &&
    (event.offsetMs === null || event.offsetMs < filters.fromMs)
  ) {
    return false;
  }
  if (
    filters.toMs !== undefined &&
    (event.offsetMs === null || event.offsetMs > filters.toMs)
  ) {
    return false;
  }
  return true;
}

export function filterNormalizedReplayEvents(
  events: ReplayEvent[],
  filters: ReplayEventFilters
): ReplayEvent[] {
  const kindSet =
    filters.kinds && filters.kinds.length > 0
      ? new Set(filters.kinds)
      : undefined;
  const contains = filters.contains?.toLowerCase();

  return events.filter((event) => {
    if (kindSet && !kindSet.has(event.kind)) {
      return false;
    }
    return (
      eventMatchesTextFilters(event, filters, contains) &&
      eventMatchesOffsetWindow(event, filters)
    );
  });
}

/** Parse replay offsets such as `01:23`, `1:02:03`, `90s`, `2m`, or `83000ms`. */
export function parseReplayOffset(value: string): number {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new ValidationError("Offset cannot be empty", "offset");
  }

  if (trimmed.endsWith("ms")) {
    const ms = Number(trimmed.slice(0, -2));
    if (Number.isFinite(ms) && ms >= 0) {
      return Math.round(ms);
    }
  }

  const relative = parseRelativeParts(trimmed);
  if (relative) {
    return relative.value * (UNIT_SECONDS[relative.unit] ?? 0) * 1000;
  }

  if (SECONDS_OFFSET_RE.test(trimmed)) {
    return Math.round(Number(trimmed) * 1000);
  }

  const parts = trimmed.split(":").map(Number);
  if (
    parts.length < 2 ||
    parts.length > 3 ||
    parts.some((part) => !Number.isFinite(part) || part < 0)
  ) {
    throw new ValidationError(
      `Invalid replay offset '${value}'. Use seconds, 90s, 01:23, or 1:02:03.`,
      "offset"
    );
  }

  const [hours, minutes, seconds] =
    parts.length === 3 ? parts : [0, parts[0], parts[1]];
  return Math.round(
    ((hours ?? 0) * 3600 + (minutes ?? 0) * 60 + (seconds ?? 0)) * 1000
  );
}
