/**
 * sentry trial start
 *
 * Start a product trial for an organization.
 * Supports swap detection: `sentry trial start my-org seer` works
 * the same as `sentry trial start seer my-org`.
 */

import type { SentryContext } from "../../context.js";
import { getProductTrials, startProductTrial } from "../../lib/api-client.js";
import { detectSwappedTrialArgs } from "../../lib/arg-parsing.js";
import { buildCommand } from "../../lib/command.js";
import { ContextError, ValidationError } from "../../lib/errors.js";
import { success } from "../../lib/formatters/colors.js";
import { logger } from "../../lib/logger.js";
import { resolveOrg } from "../../lib/resolve-target.js";
import {
  findAvailableTrial,
  getDisplayNameForTrialName,
  getTrialDisplayName,
  getValidTrialNames,
  isTrialName,
} from "../../lib/trials.js";

const VALID_NAMES = getValidTrialNames();
const NAMES_LIST = VALID_NAMES.join(", ");

/**
 * Parse the positional args for `trial start`, handling swapped order.
 *
 * Expected: `<name> [org]`
 * Also accepted: `<org> <name>` (detected and auto-corrected)
 *
 * @returns Parsed name and optional org, plus any warning message
 */
function parseTrialStartArgs(
  first: string,
  second?: string
): { name: string; org?: string; warning?: string } {
  if (!second) {
    // Single arg — must be a trial name
    return { name: first };
  }

  // Two args — check for swapped order
  const swapped = detectSwappedTrialArgs(first, second, isTrialName);
  if (swapped) {
    return { name: swapped.name, org: swapped.org, warning: swapped.warning };
  }

  // Normal order: first=name, second=org
  return { name: first, org: second };
}

export const startCommand = buildCommand({
  docs: {
    brief: "Start a product trial",
    fullDescription:
      "Start a product trial for an organization.\n\n" +
      `Valid trial names: ${NAMES_LIST}\n\n` +
      "Examples:\n" +
      "  sentry trial start seer\n" +
      "  sentry trial start seer my-org\n" +
      "  sentry trial start replays\n" +
      "  sentry trial start --json seer",
  },
  output: { json: true, human: formatStartResult },
  parameters: {
    positional: {
      kind: "tuple" as const,
      parameters: [
        {
          placeholder: "name",
          brief: `Trial name (${NAMES_LIST})`,
          parse: String,
        },
        {
          placeholder: "org",
          brief: "Organization slug (auto-detected if omitted)",
          parse: String,
          optional: true as const,
        },
      ],
    },
  },
  async func(
    this: SentryContext,
    _flags: unknown,
    first: string,
    second?: string
  ) {
    const log = logger.withTag("trial");
    const parsed = parseTrialStartArgs(first, second);

    if (parsed.warning) {
      log.warn(parsed.warning);
    }

    // Validate trial name
    if (!isTrialName(parsed.name)) {
      throw new ValidationError(
        `Unknown trial name: '${parsed.name}'. Valid names: ${NAMES_LIST}`,
        "name"
      );
    }

    // Resolve organization
    const resolved = await resolveOrg({
      org: parsed.org,
      cwd: this.cwd,
    });

    if (!resolved) {
      throw new ContextError("Organization", "sentry trial start", [
        "sentry trial start <name> <org>",
      ]);
    }

    const orgSlug = resolved.org;

    // Fetch trials and find an available one
    const trials = await getProductTrials(orgSlug);
    const trial = findAvailableTrial(trials, parsed.name);

    if (!trial) {
      const displayName = getDisplayNameForTrialName(parsed.name);
      throw new ValidationError(
        `No ${displayName} trial available for organization '${orgSlug}'.`,
        "name"
      );
    }

    // Start the trial
    await startProductTrial(orgSlug, trial.category);

    return {
      data: {
        name: parsed.name,
        category: trial.category,
        organization: orgSlug,
        lengthDays: trial.lengthDays,
        started: true,
      },
      hint: undefined,
    };
  },
});

/** Format start result as human-readable output */
function formatStartResult(data: {
  name: string;
  category: string;
  organization: string;
  lengthDays: number | null;
  started: boolean;
}): string {
  const displayName = getTrialDisplayName(data.category);
  const daysText = data.lengthDays ? ` (${data.lengthDays} days)` : "";
  return `${success("✓")} ${displayName} trial started for ${data.organization}!${daysText}`;
}
