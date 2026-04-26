/**
 * Feature selection for `sentry init`.
 *
 * In `--yes` mode we accept the flag-provided list (or empty if not
 * given). Interactively, we present a multi-select. `errorMonitoring`
 * is always implicit — never shown — and is tracked in
 * [REQUIRED_FEATURE](./constants.ts).
 */

import { isCancel, multiselect } from "@clack/prompts";
import { WizardCancelledError } from "./clack-utils.js";

const FEATURE_LABELS: Record<string, { label: string; hint: string }> = {
  tracing: {
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
};

const SORT_ORDER = [
  "tracing",
  "logs",
  "sessionReplay",
  "profiling",
  "aiMonitoring",
  "userFeedback",
  "sourceMaps",
  "crons",
];

function sortFeatures(ids: string[]): string[] {
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
 * Feature ids the wizard knows how to install. Kept in sync with the
 * server-side `FEATURES` map (`apps/server/src/agent/src/features.ts`).
 * "errorMonitoring" is implicit and not listed.
 */
const SELECTABLE_FEATURE_IDS = [
  "tracing",
  "logs",
  "sessionReplay",
  "profiling",
  "aiMonitoring",
  "userFeedback",
  "sourceMaps",
  "crons",
] as const;

export type SelectableFeatureId = (typeof SELECTABLE_FEATURE_IDS)[number];

const ALIASES: Record<string, SelectableFeatureId> = {
  errors: "tracing", // backward-compat
  performanceMonitoring: "tracing",
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

export async function selectFeatures(opts: {
  yes: boolean;
  fromFlag?: string[];
}): Promise<string[]> {
  const flagSelected = normaliseFromFlag(opts.fromFlag);
  if (opts.yes) {
    return sortFeatures(flagSelected);
  }
  if (flagSelected.length > 0) {
    return sortFeatures(flagSelected);
  }

  const choice = await multiselect<SelectableFeatureId>({
    message:
      "Select Sentry features to enable. Error monitoring is always on.",
    options: SELECTABLE_FEATURE_IDS.map((id) => ({
      value: id,
      label: FEATURE_LABELS[id]?.label ?? id,
      hint: FEATURE_LABELS[id]?.hint,
    })),
    required: false,
  });
  if (isCancel(choice)) {
    throw new WizardCancelledError();
  }
  return sortFeatures(choice as string[]);
}

function normaliseFromFlag(features?: string[]): SelectableFeatureId[] {
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
    // Silently drop unknowns — the agent will only act on selectedFeatures
    // it recognises anyway.
  }
  return [...out];
}
