/**
 * Event attachment helpers for `sentry event view`.
 *
 * Listing uses {@link listEventAttachments}; `download` is an absolute
 * API URL for `sentry api "<url>"` so JSON never carries file bytes.
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
import { resolveOrgRegion } from "./region.js";
import { getApiBaseUrl } from "./sentry-client.js";

const log = logger.withTag("event.view");

const TRAILING_SLASHES_RE = /\/+$/;
const TRAILING_API_0_RE = /\/api\/0$/;

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
 * Absolute API URL for downloading attachment bytes.
 *
 * The URL still requires a Sentry session — `curl` without a token gets 401.
 * Pass it to `sentry api`, which strips the origin and `/api/0/` prefix.
 */
export function attachmentDownloadUrl(
  target: {
    apiBase: string;
    org: string;
    project: string;
    eventId: string;
  },
  attachmentId: string
): string {
  const origin = target.apiBase
    .replace(TRAILING_SLASHES_RE, "")
    .replace(TRAILING_API_0_RE, "");
  return `${origin}/api/0/projects/${target.org}/${target.project}/events/${target.eventId}/attachments/${attachmentId}/?download=1`;
}

/**
 * Region API origin for attachment download URLs.
 * Falls back to the CLI's configured Sentry URL when region lookup fails.
 */
export async function tryResolveAttachmentApiBase(
  org: string
): Promise<string> {
  try {
    return await resolveOrgRegion(org);
  } catch (error) {
    log.debug("Failed to resolve region for attachment download URL", error);
    return getApiBaseUrl();
  }
}

type EventAttachmentScope = {
  org?: string;
  project?: string;
  eventId: string;
  apiBase?: string;
};

/**
 * JSON attachment objects plus a `download` URL.
 */
export function jsonEventAttachments(
  scope: EventAttachmentScope,
  attachments: EventAttachmentDetailsResponse[]
): Array<EventAttachmentDetailsResponse & { download?: string }> {
  const { org, project, eventId, apiBase } = scope;
  if (!(org && project)) {
    return attachments.map((attachment) => ({ ...attachment }));
  }
  const target = {
    org,
    project,
    eventId,
    apiBase: apiBase ?? getApiBaseUrl(),
  };
  return attachments.map((attachment) => ({
    ...attachment,
    download: attachmentDownloadUrl(target, attachment.id),
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
  scope: EventAttachmentScope,
  attachments: EventAttachmentDetailsResponse[]
): string | undefined {
  const [first] = attachments;
  const { org, project, eventId, apiBase } = scope;
  if (!(first && project && org)) {
    return;
  }
  const url = attachmentDownloadUrl(
    { org, project, eventId, apiBase: apiBase ?? getApiBaseUrl() },
    first.id
  );
  const name = first.name || "attachment";
  const extra =
    attachments.length > 1 ? ` (${attachments.length - 1} more)` : "";
  return `Download attachment: sentry api ${JSON.stringify(url)} > ${JSON.stringify(name)}${extra}`;
}
