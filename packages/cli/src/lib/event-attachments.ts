/**
 * Event attachment helpers for `sentry event view`.
 *
 * Listing uses {@link listEventAttachments}; download stays on
 * `sentry api ".../?download=1"` so JSON never carries file bytes.
 */

import type { EventAttachmentDetailsResponse } from "@sentry/api";
import type { SentryEvent } from "../types/index.js";
import { listEventAttachments } from "./api-client.js";
import {
  escapeMarkdownInline,
  renderMarkdown,
  safeCodeSpan,
} from "./formatters/markdown.js";
import { formatBytes } from "./formatters/numbers.js";
import { logger } from "./logger.js";

const log = logger.withTag("event.view");

type EventWithOptionalProject = SentryEvent & {
  project?: string | { slug?: string | null } | null;
  projectSlug?: string | null;
};

/**
 * Best-effort project slug from an event payload.
 *
 * Event detail usually only has numeric `projectID`. Some responses also
 * include `projectSlug` or a nested `project` object/string.
 */
export function eventProjectSlug(event: SentryEvent): string | undefined {
  const { project, projectSlug } = event as EventWithOptionalProject;
  if (typeof projectSlug === "string" && projectSlug.length > 0) {
    return projectSlug;
  }
  if (typeof project === "string" && project.length > 0) {
    return project;
  }
  if (project && typeof project === "object") {
    const slug = project.slug;
    if (typeof slug === "string" && slug.length > 0) {
      return slug;
    }
  }
  return;
}

/**
 * List attachments for an event. Returns `[]` when project is missing or
 * the request fails — viewing the event must not fail because of this.
 */
export async function tryListEventAttachments(
  orgSlug: string,
  projectSlug: string | undefined,
  eventId: string
): Promise<EventAttachmentDetailsResponse[]> {
  if (!projectSlug) {
    return [];
  }
  try {
    return await listEventAttachments(orgSlug, projectSlug, eventId);
  } catch (error) {
    log.debug("Failed to fetch attachments for event", error);
    return [];
  }
}

/**
 * Relative API path for `sentry api` to download attachment bytes.
 */
export function attachmentDownloadPath(
  org: string,
  project: string,
  eventId: string,
  attachmentId: string
): string {
  return `projects/${org}/${project}/events/${eventId}/attachments/${attachmentId}/?download=1`;
}

/**
 * JSON attachment objects plus a `download` path agents can pass to
 * `sentry api`.
 */
export function jsonEventAttachments(
  org: string | undefined,
  project: string | undefined,
  eventId: string,
  attachments: EventAttachmentDetailsResponse[]
): Array<EventAttachmentDetailsResponse & { download?: string }> {
  if (!(org && project)) {
    return attachments.map((attachment) => ({ ...attachment }));
  }
  return attachments.map((attachment) => ({
    ...attachment,
    download: attachmentDownloadPath(org, project, eventId, attachment.id),
  }));
}

function formatAttachment(attachment: EventAttachmentDetailsResponse): string {
  const details = [attachment.mimetype, formatBytes(attachment.size)]
    .filter(Boolean)
    .join(", ");
  const name = escapeMarkdownInline(attachment.name);
  return `- ${name}${details ? ` (${escapeMarkdownInline(details)})` : ""} — ${safeCodeSpan(attachment.id)}`;
}

/**
 * Human-readable attachments section, or empty string when there are none.
 */
export function formatEventAttachments(
  attachments: EventAttachmentDetailsResponse[]
): string {
  if (attachments.length === 0) {
    return "";
  }
  return renderMarkdown(
    ["### Attachments", "", ...attachments.map(formatAttachment)].join("\n")
  );
}

/**
 * Footer hint with a copy-pasteable download command for the first attachment.
 */
export function attachmentDownloadHint(
  org: string,
  project: string | undefined,
  eventId: string,
  attachments: EventAttachmentDetailsResponse[]
): string | undefined {
  const [first] = attachments;
  if (!(first && project)) {
    return;
  }
  const path = attachmentDownloadPath(org, project, eventId, first.id);
  const name = first.name || "attachment";
  const extra =
    attachments.length > 1 ? ` (${attachments.length - 1} more)` : "";
  return `Download attachment: sentry api ${JSON.stringify(path)} > ${JSON.stringify(name)}${extra}`;
}
