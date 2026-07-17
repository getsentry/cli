/**
 * Human-readable formatting for modern Sentry User Feedback.
 */

import type { EventAttachmentDetailsResponse } from "@sentry/api";
import wrapAnsi from "wrap-ansi";
import type {
  FeedbackListResult,
  FeedbackViewResult,
  SentryEvent,
  SentryFeedback,
} from "../../types/index.js";
import { getReplayIdFromEvent } from "../replay-search.js";
import { formatEventDetails } from "./human.js";
import {
  colorTag,
  escapeMarkdownCell,
  escapeMarkdownInline,
  mdKvTable,
  renderMarkdown,
  safeCodeSpan,
} from "./markdown.js";
import { formatBytes } from "./numbers.js";
import { type Column, formatTable } from "./table.js";
import { formatRelativeTime } from "./time-utils.js";

const MAX_REPLAY_IDS_SHOWN = 3;
const MAX_LIST_MESSAGE_LENGTH = 160;
const COMPACT_LIST_BREAKPOINT = 100;
const LINE_BREAK_RE = /\r?\n/;

function feedbackSender(feedback: SentryFeedback): string {
  const name = feedback.metadata.name?.trim();
  const email = feedback.metadata.contact_email?.trim();
  if (name && email && name !== email) {
    return `${name} <${email}>`;
  }
  return name || email || "Anonymous User";
}

function feedbackMessage(feedback: SentryFeedback): string {
  return (
    feedback.metadata.message ||
    feedback.metadata.value ||
    feedback.metadata.title ||
    feedback.title
  );
}

function feedbackMessagePreview(feedback: SentryFeedback): string {
  const message = feedbackMessage(feedback).replace(LINE_BREAK_RE, " ");
  return message.length > MAX_LIST_MESSAGE_LENGTH
    ? `${message.slice(0, MAX_LIST_MESSAGE_LENGTH - 1)}…`
    : message;
}

function feedbackStatus(feedback: SentryFeedback): string {
  switch (feedback.status) {
    case "ignored":
      return colorTag("muted", "Spam");
    case "resolved":
      return colorTag("green", "Resolved");
    case "unresolved":
      return colorTag("yellow", "Unresolved");
    default:
      return escapeMarkdownInline(feedback.status ?? "Unknown");
  }
}

function feedbackReadState(feedback: SentryFeedback): string {
  if (feedback.hasSeen === undefined) {
    return colorTag("muted", "Unknown");
  }
  return feedback.hasSeen
    ? colorTag("muted", "Read")
    : colorTag("blue", "Unread");
}

const FEEDBACK_COLUMNS: Column<SentryFeedback>[] = [
  {
    header: "ID",
    value: (feedback) =>
      feedback.permalink
        ? `[${feedback.shortId}](${feedback.permalink})`
        : safeCodeSpan(feedback.shortId),
    minWidth: 8,
    shrinkable: false,
  },
  {
    header: "RECEIVED",
    value: (feedback) => formatRelativeTime(feedback.firstSeen ?? undefined),
    minWidth: 10,
  },
  {
    header: "FROM",
    value: (feedback) => escapeMarkdownCell(feedbackSender(feedback)),
    minWidth: 12,
    truncate: true,
  },
  {
    header: "MESSAGE",
    value: (feedback) => escapeMarkdownCell(feedbackMessage(feedback)),
    minWidth: 16,
    truncate: true,
  },
  {
    header: "STATUS",
    value: feedbackStatus,
    minWidth: 8,
    shrinkable: false,
  },
  {
    header: "READ",
    value: feedbackReadState,
    minWidth: 6,
    shrinkable: false,
  },
  {
    header: "PROJECT",
    value: (feedback) =>
      escapeMarkdownCell(feedback.project?.slug ?? "unknown"),
    minWidth: 7,
  },
];

function formatCompactFeedbackList(
  result: FeedbackListResult,
  scope: string,
  width: number
): string {
  const sections = result.feedback.map((feedback) => {
    const id = feedback.permalink
      ? `[${escapeMarkdownInline(feedback.shortId)}](${feedback.permalink})`
      : safeCodeSpan(feedback.shortId);
    return [
      `### ${id}`,
      "",
      `- **Received:** ${formatRelativeTime(feedback.firstSeen ?? undefined)}`,
      `- **From:** ${escapeMarkdownInline(feedbackSender(feedback))}`,
      `- **Message:** ${escapeMarkdownInline(feedbackMessagePreview(feedback))}`,
      `- **Status:** ${feedbackStatus(feedback)}`,
      `- **Read:** ${feedbackReadState(feedback)}`,
      `- **Project:** ${escapeMarkdownInline(feedback.project?.slug ?? "unknown")}`,
    ].join("\n");
  });
  const markdown = [
    `## Feedback in ${escapeMarkdownInline(scope)}`,
    "",
    ...sections,
  ].join("\n\n");
  return wrapAnsi(renderMarkdown(markdown), width, {
    hard: true,
    trim: false,
    wordWrap: true,
  });
}

/** Format a page of Feedback as a terminal-width-aware table. */
export function formatFeedbackList(result: FeedbackListResult): string {
  if (result.feedback.length === 0) {
    return result.hasMore ? "No feedback on this page." : "No feedback found.";
  }

  const scope = result.project
    ? `${result.org}/${result.project}`
    : `${result.org} (all projects)`;
  const terminalWidth = process.stdout.columns || 80;
  if (terminalWidth < COMPACT_LIST_BREAKPOINT) {
    return formatCompactFeedbackList(result, scope, terminalWidth);
  }
  return `Feedback in ${scope}:\n\n${formatTable(result.feedback, FEEDBACK_COLUMNS, { truncate: true })}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function feedbackContext(
  event: SentryEvent | null
): Record<string, unknown> | undefined {
  const context = event?.contexts?.feedback;
  return isRecord(context) ? context : undefined;
}

function feedbackUrl(event: SentryEvent | null): string | undefined {
  const contextUrl = feedbackContext(event)?.url;
  if (typeof contextUrl === "string" && contextUrl) {
    return contextUrl;
  }
  return event?.tags?.find((tag) => tag.key === "url")?.value;
}

function linkedEventId(data: FeedbackViewResult): string | undefined {
  const contextId = feedbackContext(data.event)?.associated_event_id;
  if (typeof contextId === "string" && contextId) {
    return contextId;
  }
  const metadataId = data.feedback.metadata.associated_event_id;
  return typeof metadataId === "string" && metadataId ? metadataId : undefined;
}

function formatFeedbackOverview(data: FeedbackViewResult): string {
  const { feedback } = data;
  const rows: [string, string][] = [
    ["Status", feedbackStatus(feedback)],
    ["Read", feedbackReadState(feedback)],
    ["From", escapeMarkdownInline(feedbackSender(feedback))],
    ["Received", formatRelativeTime(feedback.firstSeen ?? undefined)],
  ];

  if (feedback.project) {
    rows.push([
      "Project",
      `${escapeMarkdownInline(feedback.project.name ?? feedback.project.slug)} (${safeCodeSpan(feedback.project.slug)})`,
    ]);
  }
  if (feedback.assignedTo?.name) {
    rows.push(["Assignee", escapeMarkdownInline(feedback.assignedTo.name)]);
  }
  if (feedback.metadata.source) {
    rows.push(["Source", safeCodeSpan(feedback.metadata.source)]);
  }
  if (feedback.metadata.sdk?.name) {
    rows.push([
      "SDK",
      safeCodeSpan(
        feedback.metadata.sdk.name_normalized ?? feedback.metadata.sdk.name
      ),
    ]);
  }

  const url = feedbackUrl(data.event);
  if (url) {
    rows.push(["URL", safeCodeSpan(url)]);
  }

  const associatedEventId = linkedEventId(data);
  if (associatedEventId) {
    const project = feedback.project?.slug;
    const command =
      data.org && project
        ? `sentry event view ${data.org}/${project}/${associatedEventId}`
        : `sentry event view ${associatedEventId}`;
    rows.push(["Linked error", safeCodeSpan(command)]);
  }

  if (feedback.permalink) {
    rows.push(["Sentry", `[Open feedback](${feedback.permalink})`]);
  }

  const lines = [
    `## ${escapeMarkdownInline(feedback.shortId)}: User Feedback`,
    "",
    mdKvTable(rows),
    "",
    "### Message",
    "",
    ...feedbackMessage(feedback)
      .split(LINE_BREAK_RE)
      .map((line) => `> ${escapeMarkdownInline(line)}`),
  ];

  if (feedback.metadata.summary) {
    lines.push(
      "",
      "### Summary",
      "",
      escapeMarkdownInline(feedback.metadata.summary)
    );
  }

  return renderMarkdown(lines.join("\n"));
}

function formatRelatedReplays(data: FeedbackViewResult): string {
  const eventReplayId = data.event
    ? getReplayIdFromEvent(data.event)
    : undefined;
  const additionalIds = eventReplayId
    ? data.replayIds.filter((replayId) => replayId !== eventReplayId)
    : data.replayIds;
  if (additionalIds.length === 0) {
    return "";
  }

  const lines = ["### Additional Replays", ""];
  for (const replayId of additionalIds.slice(0, MAX_REPLAY_IDS_SHOWN)) {
    const command = data.org
      ? `sentry replay view ${data.org}/${replayId}`
      : `sentry replay view ${replayId}`;
    lines.push(`- ${safeCodeSpan(replayId)} (${safeCodeSpan(command)})`);
  }
  const remaining = additionalIds.length - MAX_REPLAY_IDS_SHOWN;
  if (remaining > 0) {
    lines.push(`- ${remaining} more`);
  }
  return renderMarkdown(lines.join("\n"));
}

function formatAttachment(attachment: EventAttachmentDetailsResponse): string {
  const details = [attachment.mimetype, formatBytes(attachment.size)]
    .filter(Boolean)
    .join(", ");
  return `- ${escapeMarkdownInline(attachment.name)}${details ? ` (${escapeMarkdownInline(details)})` : ""} — ${safeCodeSpan(attachment.id)}`;
}

function formatAttachments(
  attachments: EventAttachmentDetailsResponse[]
): string {
  if (attachments.length === 0) {
    return "";
  }
  return renderMarkdown(
    ["### Attachments", "", ...attachments.map(formatAttachment)].join("\n")
  );
}

/** Format a Feedback item plus its best-effort event enrichments. */
export function formatFeedbackView(data: FeedbackViewResult): string {
  const sections = [formatFeedbackOverview(data)];
  if (data.event) {
    sections.push(
      formatEventDetails(
        data.event,
        "Latest Feedback Event",
        data.feedback.permalink
      )
    );
  }
  const replays = formatRelatedReplays(data);
  if (replays) {
    sections.push(replays);
  }
  const attachments = formatAttachments(data.attachments);
  if (attachments) {
    sections.push(attachments);
  }
  return sections.join("\n\n");
}
