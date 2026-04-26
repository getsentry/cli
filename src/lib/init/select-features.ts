/**
 * Sentry feature catalog (CLI side).
 *
 * Feature SELECTION is now agent-driven: the sandboxed Claude agent
 * analyses the project + docs and calls a `propose_features` MCP tool
 * that bridges back to the CLI as a tailored multi-select. This file
 * no longer contains an upfront prompt — it owns:
 *
 *   - `FEATURE_LABELS`: the human-readable label/hint per id, used by
 *     [interactive.ts](./interactive.ts) when rendering the agent's
 *     multi-select.
 *   - `SELECTABLE_FEATURE_IDS`: the canonical ID set, kept in lockstep
 *     with the server's `KNOWN_FEATURES` (minus `errorMonitoring`).
 *   - `normaliseFromFlag`: parses the `--features` flag into canonical
 *     IDs (handles aliases like `replay`, `tracing`, etc.). The result
 *     is sent to the server as `InitStartInput.features` and tells the
 *     agent to skip its own proposal.
 *
 * `errorMonitoring` is implicit and is tracked separately in
 * [REQUIRED_FEATURE](./constants.ts).
 */

export const FEATURE_LABELS: Record<string, { label: string; hint: string }> = {
  tracing: {
    label: "Performance Monitoring (Tracing)",
    hint: "Distributed transaction and span tracing",
  },
  performanceMonitoring: {
    label: "Performance Monitoring (Tracing)",
    hint: "Distributed transaction and span tracing",
  },
  logs: { label: "Logging", hint: "Structured log ingestion" },
  sessionReplay: {
    label: "Session Replay",
    hint: "Visual replay of user sessions (browsers only)",
  },
  profiling: {
    label: "Profiling",
    hint: "Code-level CPU/wall-time profiling",
  },
  aiMonitoring: {
    label: "AI Agent Monitoring",
    hint: "Track LLM/agent calls, tool runs, tokens",
  },
  userFeedback: {
    label: "User Feedback",
    hint: "Collect in-app user feedback (browsers only)",
  },
  sourceMaps: {
    label: "Source Maps",
    hint: "Show original source in production stack traces",
  },
  crons: {
    label: "Cron Monitoring",
    hint: "Monitor scheduled / recurring jobs",
  },
  metrics: {
    label: "Metrics",
    hint: "Custom counters, distributions, gauges",
  },
};

const SORT_ORDER = [
  "tracing",
  "performanceMonitoring",
  "logs",
  "sessionReplay",
  "profiling",
  "aiMonitoring",
  "userFeedback",
  "sourceMaps",
  "crons",
  "metrics",
];

export function sortFeatures(ids: string[]): string[] {
  return [...ids].sort(
    (a, b) =>
      (SORT_ORDER.indexOf(a) === -1
        ? Number.MAX_SAFE_INTEGER
        : SORT_ORDER.indexOf(a)) -
      (SORT_ORDER.indexOf(b) === -1
        ? Number.MAX_SAFE_INTEGER
        : SORT_ORDER.indexOf(b))
  );
}

/**
 * Feature ids the wizard knows how to install. Kept in lockstep with the
 * server-side `KNOWN_FEATURES` (minus `errorMonitoring`, which is
 * implicit). `interactive.ts` looks up labels for IDs the agent proposes
 * via `FEATURE_LABELS`; unknown IDs fall back to the raw id.
 */
export const SELECTABLE_FEATURE_IDS = [
  "tracing",
  "logs",
  "sessionReplay",
  "profiling",
  "aiMonitoring",
  "userFeedback",
  "sourceMaps",
  "crons",
  "metrics",
  "performanceMonitoring",
] as const;

export type SelectableFeatureId = (typeof SELECTABLE_FEATURE_IDS)[number];

const ALIASES: Record<string, SelectableFeatureId> = {
  errors: "tracing", // backward-compat
  performance: "tracing",
  trace: "tracing",
  log: "logs",
  logging: "logs",
  replay: "sessionReplay",
  "session-replay": "sessionReplay",
  ai: "aiMonitoring",
  "ai-monitoring": "aiMonitoring",
  feedback: "userFeedback",
  "user-feedback": "userFeedback",
  sourcemaps: "sourceMaps",
  "source-maps": "sourceMaps",
  cron: "crons",
};

/**
 * Normalise the `--features <list>` flag into canonical IDs. Aliases
 * (`replay`, `tracing`, …) are resolved; unknown values are silently
 * dropped (the agent only acts on IDs it recognises).
 */
export function normaliseFromFlag(features?: string[]): SelectableFeatureId[] {
  if (!features || features.length === 0) {
    return [];
  }
  const out = new Set<SelectableFeatureId>();
  for (const raw of features) {
    const clean = raw.trim();
    if (!clean) {
      continue;
    }
    if ((SELECTABLE_FEATURE_IDS as readonly string[]).includes(clean)) {
      out.add(clean as SelectableFeatureId);
      continue;
    }
    const aliased = ALIASES[clean];
    if (aliased) {
      out.add(aliased);
    }
  }
  return [...out];
}
