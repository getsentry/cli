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
    cancel(`Setup cancelled. Visit ${SENTRY_DOCS_URL} to set up manually.`);
    throw new WizardCancelledError();
  }
  return value as T;
}

export const FEATURE_INFO: Record<string, { label: string; hint: string }> = {
  errorMonitoring: {
    label: "Error Monitoring",
    hint: "Automatic error and crash reporting",
  },
  performanceMonitoring: {
    label: "Performance Monitoring",
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

export const STEP_LABELS: Record<string, string> = {
  "discover-context": "Analyzing project structure",
  "select-target-app": "Selecting target application",
  "resolve-dir": "Resolving project directory",
  "check-existing-sentry": "Checking for existing Sentry installation",
  "detect-platform": "Detecting platform and framework",
  "ensure-sentry-project": "Setting up Sentry project",
  "select-features": "Selecting features",
  "determine-pm": "Detecting package manager",
  "install-deps": "Installing dependencies",
  "plan-codemods": "Planning code modifications",
  "apply-codemods": "Applying code modifications",
  "verify-changes": "Verifying changes",
  "add-example-trigger": "Example error trigger",
  "open-sentry-ui": "Finishing up",
};
