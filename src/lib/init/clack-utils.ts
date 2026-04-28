/**
 * Wizard Utilities
 *
 * Shared cancellation/error helpers and feature labels for the init
 * wizard. Originally a clack-specific utility module — the name is
 * preserved for now to keep diffs minimal across PRs while the UI
 * layer is migrated. PR 4 renames this file to `wizard-utils.ts` after
 * the clack dependency is removed.
 *
 * `abortIfCancelled()` recognises **both** the new `WizardUI`
 * cancellation sentinel and clack's legacy cancel symbol — the latter
 * because `ClackUI` returns the unified sentinel but downstream callers
 * may still receive raw clack symbols during the migration window.
 */

import { isCancel as clackIsCancel } from "./clack-plain.js";
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
 * Recognises the unified `CANCELLED` sentinel from `ui/types.ts`. Also
 * recognises clack's legacy cancel symbol so callers that still touch
 * clack directly continue to work during PR 2.
 *
 * The return type uses `Exclude<T, symbol>` so callers passing a union
 * that includes a symbol member (e.g. `string[] | typeof CANCELLED`)
 * receive the narrowed non-symbol type back — TypeScript otherwise
 * widens `T` to the full union and refuses to call array methods on it.
 */
export function abortIfCancelled<T>(value: T): Exclude<T, symbol> {
  if (isCancelled(value) || clackIsCancel(value)) {
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
