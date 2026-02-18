/**
 * Interactive Dispatcher
 *
 * Handles interactive prompts from the remote workflow.
 * Supports select, multi-select, and confirm prompts.
 * Respects --yes flag for non-interactive mode.
 */

import { confirm, log, multiselect, select } from "@clack/prompts";
import { abortIfCancelled } from "./clack-utils.js";
import type { InteractivePayload, WizardOptions } from "./types.js";

export async function handleInteractive(
  payload: InteractivePayload,
  options: WizardOptions
): Promise<Record<string, unknown>> {
  const { kind } = payload;

  switch (kind) {
    case "select":
      return await handleSelect(payload, options);
    case "multi-select":
      return await handleMultiSelect(payload, options);
    case "confirm":
      return await handleConfirm(payload, options);
    default:
      return { cancelled: true };
  }
}

async function handleSelect(
  payload: InteractivePayload,
  options: WizardOptions
): Promise<Record<string, unknown>> {
  const apps =
    (payload.apps as Array<{
      name: string;
      path: string;
      framework?: string;
    }>) ?? [];
  const items = (payload.options as string[]) ?? apps.map((a) => a.name);

  if (items.length === 0) {
    return { cancelled: true };
  }

  if (options.yes) {
    if (items.length === 1) {
      log.info(`Auto-selected: ${items[0]}`);
      return { selectedApp: items[0] };
    }
    log.error(
      `--yes requires exactly one option for selection, but found ${items.length}. Run interactively to choose.`
    );
    return { cancelled: true };
  }

  const selected = await select({
    message: payload.prompt,
    options: items.map((item, i) => {
      const app = apps[i];
      return {
        value: item,
        label: item,
        hint: app?.framework ?? undefined,
      };
    }),
  });

  return { selectedApp: abortIfCancelled(selected) };
}

async function handleMultiSelect(
  payload: InteractivePayload,
  options: WizardOptions
): Promise<Record<string, unknown>> {
  const available =
    (payload.availableFeatures as string[]) ??
    (payload.options as string[]) ??
    [];

  if (available.length === 0) {
    return { features: [] };
  }

  const requiredFeature = "errors";
  const hasRequired = available.includes(requiredFeature);

  if (options.yes) {
    log.info(`Auto-selected all features: ${available.join(", ")}`);
    return { features: available };
  }

  if (hasRequired) {
    log.info("Error monitoring is always enabled.");
  }

  const optional = available.filter((f) => f !== requiredFeature);

  const selected = await multiselect({
    message: payload.prompt,
    options: optional.map((feature) => ({
      value: feature,
      label: feature,
    })),
    initialValues: optional,
    required: false,
  });

  const chosen = abortIfCancelled(selected);
  if (hasRequired && !chosen.includes(requiredFeature)) {
    chosen.unshift(requiredFeature);
  }

  return { features: chosen };
}

async function handleConfirm(
  payload: InteractivePayload,
  options: WizardOptions
): Promise<Record<string, unknown>> {
  if (options.yes) {
    if (payload.prompt.includes("example")) {
      log.info("Auto-confirmed: adding example trigger");
      return { addExample: true };
    }
    log.info("Auto-confirmed: continuing");
    return { action: "continue" };
  }

  const confirmed = await confirm({
    message: payload.prompt,
    initialValue: true,
  });

  const value = abortIfCancelled(confirmed);

  if (payload.prompt.includes("example")) {
    return { addExample: value };
  }
  return { action: value ? "continue" : "stop" };
}
