/**
 * Link and unlink existing external issues through Sentry's native integrations
 * and Sentry Apps. These operations leave the Sentry issue's status unchanged.
 */

import {
  findAppIssueLink,
  linkAppIssue,
  listAppIssueLinks,
  resolveAppIssueLink,
  unlinkAppIssueLink,
} from "./api/issue-app-links.js";
import {
  findNativeIssueLink,
  linkNativeIssue,
  listNativeIssueLinks,
  resolveNativeIssueLink,
  unlinkNativeIssueLink,
} from "./api/issue-integrations.js";
import { ValidationError } from "./errors.js";
import { resolveOrgRegion } from "./region.js";
import { invalidateCachedResponsesMatching } from "./response-cache.js";
import { getApiBaseUrl } from "./sentry-client.js";

/** An external resource selected for linking to a Sentry issue. */
export type ExternalIssueLinkOptions = {
  /** Organization containing the Sentry issue. */
  orgSlug: string;
  /** Numeric Sentry issue ID. */
  issueId: string;
  /** Project context required by some Sentry App searches. */
  projectId?: string;
  /** URL of an existing external issue. */
  url: string;
  /** Native integration ID, when multiple installations match. */
  integrationId?: string;
  /** Sentry App slug; Linear URLs select the Linear app automatically. */
  appSlug?: string;
  /** Additional fields required by a Sentry App's link form. */
  fields?: Record<string, string>;
  /** Inspect the operation without submitting a mutation. */
  dryRun?: boolean;
};

/** Result shared by human and JSON output for external issue mutations. */
export type ExternalIssueLinkResult = {
  /** Organization containing the Sentry issue. */
  org: string;
  /** Numeric Sentry issue ID. */
  issueId: string;
  /** Requested operation. */
  action: "link" | "unlink";
  /** Whether the external issue remains linked after the operation. */
  linked: boolean;
  /** Whether this invocation changed an association. */
  changed: boolean;
  /** True when no mutation was submitted. */
  dryRun?: boolean;
  /** Canonical external issue identity when available. */
  externalIssue: {
    /** Sentry's internal external-issue record ID, not the tracker key. */
    id?: string;
    /** Tracker key or display name. */
    identifier?: string;
    /** External issue URL. */
    url: string;
    /** Native provider key or Sentry App slug. */
    provider?: string;
  };
};

/** Validate the URL and select the native integration or Sentry App workflow. */
function usesSentryApp(options: ExternalIssueLinkOptions): boolean {
  let url: URL;
  try {
    url = new URL(options.url);
  } catch {
    throw new ValidationError("--external-issue must be a complete issue URL.");
  }
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password
  ) {
    throw new ValidationError(
      "--external-issue must be an HTTP(S) URL without embedded credentials."
    );
  }
  const app = Boolean(options.appSlug) || url.hostname === "linear.app";
  if (app && options.integrationId) {
    throw new ValidationError(
      "--integration selects a native integration. Use --app for a Sentry App."
    );
  }
  if (!app && options.fields && Object.keys(options.fields).length > 0) {
    throw new ValidationError(
      "--field requires a Sentry App selected with --app."
    );
  }
  return app;
}

/** App callbacks run on the control silo, so invalidate the issue's regional cache too. */
async function invalidateIssueLinks(
  options: ExternalIssueLinkOptions
): Promise<void> {
  const regionUrl = await resolveOrgRegion(options.orgSlug);
  const base = getApiBaseUrl();
  const issuePath = `/api/0/organizations/${encodeURIComponent(options.orgSlug)}/issues/${encodeURIComponent(options.issueId)}/`;
  await Promise.all([
    invalidateCachedResponsesMatching(new URL(issuePath, regionUrl).href),
    invalidateCachedResponsesMatching(new URL(issuePath, base).href),
    invalidateCachedResponsesMatching(
      new URL(`/api/0/issues/${encodeURIComponent(options.issueId)}/`, base)
        .href
    ),
  ]);
}

/** Associate an existing ticket; a dry run performs only discovery and validation. */
export async function linkExternalIssue(
  options: ExternalIssueLinkOptions
): Promise<ExternalIssueLinkResult> {
  const base = {
    org: options.orgSlug,
    issueId: options.issueId,
    action: "link" as const,
    dryRun: options.dryRun,
  };
  if (usesSentryApp(options)) {
    const prepared = await resolveAppIssueLink(options);
    if (options.dryRun) {
      return {
        ...base,
        linked: Boolean(prepared.existing),
        changed: false,
        externalIssue: {
          id: prepared.existing?.id,
          url: options.url,
          provider: options.appSlug ?? "linear",
        },
      };
    }
    const { link: appLink, changed: appChanged } = await linkAppIssue(prepared);
    if (appChanged) {
      await invalidateIssueLinks(options);
    }
    return {
      ...base,
      linked: true,
      changed: appChanged,
      externalIssue: {
        id: appLink.id,
        identifier: appLink.displayName,
        url: appLink.webUrl,
        provider: appLink.serviceType,
      },
    };
  }
  const prepared = await resolveNativeIssueLink(options);
  if (options.dryRun) {
    return {
      ...base,
      linked: Boolean(prepared.existing),
      changed: false,
      externalIssue: {
        id: prepared.existing?.id,
        identifier: prepared.key,
        url: prepared.url,
        provider: prepared.provider,
      },
    };
  }
  const { link, changed } = await linkNativeIssue(prepared);
  if (changed) {
    await invalidateIssueLinks(options);
  }
  return {
    ...base,
    linked: true,
    changed,
    externalIssue: {
      id: link.id,
      identifier: link.key,
      url: link.url,
      provider: link.provider,
    },
  };
}

/** Remove a stored association without contacting or deleting the remote ticket. */
export async function unlinkExternalIssue(
  options: ExternalIssueLinkOptions
): Promise<ExternalIssueLinkResult> {
  const base = {
    org: options.orgSlug,
    issueId: options.issueId,
    action: "unlink" as const,
    dryRun: options.dryRun,
  };
  if (usesSentryApp(options)) {
    const links = await listAppIssueLinks(options.orgSlug, options.issueId);
    const link = findAppIssueLink(links, options.url, options.appSlug);
    if (link && !options.dryRun) {
      await unlinkAppIssueLink(options.orgSlug, options.issueId, link.id);
      await invalidateIssueLinks(options);
    }
    return {
      ...base,
      linked: Boolean(link && options.dryRun),
      changed: Boolean(link && !options.dryRun),
      externalIssue: {
        id: link?.id,
        identifier: link?.displayName,
        url: link?.webUrl ?? options.url,
        provider: link?.serviceType ?? options.appSlug ?? "linear",
      },
    };
  }
  const links = await listNativeIssueLinks(options.orgSlug, options.issueId);
  const link = findNativeIssueLink(links, options.url, options.integrationId);
  if (link && !options.dryRun) {
    await unlinkNativeIssueLink(options.orgSlug, options.issueId, link);
    await invalidateIssueLinks(options);
  }
  return {
    ...base,
    linked: Boolean(link && options.dryRun),
    changed: Boolean(link && !options.dryRun),
    externalIssue: {
      id: link?.id,
      identifier: link?.key,
      url: link?.url ?? options.url,
      provider: link?.provider,
    },
  };
}
