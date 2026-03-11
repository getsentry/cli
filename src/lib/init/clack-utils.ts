/**
 * Clack Utilities
 *
 * Shared helpers for the clack-based init wizard UI.
 */

import { cancel, isCancel } from "@clack/prompts";
import { SENTRY_DOCS_URL } from "./constants.js";

export class WizardCancelledError extends Error {
  constructor() {
    super("Setup cancelled.");
    this.name = "WizardCancelledError";
  }
}

export function abortIfCancelled<T>(value: T | symbol): T {
  if (isCancel(value)) {
    cancel(
      `Setup cancelled. You can visit ${SENTRY_DOCS_URL} to set up manually.`
    );
    throw new WizardCancelledError();
  }
  return value as T;
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
  metrics: { label: "Custom Metrics", hint: "Track custom business metrics" },
  sourceMaps: {
    label: "Source Maps",
    hint: "See original source code in production errors",
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
