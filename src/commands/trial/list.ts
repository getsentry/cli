/**
 * sentry trial list
 *
 * List product trials available to an organization, including
 * active trials with time remaining, expired trials, and
 * plan-level upgrade trials.
 */

import type { SentryContext } from "../../context.js";
import { getCustomerTrialInfo } from "../../lib/api-client.js";
import { buildCommand } from "../../lib/command.js";
import { ContextError } from "../../lib/errors.js";
import { colorTag } from "../../lib/formatters/markdown.js";
import { type Column, writeTable } from "../../lib/formatters/table.js";
import { resolveOrg } from "../../lib/resolve-target.js";
import { buildBillingUrl } from "../../lib/sentry-urls.js";
import {
  getDaysRemaining,
  getTrialDisplayName,
  getTrialFriendlyName,
  getTrialStatus,
  type TrialStatus,
} from "../../lib/trials.js";
import type { CustomerTrialInfo, Writer } from "../../types/index.js";

type ListFlags = {
  readonly json: boolean;
  readonly fields?: string[];
};

/**
 * Enriched trial entry for display.
 * Adds derived fields (name, displayName, status, daysRemaining) to the raw API data.
 */
type TrialListEntry = {
  /** CLI-friendly name (e.g., "seer") or "plan" for plan-level trials */
  name: string;
  /** Human-readable product name (e.g., "Seer") or plan upgrade name */
  displayName: string;
  /** API category name (e.g., "seerUsers"), or "plan" for plan-level trials */
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
 * Build a synthetic trial entry for a plan-level trial.
 *
 * The Sentry billing API exposes plan-level trials (e.g., "Try Business")
 * separately from product trials. This creates a unified entry so both
 * appear in the same list.
 *
 * @param info - Customer trial info from the API
 * @returns A TrialListEntry for the plan trial, or null if not applicable
 */
function buildPlanTrialEntry(info: CustomerTrialInfo): TrialListEntry | null {
  if (info.isTrial) {
    // Currently on a plan trial
    const planName = info.planDetails?.name ?? "Business";
    const endDate = info.trialEnd ?? null;
    let daysRemaining: number | null = null;
    if (endDate) {
      const end = new Date(endDate);
      end.setUTCHours(23, 59, 59, 999);
      const diffMs = end.getTime() - Date.now();
      daysRemaining = Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
    }
    return {
      name: "plan",
      displayName: `${planName} Plan`,
      category: "plan",
      status: "active",
      daysRemaining,
      isStarted: true,
      lengthDays: null,
      startDate: null,
      endDate,
    };
  }

  if (info.canTrial) {
    // Plan trial available but not started
    const currentPlan = info.planDetails?.name ?? "current plan";
    return {
      name: "plan",
      displayName: `${currentPlan} → Business`,
      category: "plan",
      status: "available",
      daysRemaining: null,
      isStarted: false,
      lengthDays: null,
      startDate: null,
      endDate: null,
    };
  }

  return null;
}

/**
 * Format trial list as a human-readable table.
 */
function formatTrialListHuman(entries: TrialListEntry[]): string {
  if (entries.length === 0) {
    return "No trials found for this organization.";
  }

  const columns: Column<TrialListEntry>[] = [
    {
      header: "TRIAL",
      value: (t) =>
        // Show CLI name in parentheses for product trials so users know
        // the argument for `sentry trial start <name>`
        t.name !== t.displayName && t.category !== "plan"
          ? `${t.displayName} ${colorTag("muted", `(${t.name})`)}`
          : t.displayName,
    },
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

    const info = await getCustomerTrialInfo(resolved.org);
    const productTrials = info.productTrials ?? [];

    const entries: TrialListEntry[] = productTrials.map((t) => ({
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

    // Add plan-level trial entry (available or active) at the top
    const planEntry = buildPlanTrialEntry(info);
    if (planEntry) {
      entries.unshift(planEntry);
    }

    const hints: string[] = [];
    const hasAvailableProduct = entries.some(
      (e) => e.status === "available" && e.category !== "plan"
    );
    if (hasAvailableProduct) {
      hints.push("Tip: Use 'sentry trial start <name>' to start a trial");
    }
    if (planEntry?.status === "available") {
      hints.push(
        `Tip: Start a free Business plan trial at ${buildBillingUrl(resolved.org)}`
      );
    }

    return { data: entries, hint: hints.join("\n") || undefined };
  },
});
