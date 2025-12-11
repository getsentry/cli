import { buildCommand } from "@stricli/core";
import type { SryContext } from "../../context.js";
import { getIssue, getLatestEvent } from "../../lib/api-client.js";
import type { SentryEvent, SentryIssue } from "../../types/index.js";

type GetFlags = {
  readonly json: boolean;
  readonly event: boolean;
};

function formatIssueDetails(issue: SentryIssue): string {
  const lines: string[] = [];

  // Header
  lines.push(`${issue.shortId}: ${issue.title}`);
  lines.push(
    "═".repeat(Math.min(80, issue.title.length + issue.shortId.length + 2))
  );
  lines.push("");

  // Status and level
  const statusIcon =
    issue.status === "resolved"
      ? "✓ Resolved"
      : issue.status === "ignored"
        ? "− Ignored"
        : "● Unresolved";
  lines.push(`Status:     ${statusIcon}`);
  lines.push(`Level:      ${issue.level}`);
  lines.push(`Platform:   ${issue.platform}`);
  lines.push(`Type:       ${issue.type}`);
  lines.push("");

  // Project
  lines.push(`Project:    ${issue.project.name} (${issue.project.slug})`);
  lines.push("");

  // Stats
  lines.push(`Events:     ${issue.count}`);
  lines.push(`Users:      ${issue.userCount}`);
  lines.push(`First seen: ${new Date(issue.firstSeen).toLocaleString()}`);
  lines.push(`Last seen:  ${new Date(issue.lastSeen).toLocaleString()}`);
  lines.push("");

  // Culprit
  if (issue.culprit) {
    lines.push(`Culprit:    ${issue.culprit}`);
    lines.push("");
  }

  // Metadata
  if (issue.metadata.value) {
    lines.push("Message:");
    lines.push(`  ${issue.metadata.value}`);
    lines.push("");
  }

  if (issue.metadata.filename) {
    lines.push(`File:       ${issue.metadata.filename}`);
  }
  if (issue.metadata.function) {
    lines.push(`Function:   ${issue.metadata.function}`);
  }

  // Assignee
  if (issue.assignedTo) {
    lines.push("");
    lines.push(`Assigned:   ${issue.assignedTo.name}`);
  }

  // Link
  lines.push("");
  lines.push(`Link:       ${issue.permalink}`);

  return lines.join("\n");
}

function formatEventDetails(event: SentryEvent): string {
  const lines: string[] = [];

  lines.push("\n─── Latest Event ───");
  lines.push("");
  lines.push(`Event ID:   ${event.eventID}`);
  lines.push(`Received:   ${new Date(event.dateReceived).toLocaleString()}`);

  if (event.user) {
    lines.push("");
    lines.push("User:");
    if (event.user.email) {
      lines.push(`  Email:    ${event.user.email}`);
    }
    if (event.user.username) {
      lines.push(`  Username: ${event.user.username}`);
    }
    if (event.user.id) {
      lines.push(`  ID:       ${event.user.id}`);
    }
    if (event.user.ip_address) {
      lines.push(`  IP:       ${event.user.ip_address}`);
    }
  }

  if (event.sdk) {
    lines.push("");
    lines.push(`SDK:        ${event.sdk.name} ${event.sdk.version}`);
  }

  if (event.tags.length > 0) {
    lines.push("");
    lines.push("Tags:");
    for (const tag of event.tags.slice(0, 10)) {
      lines.push(`  ${tag.key}: ${tag.value}`);
    }
    if (event.tags.length > 10) {
      lines.push(`  ... and ${event.tags.length - 10} more`);
    }
  }

  return lines.join("\n");
}

export const getCommand = buildCommand({
  docs: {
    brief: "Get details of a specific issue",
    fullDescription:
      "Retrieve detailed information about a Sentry issue by its ID or short ID. " +
      "Use --event to also fetch the latest event details.",
  },
  parameters: {
    positional: {
      kind: "tuple",
      parameters: [
        {
          brief: "Issue ID or short ID (e.g., JAVASCRIPT-ABC or 123456)",
          parse: String,
        },
      ],
    },
    flags: {
      json: {
        kind: "boolean",
        brief: "Output as JSON",
        default: false,
      },
      event: {
        kind: "boolean",
        brief: "Also fetch the latest event",
        default: false,
      },
    },
  },
  async func(
    this: SryContext,
    flags: GetFlags,
    issueId: string
  ): Promise<void> {
    const { process } = this;

    try {
      const issue = await getIssue(issueId);

      let event: SentryEvent | undefined;
      if (flags.event) {
        try {
          event = await getLatestEvent(issueId);
        } catch {
          // Event fetch might fail, continue without it
        }
      }

      if (flags.json) {
        const output = event ? { issue, event } : { issue };
        process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
        return;
      }

      process.stdout.write(`${formatIssueDetails(issue)}\n`);

      if (event) {
        process.stdout.write(`${formatEventDetails(event)}\n`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`Error fetching issue: ${message}\n`);
      process.exitCode = 1;
    }
  },
});
