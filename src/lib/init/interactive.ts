/**
 * Interactive Dispatcher
 *
 * Handles interactive prompts from the remote workflow.
 * Supports select, multi-select, and confirm prompts.
 * Respects --yes flag for non-interactive mode.
 *
 * All UI I/O goes through the injected `WizardUI` so the dispatcher
 * works identically against `ClackUI` (interactive), `LoggingUI` (CI),
 * and the upcoming OpenTUI implementation.
 */

import chalk from "chalk";
import { confirm, log, multiselect, select } from "./clack-plain.js";
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
import type { WizardUI } from "./ui/types.js";

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
    initialValues: optional.filter((f) => f === "performanceMonitoring"),
    required: false,
  });

  const chosen = abortIfCancelled(selected);
  if (hasRequired && !chosen.includes(REQUIRED_FEATURE)) {
    chosen.unshift(REQUIRED_FEATURE);
  }

  return { features: chosen };
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
