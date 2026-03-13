/**
 * sentry trial list
 *
 * List product trials available to an organization, including
 * active trials with time remaining and expired trials.
 */

import type { SentryContext } from "../../context.js";
import { getProductTrials } from "../../lib/api-client.js";
import { buildCommand } from "../../lib/command.js";
import { ContextError } from "../../lib/errors.js";
import { colorTag } from "../../lib/formatters/markdown.js";
import { type Column, writeTable } from "../../lib/formatters/table.js";
import { resolveOrg } from "../../lib/resolve-target.js";
import {
  getDaysRemaining,
  getTrialDisplayName,
  getTrialFriendlyName,
  getTrialStatus,
  type TrialStatus,
} from "../../lib/trials.js";
import type { Writer } from "../../types/index.js";

type ListFlags = {
  readonly json: boolean;
  readonly fields?: string[];
};

/**
 * Enriched trial entry for display.
 * Adds derived fields (name, displayName, status, daysRemaining) to the raw API data.
 */
type TrialListEntry = {
  /** CLI-friendly name (e.g., "seer") */
  name: string;
  /** Human-readable product name (e.g., "Seer") */
  displayName: string;
  /** API category name (e.g., "seerUsers") */
  category: string;
  /** Derived status */
  status: TrialStatus;
  /** Days remaining for active trials, null otherwise */
  daysRemaining: number | null;
  /** Raw isStarted flag from API */
  isStarted: boolean;
  /** Trial length in days, null if not set */
  lengthDays: number | null;
  /** ISO date string when trial started, null if not started */
  startDate: string | null;
  /** ISO date string when trial ends, null if not started */
  endDate: string | null;
};

/** Status display labels with color indicators */
const STATUS_LABELS: Record<TrialStatus, string> = {
  available: `${colorTag("cyan", "○")} Available`,
  active: `${colorTag("green", "●")} Active`,
  expired: `${colorTag("muted", "−")} Expired`,
};

/**
 * Format trial list as a human-readable table.
 */
function formatTrialListHuman(entries: TrialListEntry[]): string {
  if (entries.length === 0) {
    return "No product trials found for this organization.";
  }

  const columns: Column<TrialListEntry>[] = [
    { header: "NAME", value: (t) => t.name },
    { header: "PRODUCT", value: (t) => t.displayName },
    { header: "STATUS", value: (t) => STATUS_LABELS[t.status] ?? t.status },
    {
      header: "DAYS LEFT",
      value: (t) => {
        if (t.status === "active" && t.daysRemaining !== null) {
          return t.daysRemaining === 0
            ? colorTag("yellow", "<1")
            : String(t.daysRemaining);
        }
        return colorTag("muted", "—");
      },
      align: "right",
    },
    {
      header: "CATEGORY",
      value: (t) => colorTag("muted", t.category),
    },
  ];

  const parts: string[] = [];
  const buffer: Writer = { write: (s) => parts.push(s) };
  writeTable(buffer, entries, columns);
  return parts.join("").trimEnd();
}

export const listCommand = buildCommand({
  docs: {
    brief: "List product trials",
    fullDescription:
      "List product trials for an organization, including available,\n" +
      "active, and expired trials.\n\n" +
      "Examples:\n" +
      "  sentry trial list\n" +
      "  sentry trial list my-org\n" +
      "  sentry trial list --json",
  },
  output: {
    json: true,
    human: formatTrialListHuman,
    jsonExclude: ["displayName"],
  },
  parameters: {
    positional: {
      kind: "tuple" as const,
      parameters: [
        {
          placeholder: "org",
          brief: "Organization slug (auto-detected if omitted)",
          parse: String,
          optional: true as const,
        },
      ],
    },
  },
  async func(this: SentryContext, _flags: ListFlags, org?: string) {
    const resolved = await resolveOrg({
      org,
      cwd: this.cwd,
    });

    if (!resolved) {
      throw new ContextError("Organization", "sentry trial list", [
        "sentry trial list <org>",
      ]);
    }

    const trials = await getProductTrials(resolved.org);

    const entries: TrialListEntry[] = trials.map((t) => ({
      name: getTrialFriendlyName(t.category),
      displayName: getTrialDisplayName(t.category),
      category: t.category,
      status: getTrialStatus(t),
      daysRemaining: getDaysRemaining(t),
      isStarted: t.isStarted,
      lengthDays: t.lengthDays,
      startDate: t.startDate,
      endDate: t.endDate,
    }));

    const hints: string[] = [];
    const hasAvailable = entries.some((e) => e.status === "available");
    if (hasAvailable) {
      hints.push("Tip: Use 'sentry trial start <name>' to start a trial");
    }

    return { data: entries, hint: hints.join("\n") || undefined };
  },
});
