/**
 * Deterministic Session Replay behavior summaries.
 *
 * The summary intentionally stays factual: counts, routes, timings, and
 * heuristic friction signals with nearby evidence. This gives agents useful
 * material for analysis without pretending the CLI performed subjective RCA.
 */

import type {
  ReplayDetails,
  ReplayEvent,
  ReplayEventCounts,
  ReplayFrictionSignal,
  ReplayRouteSummary,
  ReplaySummaryOutput,
  ReplayTimingSummary,
} from "../types/index.js";
import { replayUrlPathMatches } from "./replay-search.js";

type SummaryOptions = {
  org: string;
  project?: string;
  focusPath?: string;
  maxSignals?: number;
  maxNotableEvents?: number;
};

type ClickPoint = {
  event: ReplayEvent;
  x: number;
  y: number;
};

const DEFAULT_MAX_SIGNALS = 10;
const DEFAULT_MAX_NOTABLE_EVENTS = 12;
const REPEATED_CLICK_WINDOW_MS = 3000;
const REPEATED_CLICK_DISTANCE_PX = 32;
const LONG_WAIT_AFTER_CLICK_MS = 10_000;
const QUICK_BOUNCE_SECONDS = 10;
const SLOW_NAVIGATION_MS = 3000;
const SLOW_RESOURCE_MS = 3000;
const ROUTE_CHURN_WINDOW_MS = 15_000;
const ROUTE_CHURN_COUNT = 3;

const INPUT_KINDS = new Set(["input", "focus", "blur"]);
const NOTABLE_EVENT_KINDS = new Set([
  "navigation",
  "click",
  "tap",
  "input",
  "network",
  "console",
  "error",
]);

function numberFromData(event: ReplayEvent, key: string): number | undefined {
  const value = event.data?.[key];
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function stringFromData(event: ReplayEvent, key: string): string | undefined {
  const value = event.data?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function eventDuration(event: ReplayEvent): number | undefined {
  return numberFromData(event, "durationMs");
}

function replayDurationMs(replay: ReplayDetails): number | null {
  return typeof replay.duration === "number" && Number.isFinite(replay.duration)
    ? Math.round(replay.duration * 1000)
    : null;
}

function routeKey(event: ReplayEvent): string | undefined {
  return event.urlPath ?? undefined;
}

function countEvents(events: ReplayEvent[]): ReplayEventCounts {
  return {
    total: events.length,
    navigations: events.filter((event) => event.kind === "navigation").length,
    clicks: events.filter(
      (event) => event.kind === "click" || event.kind === "tap"
    ).length,
    inputs: events.filter((event) => INPUT_KINDS.has(event.kind)).length,
    network: events.filter((event) => event.kind === "network").length,
    console: events.filter((event) => event.kind === "console").length,
    errors: events.filter((event) => event.kind === "error").length,
    spans: events.filter((event) => event.kind === "span").length,
  };
}

function buildRouteSummaries(events: ReplayEvent[]): ReplayRouteSummary[] {
  const routes = new Map<string, ReplayRouteSummary>();

  for (const event of events) {
    const path = routeKey(event);
    if (!path) {
      continue;
    }

    const existing = routes.get(path);
    if (!existing) {
      routes.set(path, {
        path,
        url: event.url ?? null,
        firstOffsetMs: event.offsetMs,
        lastOffsetMs: event.offsetMs,
        eventCount: 1,
      });
      continue;
    }

    existing.eventCount += 1;
    if (event.offsetMs !== null) {
      existing.lastOffsetMs = event.offsetMs;
      if (
        existing.firstOffsetMs === null ||
        event.offsetMs < existing.firstOffsetMs
      ) {
        existing.firstOffsetMs = event.offsetMs;
      }
    }
  }

  return [...routes.values()].sort((a, b) => {
    if (a.firstOffsetMs === null && b.firstOffsetMs === null) {
      return 0;
    }
    if (a.firstOffsetMs === null) {
      return 1;
    }
    if (b.firstOffsetMs === null) {
      return -1;
    }
    return a.firstOffsetMs - b.firstOffsetMs;
  });
}

function firstOffsetForSpan(
  events: ReplayEvent[],
  op: string,
  description: string
): number | null {
  const event = events.find(
    (item) =>
      item.kind === "span" &&
      stringFromData(item, "op") === op &&
      item.message === description &&
      item.offsetMs !== null
  );
  return event?.offsetMs ?? null;
}

function timingSummary(events: ReplayEvent[]): ReplayTimingSummary {
  const navigationSpan = events.find(
    (event) =>
      event.kind === "span" &&
      stringFromData(event, "op") === "navigation.navigate" &&
      eventDuration(event) !== undefined
  );

  return {
    firstPaintMs: firstOffsetForSpan(events, "paint", "first-paint"),
    firstContentfulPaintMs: firstOffsetForSpan(
      events,
      "paint",
      "first-contentful-paint"
    ),
    largestContentfulPaintMs: firstOffsetForSpan(
      events,
      "web-vital",
      "largest-contentful-paint"
    ),
    navigationDurationMs: navigationSpan
      ? (eventDuration(navigationSpan) ?? null)
      : null,
  };
}

function eventsAround(
  events: ReplayEvent[],
  offsetMs: number | null,
  limit = 6
): ReplayEvent[] {
  if (offsetMs === null) {
    return [];
  }

  return events
    .filter(
      (event) =>
        event.offsetMs !== null &&
        Math.abs(event.offsetMs - offsetMs) <= LONG_WAIT_AFTER_CLICK_MS &&
        (NOTABLE_EVENT_KINDS.has(event.kind) || event.kind === "span")
    )
    .slice(0, limit);
}

function pushSignal(
  signals: ReplayFrictionSignal[],
  signal: ReplayFrictionSignal,
  maxSignals: number
): void {
  if (signals.length >= maxSignals) {
    return;
  }
  signals.push(signal);
}

function signalFromEvent(params: {
  events: ReplayEvent[];
  event: ReplayEvent;
  kind: ReplayFrictionSignal["kind"];
  severity: ReplayFrictionSignal["severity"];
  message: string;
}): ReplayFrictionSignal {
  const { events, event, kind, message, severity } = params;
  return {
    kind,
    severity,
    offsetMs: event.offsetMs,
    url: event.url ?? null,
    urlPath: event.urlPath ?? null,
    message,
    evidence: eventsAround(events, event.offsetMs),
  };
}

function indexedSignalContext(events: ReplayEvent[]) {
  const offsetMs = events[0]?.offsetMs ?? null;
  return {
    offsetMs,
    url: events[0]?.url ?? null,
    urlPath: events[0]?.urlPath ?? null,
    evidence: offsetMs === null ? [] : eventsAround(events, offsetMs),
  };
}

function detectIndexedErrorSignal(
  replay: ReplayDetails,
  events: ReplayEvent[],
  signals: ReplayFrictionSignal[],
  maxSignals: number
): void {
  if ((replay.count_errors ?? 0) <= 0 && replay.error_ids.length === 0) {
    return;
  }

  const errorCount =
    replay.count_errors && replay.count_errors > 0
      ? replay.count_errors
      : replay.error_ids.length;
  pushSignal(
    signals,
    {
      kind: "indexed_error",
      severity: "high",
      ...indexedSignalContext(events),
      message: `Replay is linked to ${errorCount} error event(s).`,
    },
    maxSignals
  );
}

function detectIndexedWarningSignal(
  replay: ReplayDetails,
  events: ReplayEvent[],
  signals: ReplayFrictionSignal[],
  maxSignals: number
): void {
  if ((replay.count_warnings ?? 0) <= 0 && replay.warning_ids.length === 0) {
    return;
  }

  const warningCount =
    replay.count_warnings && replay.count_warnings > 0
      ? replay.count_warnings
      : replay.warning_ids.length;
  pushSignal(
    signals,
    {
      kind: "indexed_warning",
      severity: "medium",
      ...indexedSignalContext(events),
      message: `Replay is linked to ${warningCount} warning event(s).`,
    },
    maxSignals
  );
}

function detectIndexedSignals(
  replay: ReplayDetails,
  events: ReplayEvent[],
  signals: ReplayFrictionSignal[],
  maxSignals: number
): void {
  detectIndexedErrorSignal(replay, events, signals, maxSignals);
  detectIndexedWarningSignal(replay, events, signals, maxSignals);
}

function clickPoints(events: ReplayEvent[]): ClickPoint[] {
  return events
    .filter((event) => event.kind === "click" || event.kind === "tap")
    .map((event) => {
      const x = numberFromData(event, "x");
      const y = numberFromData(event, "y");
      return x === undefined || y === undefined ? undefined : { event, x, y };
    })
    .filter((point): point is ClickPoint => point !== undefined);
}

function detectExplicitClickSignals(
  events: ReplayEvent[],
  signals: ReplayFrictionSignal[],
  maxSignals: number
): void {
  for (const event of events) {
    if (event.kind !== "click" && event.kind !== "tap") {
      continue;
    }

    if (event.data?.isRageClick === true) {
      pushSignal(
        signals,
        signalFromEvent({
          events,
          event,
          kind: "rage_click",
          severity: "high",
          message: "Replay includes a rage click signal.",
        }),
        maxSignals
      );
    }
    if (event.data?.isDeadClick === true) {
      pushSignal(
        signals,
        signalFromEvent({
          events,
          event,
          kind: "dead_click",
          severity: "medium",
          message: "Replay includes a dead click signal.",
        }),
        maxSignals
      );
    }
  }
}

function detectRepeatedClickSignal(
  events: ReplayEvent[],
  signals: ReplayFrictionSignal[],
  maxSignals: number
): void {
  const points = clickPoints(events);
  for (let i = 1; i < points.length; i += 1) {
    const previous = points[i - 1];
    const current = points[i];
    if (!(previous && current)) {
      continue;
    }
    if (previous.event.offsetMs === null || current.event.offsetMs === null) {
      continue;
    }

    const deltaMs = current.event.offsetMs - previous.event.offsetMs;
    const distance = Math.hypot(current.x - previous.x, current.y - previous.y);
    if (
      deltaMs <= REPEATED_CLICK_WINDOW_MS &&
      distance <= REPEATED_CLICK_DISTANCE_PX
    ) {
      pushSignal(
        signals,
        signalFromEvent({
          events,
          event: current.event,
          kind: "repeated_click",
          severity: "medium",
          message:
            "User clicked the same area repeatedly within a few seconds.",
        }),
        maxSignals
      );
      break;
    }
  }
}

function detectLongWaitAfterClickSignal(
  events: ReplayEvent[],
  replay: ReplayDetails,
  signals: ReplayFrictionSignal[],
  maxSignals: number
): void {
  const points = clickPoints(events);
  const durationMs = replayDurationMs(replay);
  for (const point of points) {
    const offsetMs = point.event.offsetMs;
    if (offsetMs === null || durationMs === null) {
      continue;
    }

    const next = events.find(
      (event) =>
        event.offsetMs !== null &&
        event.offsetMs > offsetMs &&
        NOTABLE_EVENT_KINDS.has(event.kind)
    );
    const nextOffset = next?.offsetMs ?? durationMs;
    if (nextOffset - offsetMs >= LONG_WAIT_AFTER_CLICK_MS) {
      pushSignal(
        signals,
        signalFromEvent({
          events,
          event: point.event,
          kind: "long_wait_after_click",
          severity: "low",
          message:
            "User clicked and then had a long wait or no further notable activity.",
        }),
        maxSignals
      );
      break;
    }
  }
}

function detectClickSignals(
  events: ReplayEvent[],
  replay: ReplayDetails,
  signals: ReplayFrictionSignal[],
  maxSignals: number
): void {
  detectExplicitClickSignals(events, signals, maxSignals);
  detectRepeatedClickSignal(events, signals, maxSignals);
  detectLongWaitAfterClickSignal(events, replay, signals, maxSignals);
}

function detectNetworkAndConsoleSignals(
  events: ReplayEvent[],
  signals: ReplayFrictionSignal[],
  maxSignals: number
): void {
  for (const event of events) {
    const statusCode = numberFromData(event, "statusCode");
    if (
      event.kind === "network" &&
      statusCode !== undefined &&
      statusCode >= 400
    ) {
      pushSignal(
        signals,
        signalFromEvent({
          events,
          event,
          kind: "network_error",
          severity: statusCode >= 500 ? "high" : "medium",
          message: `Network breadcrumb reported HTTP ${statusCode}.`,
        }),
        maxSignals
      );
    }
    if (
      event.kind === "console" &&
      stringFromData(event, "level")?.toLowerCase() === "error"
    ) {
      pushSignal(
        signals,
        signalFromEvent({
          events,
          event,
          kind: "console_error",
          severity: "medium",
          message: "Console emitted an error during the replay.",
        }),
        maxSignals
      );
    }
    if (event.kind === "error") {
      pushSignal(
        signals,
        signalFromEvent({
          events,
          event,
          kind: "error_event",
          severity: "high",
          message: event.message ?? "Replay contains an error event.",
        }),
        maxSignals
      );
    }
  }
}

function detectPerformanceSignals(
  events: ReplayEvent[],
  signals: ReplayFrictionSignal[],
  maxSignals: number
): void {
  for (const event of events) {
    if (event.kind !== "span") {
      continue;
    }

    const durationMs = eventDuration(event);
    if (durationMs === undefined) {
      continue;
    }

    const op = stringFromData(event, "op") ?? event.label ?? "";
    if (op === "navigation.navigate" && durationMs >= SLOW_NAVIGATION_MS) {
      pushSignal(
        signals,
        signalFromEvent({
          events,
          event,
          kind: "slow_navigation",
          severity: "medium",
          message: `Navigation took ${Math.round(durationMs)}ms.`,
        }),
        maxSignals
      );
    } else if (op.startsWith("resource.") && durationMs >= SLOW_RESOURCE_MS) {
      pushSignal(
        signals,
        signalFromEvent({
          events,
          event,
          kind: "slow_resource",
          severity: "low",
          message: `Resource load took ${Math.round(durationMs)}ms.`,
        }),
        maxSignals
      );
    }
  }
}

function detectSessionShapeSignals(
  replay: ReplayDetails,
  events: ReplayEvent[],
  signals: ReplayFrictionSignal[],
  maxSignals: number
): void {
  const counts = countEvents(events);
  if (
    typeof replay.duration === "number" &&
    replay.duration <= QUICK_BOUNCE_SECONDS &&
    counts.clicks === 0 &&
    counts.inputs === 0
  ) {
    pushSignal(
      signals,
      {
        kind: "quick_bounce",
        severity: "low",
        offsetMs: events[0]?.offsetMs ?? null,
        url: events[0]?.url ?? null,
        urlPath: events[0]?.urlPath ?? null,
        message: "Replay ended quickly without clicks or inputs.",
        evidence: events.slice(0, 5),
      },
      maxSignals
    );
  }

  const navigations = events.filter(
    (event) => event.kind === "navigation" && event.offsetMs !== null
  );
  for (const start of navigations) {
    if (start.offsetMs === null) {
      continue;
    }
    const startOffsetMs = start.offsetMs;
    const nearby = navigations.filter(
      (event) =>
        event.offsetMs !== null &&
        event.offsetMs >= startOffsetMs &&
        event.offsetMs - startOffsetMs <= ROUTE_CHURN_WINDOW_MS
    );
    if (nearby.length >= ROUTE_CHURN_COUNT) {
      pushSignal(
        signals,
        {
          kind: "route_churn",
          severity: "low",
          offsetMs: start.offsetMs,
          url: start.url ?? null,
          urlPath: start.urlPath ?? null,
          message: `${nearby.length} route changes occurred within ${ROUTE_CHURN_WINDOW_MS / 1000}s.`,
          evidence: nearby.slice(0, 6),
        },
        maxSignals
      );
      break;
    }
  }
}

function detectFrictionSignals(
  replay: ReplayDetails,
  events: ReplayEvent[],
  maxSignals: number
): ReplayFrictionSignal[] {
  const signals: ReplayFrictionSignal[] = [];
  detectIndexedSignals(replay, events, signals, maxSignals);
  detectClickSignals(events, replay, signals, maxSignals);
  detectNetworkAndConsoleSignals(events, signals, maxSignals);
  detectPerformanceSignals(events, signals, maxSignals);
  detectSessionShapeSignals(replay, events, signals, maxSignals);
  return signals.slice(0, maxSignals);
}

function notableEvents(
  events: ReplayEvent[],
  maxNotableEvents: number
): ReplayEvent[] {
  return events
    .filter((event) => NOTABLE_EVENT_KINDS.has(event.kind))
    .slice(0, maxNotableEvents);
}

function focusEvents(events: ReplayEvent[], focusPath?: string): ReplayEvent[] {
  if (!focusPath) {
    return events;
  }
  return events.filter((event) => replayUrlPathMatches(event.url, focusPath));
}

export function summarizeReplay(
  replay: ReplayDetails,
  events: ReplayEvent[],
  options: SummaryOptions
): ReplaySummaryOutput {
  const focusedEvents = focusEvents(events, options.focusPath);
  const maxSignals = options.maxSignals ?? DEFAULT_MAX_SIGNALS;
  const maxNotableEvents =
    options.maxNotableEvents ?? DEFAULT_MAX_NOTABLE_EVENTS;

  return {
    replayId: replay.id,
    org: options.org,
    project: options.project ?? null,
    startedAt: replay.started_at ?? null,
    durationSeconds: replay.duration ?? null,
    entryUrl: replay.urls[0] ?? null,
    exitUrl: replay.urls.at(-1) ?? null,
    focusPath: options.focusPath ?? null,
    counts: countEvents(focusedEvents),
    timings: timingSummary(focusedEvents),
    routes: buildRouteSummaries(focusedEvents),
    signals: detectFrictionSignals(replay, focusedEvents, maxSignals),
    notableEvents: notableEvents(focusedEvents, maxNotableEvents),
  };
}
