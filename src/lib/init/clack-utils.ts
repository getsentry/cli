/**
 * Wizard Utilities
 *
 * Shared cancellation helpers and feature labels for the init wizard.
 *
 * The file name is preserved (vs. renaming to `wizard-utils.ts`) to
 * keep the diff in PR 4 focused on the clack removal — the next
 * cleanup PR can do the rename. Despite the historical name nothing
 * here references clack any more.
 */

import { isCancelled } from "./ui/types.js";

export class WizardCancelledError extends Error {
  constructor() {
    super("Setup cancelled.");
    this.name = "WizardCancelledError";
  }
}

/**
 * Coerce a possibly-cancelled prompt result into the resolved value, or
 * throw `WizardCancelledError` on cancellation.
 *
 * The return type uses `Exclude<T, symbol>` so callers passing a union
 * that includes a symbol member (e.g. `string[] | typeof CANCELLED`)
 * receive the narrowed non-symbol type back — TypeScript otherwise
 * widens `T` to the full union and refuses to call array methods on it.
 */
export function abortIfCancelled<T>(value: T): Exclude<T, symbol> {
  if (isCancelled(value)) {
    throw new WizardCancelledError();
  }
  return value as Exclude<T, symbol>;
}

const FEATURE_INFO: Record<string, { label: string; hint: string }> = {
  errorMonitoring: {
    label: "Error Monitoring",
    hint: "Error and crash reporting",
  },
  performanceMonitoring: {
    label: "Performance Monitoring (Tracing)",
    hint: "Transaction and span tracing",
  },
  sessionReplay: {
    label: "Session Replay",
    hint: "Visual replay of user sessions",
  },
  profiling: {
    label: "Profiling",
    hint: "Code-level performance insights",
  },
  logs: { label: "Logging", hint: "Structured log ingestion" },
  metrics: { label: "Metrics", hint: "Track business metrics" },
  sourceMaps: {
    label: "Source Maps",
    hint: "See original source code in production errors",
  },
  crons: {
    label: "Crons",
    hint: "Monitor scheduled and recurring jobs",
  },
  aiMonitoring: {
    label: "AI Monitoring",
    hint: "Track AI model calls, latency, and failures",
  },
  userFeedback: {
    label: "User Feedback",
    hint: "Collect in-app user feedback and reports",
  },
  reactFeatures: {
    label: "React Features",
    hint: "Redux, component tracking, source maps, and integrations",
  },
};

export function featureLabel(id: string): string {
  return FEATURE_INFO[id]?.label ?? id;
}

export function featureHint(id: string): string | undefined {
  return FEATURE_INFO[id]?.hint;
}

const FEATURE_DISPLAY_ORDER = [
  "errorMonitoring",
  "sessionReplay",
  "performanceMonitoring",
  "logs",
  "metrics",
  "profiling",
  "sourceMaps",
  "crons",
  "aiMonitoring",
  "userFeedback",
  "reactFeatures",
];

/** Sort features into canonical display order for the multi-select prompt. */
export function sortFeatures(features: string[]): string[] {
  return features.slice().sort((a, b) => {
    const ai = FEATURE_DISPLAY_ORDER.indexOf(a);
    const bi = FEATURE_DISPLAY_ORDER.indexOf(b);
    return (
      (ai === -1 ? Number.MAX_SAFE_INTEGER : ai) -
      (bi === -1 ? Number.MAX_SAFE_INTEGER : bi)
    );
  });
}

export const STEP_LABELS: Record<string, string> = {
  "discover-context": "Analyzing project structure",
  "select-target-app": "Selecting target application",
  "resolve-dir": "Resolving project directory",
  "check-existing-sentry": "Checking for existing Sentry installation",
  "detect-platform": "Detecting platform and framework",
  "ensure-sentry-project": "Setting up Sentry project",
  "select-features": "Selecting features",
  "install-deps": "Installing dependencies",
  "plan-codemods": "Planning code modifications",
  "apply-codemods": "Applying code modifications",
  "verify-changes": "Verifying changes",
  "open-sentry-ui": "Finishing up",
};

/**
 * Canonical execution order of the wizard's workflow steps.
 *
 * Used by the Ink sidebar's progress checklist as the static
 * pre-rendered list. The wizard advertises step transitions via
 * `WizardUI.setStep(...)`; the store back-fills any earlier
 * `pending` rows as `skipped` when a later step starts (the workflow
 * can only move forward, so a later transition implies any earlier
 * pending step was bypassed by an `if`-branch in the workflow).
 *
 * Order must match the actual Mastra workflow order or the back-fill
 * logic will mis-mark steps as skipped.
 */
export const CANONICAL_STEP_ORDER: readonly string[] = [
  "discover-context",
  "select-target-app",
  "resolve-dir",
  "check-existing-sentry",
  "detect-platform",
  "ensure-sentry-project",
  "select-features",
  "install-deps",
  "plan-codemods",
  "apply-codemods",
  "verify-changes",
  "open-sentry-ui",
];

/**
 * Subset of {@link CANONICAL_STEP_ORDER} surfaced in the progress
 * checklist. The Ink sidebar is 36 cols wide and shares vertical
 * space with the tip card and the files-read panel, so showing all
 * 12 step rows would push the files panel off-screen on shorter
 * terminals.
 *
 * The hidden steps (`select-target-app`, `resolve-dir`,
 * `check-existing-sentry`) are plumbing — users care that "Setting up
 * Sentry project" happened, not that we resolved their working
 * directory along the way.
 */
export const CHECKLIST_VISIBLE_STEPS: readonly string[] = [
  "discover-context",
  "detect-platform",
  "ensure-sentry-project",
  "select-features",
  "install-deps",
  "plan-codemods",
  "apply-codemods",
  "verify-changes",
  "open-sentry-ui",
];

/**
 * Sidebar-friendly abbreviations of {@link STEP_LABELS}. The full
 * labels stay the source-of-truth for the spinner message in the main
 * column; only the 36-col sidebar checklist uses these.
 *
 * Falls back to the full label if a step isn't listed here.
 */
export const STEP_LABELS_SHORT: Record<string, string> = {
  "discover-context": "Analyzing project",
  "detect-platform": "Detecting platform",
  "ensure-sentry-project": "Setting up project",
  "select-features": "Selecting features",
  "install-deps": "Installing deps",
  "plan-codemods": "Planning changes",
  "apply-codemods": "Applying changes",
  "verify-changes": "Verifying changes",
  "open-sentry-ui": "Finishing up",
};

/** Resolve a step id to its sidebar checklist label. */
export function shortStepLabel(stepId: string): string {
  return STEP_LABELS_SHORT[stepId] ?? STEP_LABELS[stepId] ?? stepId;
}
