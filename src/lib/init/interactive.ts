/**
 * Interactive Dispatcher
 *
 * Handles `prompt_request` actions from the workflow.
 * Supports select, multi-select, and confirm prompts. Respects --yes.
 */

import { confirm, log, multiselect, select } from "@clack/prompts";
import chalk from "chalk";
import { abortIfCancelled } from "./clack-utils.js";
import { REQUIRED_FEATURE } from "./constants.js";
import { FEATURE_LABELS, sortFeatures } from "./select-features.js";
import type {
  ConfirmPayload,
  InteractiveContext,
  InteractivePayload,
  MultiSelectPayload,
  SelectPayload,
} from "./types.js";

export async function handleInteractive(
  payload: InteractivePayload,
  options: InteractiveContext
): Promise<Record<string, unknown>> {
  switch (payload.kind) {
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
  payload: SelectPayload,
  options: InteractiveContext
): Promise<Record<string, unknown>> {
  const apps = payload.apps ?? [];
  const items = payload.options ?? apps.map((a) => a.name);

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
    options: items.map((item, i) => ({
      value: item,
      label: item,
      hint: apps[i]?.framework ?? undefined,
    })),
  });

  return { selectedApp: abortIfCancelled(selected) };
}

function featureLabel(id: string): string {
  return FEATURE_LABELS[id]?.label ?? id;
}

function featureHint(id: string): string | undefined {
  return FEATURE_LABELS[id]?.hint;
}

async function handleMultiSelect(
  payload: MultiSelectPayload,
  options: InteractiveContext
): Promise<Record<string, unknown>> {
  const available = payload.availableFeatures ?? payload.options ?? [];

  if (available.length === 0) {
    return { features: [] };
  }

  const hasRequired = available.includes(REQUIRED_FEATURE);
  // The agent calls this prompt as `propose-features` after analysing the
  // project + docs. The IDs in `available` are exactly what the agent
  // proposed (errorMonitoring is excluded by the tool's contract). We
  // treat any other multi-select that happens to include errorMonitoring
  // the same way.

  if (options.yes) {
    log.info(
      `Auto-selected all features: ${available.map(featureLabel).join(", ")}`
    );
    return { features: available };
  }

  const optional = sortFeatures(available.filter((f) => f !== REQUIRED_FEATURE));

  if (optional.length === 0) {
    if (hasRequired) {
      log.info("Error monitoring is always included.");
    }
    return { features: hasRequired ? [REQUIRED_FEATURE] : [] };
  }

  const bar = chalk.gray("\u2502");
  const hints: string[] = [];
  if (hasRequired) {
    hints.push(`${bar}  ${chalk.dim("Error monitoring is always included")}`);
  }
  hints.push(`${bar}  ${chalk.dim("space=toggle, a=all, enter=confirm")}`);

  // Show the agent's prompt body verbatim — it already contains the
  // "Why these features are relevant: …" reasons block built by the
  // sandboxed `propose_features` tool.
  const selected = await multiselect({
    message: `${payload.prompt}\n${hints.join("\n")}`,
    options: optional.map((feature) => ({
      value: feature,
      label: featureLabel(feature),
      hint: featureHint(feature),
    })),
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
  options: InteractiveContext
): Promise<Record<string, unknown>> {
  if (options.yes) {
    log.info("Auto-confirmed: continuing");
    return { action: "continue" };
  }

  const confirmed = await confirm({
    message: payload.prompt,
    initialValue: true,
  });

  const value = abortIfCancelled(confirmed);
  return { action: value ? "continue" : "stop" };
}
