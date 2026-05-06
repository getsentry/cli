/**
 * Interactive Dispatcher
 *
 * Handles interactive prompts from the remote workflow.
 * Supports select, multi-select, and confirm prompts.
 * Respects --yes flag for non-interactive mode.
 *
 * All UI I/O goes through the injected `WizardUI` so the dispatcher
 * works identically against `InkUI` (interactive Bun binary) and
 * `LoggingUI` (CI / npm fallback).
 */

import chalk from "chalk";
import { CLI_VERSION } from "../constants.js";
import {
  abortIfCancelled,
  featureHint,
  featureLabel,
  sortFeatures,
} from "./clack-utils.js";
import { REQUIRED_FEATURE } from "./constants.js";
import type {
  ConfirmPayload,
  InteractiveContext,
  InteractivePayload,
  MultiSelectPayload,
  SelectPayload,
} from "./types.js";
import type {
  FeaturePlanOptions,
  FeaturePlanRow,
  WizardUI,
} from "./ui/types.js";

const RECOMMENDED_FEATURES = [
  "errorMonitoring",
  "performanceMonitoring",
  "sourceMaps",
] as const;

const FEATURE_PLAN_ORDER = [
  "errorMonitoring",
  "performanceMonitoring",
  "sourceMaps",
  "sessionReplay",
  "profiling",
  "logs",
  "metrics",
  "crons",
  "aiMonitoring",
  "userFeedback",
  "reactFeatures",
] as const;

const FEATURE_PLAN_COPY: Record<string, { label: string; detail: string }> = {
  errorMonitoring: {
    label: "Error monitoring",
    detail: "See exceptions with stack traces and release context",
  },
  performanceMonitoring: {
    label: "Performance tracing",
    detail: "Connect slow pages to backend requests",
  },
  sourceMaps: {
    label: "Source maps",
    detail: "Turn minified production stacks into readable code",
  },
  sessionReplay: {
    label: "Session Replay",
    detail: "See what users did before an error",
  },
  profiling: {
    label: "Profiling",
    detail: "Find CPU-heavy functions in production",
  },
};

function featurePlanRank(feature: string): number {
  const index = FEATURE_PLAN_ORDER.indexOf(
    feature as (typeof FEATURE_PLAN_ORDER)[number]
  );
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

function sortFeaturePlanFeatures(features: string[]): string[] {
  return features.slice().sort((a, b) => {
    const rankDelta = featurePlanRank(a) - featurePlanRank(b);
    if (rankDelta !== 0) {
      return rankDelta;
    }
    return a.localeCompare(b);
  });
}

function isRecommendedFeature(feature: string): boolean {
  return RECOMMENDED_FEATURES.includes(
    feature as (typeof RECOMMENDED_FEATURES)[number]
  );
}

function featurePlanCopy(feature: string): { label: string; detail: string } {
  const copy = FEATURE_PLAN_COPY[feature];
  if (copy) {
    return copy;
  }
  return {
    label: featureLabel(feature),
    detail: featureHint(feature) ?? "Configure this Sentry capability",
  };
}

function buildFeaturePlanOptions(available: string[]): FeaturePlanOptions {
  const rows: FeaturePlanRow[] = sortFeaturePlanFeatures(available).map(
    (feature) => {
      const copy = featurePlanCopy(feature);
      return {
        id: feature,
        label: copy.label,
        detail: copy.detail,
        recommended: isRecommendedFeature(feature),
      };
    }
  );
  return {
    message: "Setup",
    rows,
    recommendedFeatureIds: rows
      .filter((row) => row.recommended)
      .map((row) => row.id),
    version: CLI_VERSION,
  };
}

function prependRequiredFeature(
  features: string[],
  hasRequired: boolean
): string[] {
  if (!(hasRequired && !features.includes(REQUIRED_FEATURE))) {
    return features;
  }
  return [REQUIRED_FEATURE, ...features];
}

export async function handleInteractive(
  payload: InteractivePayload,
  options: InteractiveContext,
  ui: WizardUI
): Promise<Record<string, unknown>> {
  switch (payload.kind) {
    case "select":
      return await handleSelect(payload, options, ui);
    case "multi-select":
      return await handleMultiSelect(payload, options, ui);
    case "confirm":
      return await handleConfirm(payload, options, ui);
    default:
      return { cancelled: true };
  }
}

async function handleSelect(
  payload: SelectPayload,
  options: InteractiveContext,
  ui: WizardUI
): Promise<Record<string, unknown>> {
  const apps = payload.apps ?? [];
  const items = payload.options ?? apps.map((a) => a.name);

  if (items.length === 0) {
    return { cancelled: true };
  }

  if (options.yes) {
    if (items.length === 1) {
      ui.log.info(`Auto-selected: ${items[0]}`);
      return { selectedApp: items[0] };
    }
    ui.log.error(
      `--yes requires exactly one option for selection, but found ${items.length}. Run interactively to choose.`
    );
    return { cancelled: true };
  }

  const selected = await ui.select<string>({
    message: payload.prompt,
    options: items.map((item, i) => {
      const app = apps[i];
      return {
        value: item,
        label: item,
        ...(app?.framework ? { hint: app.framework } : {}),
      };
    }),
  });

  return { selectedApp: abortIfCancelled(selected) };
}

async function handleMultiSelect(
  payload: MultiSelectPayload,
  options: InteractiveContext,
  ui: WizardUI
): Promise<Record<string, unknown>> {
  const available = payload.availableFeatures ?? payload.options ?? [];

  if (available.length === 0) {
    return { features: [] };
  }

  const hasRequired = available.includes(REQUIRED_FEATURE);

  if (options.yes) {
    ui.log.info(
      `Auto-selected all features: ${available.map(featureLabel).join(", ")}`
    );
    return { features: available };
  }

  const optional = sortFeatures(
    available.filter((f) => f !== REQUIRED_FEATURE)
  );

  if (optional.length === 0) {
    if (hasRequired) {
      ui.log.info(`${featureLabel(REQUIRED_FEATURE)} is always included.`);
    }
    return { features: hasRequired ? [REQUIRED_FEATURE] : [] };
  }

  const featurePlanOptions = buildFeaturePlanOptions(available);
  if (ui.featurePlan && featurePlanOptions.recommendedFeatureIds.length > 0) {
    const planResult = abortIfCancelled(
      await ui.featurePlan(featurePlanOptions)
    );
    if (planResult.action === "apply") {
      return {
        features: prependRequiredFeature(
          Array.from(new Set(planResult.features)),
          hasRequired
        ),
      };
    }
  }

  const hints: string[] = [];
  // Use clack's vertical bar character so hint lines align with the option lines below
  const bar = chalk.gray("\u2502");
  if (hasRequired) {
    hints.push(
      `${bar}  ${chalk.dim(`${featureLabel(REQUIRED_FEATURE)} is always included`)}`
    );
  }
  hints.push(`${bar}  ${chalk.dim("space=toggle, a=all, enter=confirm")}`);

  const selected = await ui.multiselect<string>({
    message: `${payload.prompt}\n${hints.join("\n")}`,
    options: optional.map((feature) => {
      const hint = featureHint(feature);
      return {
        value: feature,
        label: featureLabel(feature),
        ...(hint ? { hint } : {}),
      };
    }),
    initialValues: optional.filter(isRecommendedFeature),
    required: false,
  });

  const chosen = abortIfCancelled(selected);
  return { features: prependRequiredFeature(chosen, hasRequired) };
}

async function handleConfirm(
  payload: ConfirmPayload,
  options: InteractiveContext,
  ui: WizardUI
): Promise<Record<string, unknown>> {
  if (options.yes) {
    ui.log.info("Auto-confirmed: continuing");
    return { action: "continue" };
  }

  const confirmed = await ui.confirm({
    message: payload.prompt,
    initialValue: true,
  });

  const value = abortIfCancelled(confirmed);
  return { action: value ? "continue" : "stop" };
}
