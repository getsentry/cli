/** Existing issue-tracker links through Sentry's native integrations. */
import {
  deleteOrganizationIssueIntegration,
  type ExternalIssueLinkResponse,
  type IntegrationIssueConfigResponse,
  type LinkExternalIssueRequest,
  type ListOrganizationReposResponse,
  listOrganizationRepos,
  updateOrganizationIssueIntegration,
} from "@sentry/api";

import { ValidationError } from "../errors.js";
import { resolveOrgRegion } from "../region.js";
import { getSdkConfig } from "../sentry-client.js";
import {
  API_MAX_PER_PAGE,
  apiRequestToRegion,
  MAX_PAGINATION_PAGES,
  type PaginatedResponse,
  parseLinkHeader,
  unwrapPaginatedResult,
  unwrapResult,
} from "./infrastructure.js";

/** An existing reference to a tracker issue, stored by a native integration. */
export type NativeIssueLink = Pick<
  ExternalIssueLinkResponse,
  "key" | "url" | "displayName"
> & {
  /** Internal Sentry ExternalIssue ID, required by the unlink endpoint. */
  id: string;
  /** ID of the installed Sentry integration that owns this reference. */
  integrationId: string;
  /** Native integration provider key, such as github or jira_server. */
  provider: string;
  /** Issue title, when supplied by the list endpoint. */
  title?: string;
};

type NativeIntegration = Pick<
  IntegrationIssueConfigResponse,
  "id" | "name" | "domainName" | "status" | "provider"
> & {
  externalIssues: Omit<NativeIssueLink, "integrationId" | "provider">[];
};

/** Read-only resolution result used for previews and a subsequent link mutation. */
export type PreparedNativeIssueLink = {
  /** Sentry organization containing the source issue. */
  orgSlug: string;
  /** Numeric Sentry issue ID. */
  issueId: string;
  /** Regional API origin resolved for this organization. */
  regionUrl: string;
  /** Selected native integration ID. */
  integrationId: string;
  /** Native integration provider key. */
  provider: string;
  /** Canonical tracker issue URL for the preview. */
  url: string;
  /** Provider issue key for the preview. */
  key: string;
  /** The backend also requires repo for GitHub and Bitbucket; the SDK schema omits it. */
  body: LinkExternalIssueRequest & { repo?: string };
  /** Reference found during fresh preflight; avoids a duplicate mutation. */
  existing?: NativeIssueLink;
};

type ParsedTarget = Pick<PreparedNativeIssueLink, "url" | "key" | "body">;

const TRAILING_SLASH = /\/+$/;
const REPOSITORY_ISSUE = /^\/([^/]+\/[^/]+)\/issues\/(\d+)(?:\/[^/]+)?$/;
const GITLAB_ISSUE = /^\/(.+?)(?:\/-)?\/issues\/(\d+)$/;
const JIRA_ISSUE = /^(.*?)\/browse\/([A-Z][A-Z0-9_]*-\d+)$/i;
const WORK_ITEM = /^(.*?)\/_workitems\/edit\/(\d+)$/;
const SCM_CHANGE =
  /(?:^\/[^/]+\/[^/]+\/(?:pulls?|pull-requests|commits?)\/|\/-\/(?:merge_requests|commits?)\/)/;

function issuePath(orgSlug: string, issueId: string): string {
  return `/organizations/${encodeURIComponent(orgSlug)}/issues/${encodeURIComponent(issueId)}/integrations/`;
}

function parseUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ValidationError(
      "External issue must be an absolute HTTP(S) URL."
    );
  }
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password
  ) {
    throw new ValidationError(
      "External issue must be an HTTP(S) URL without credentials."
    );
  }
  url.hash = "";
  url.search = "";
  url.pathname = url.pathname.replace(TRAILING_SLASH, "");
  return url;
}

function integrationUrl(integration: NativeIntegration): URL | undefined {
  if (!integration.domainName) {
    return;
  }
  const domain = integration.domainName;
  // Older personal Bitbucket installations store only the username.
  if (integration.provider.key === "bitbucket" && !domain.includes("/")) {
    return parseUrl(`https://bitbucket.org/${domain}`);
  }
  return parseUrl(domain.includes("://") ? domain : `https://${domain}`);
}

function parseRepositoryIssue(url: URL): ParsedTarget | undefined {
  const match = REPOSITORY_ISSUE.exec(url.pathname);
  if (!(match?.[1] && match[2])) {
    return;
  }
  const repo = match[1];
  const number = match[2];
  return {
    url: `${url.origin}/${repo}/issues/${number}`,
    key: `${repo}#${number}`,
    body: { repo, externalIssue: number },
  };
}

function parseGitlabIssue(url: URL): ParsedTarget | undefined {
  const match = GITLAB_ISSUE.exec(url.pathname);
  if (!(match?.[1] && match[2])) {
    return;
  }
  const project = match[1];
  const number = match[2];
  return {
    url: `${url.origin}/${project}/-/issues/${number}`,
    key: `${url.host}:${project}#${number}`,
    body: { externalIssue: `${project}#${number}` },
  };
}

function parseJiraIssue(url: URL): ParsedTarget | undefined {
  const match = JIRA_ISSUE.exec(url.pathname);
  if (!match?.[2]) {
    return;
  }
  const key = match[2].toUpperCase();
  return {
    url: `${url.origin}${match[1]}/browse/${key}`,
    key,
    body: { externalIssue: key },
  };
}

function azureAccount(url: URL): string | undefined {
  if (url.hostname === "dev.azure.com") {
    return url.pathname.split("/").find(Boolean)?.toLowerCase();
  }
  if (url.hostname.endsWith(".visualstudio.com")) {
    return url.hostname.slice(0, -".visualstudio.com".length);
  }
}

function parseAzureIssue(url: URL, domain: URL): ParsedTarget | undefined {
  const account = azureAccount(domain);
  const match = WORK_ITEM.exec(url.pathname);
  if (!(account && account === azureAccount(url) && match?.[2])) {
    return;
  }
  const key = match[2];
  return {
    url: `${domain.origin}${domain.pathname.replace(TRAILING_SLASH, "")}/_workitems/edit/${key}`,
    key,
    body: { externalIssue: key },
  };
}

function parseScopedGitlabIssue(
  url: URL,
  domain: URL,
  domainName: string
): ParsedTarget | undefined {
  const target = parseGitlabIssue(url);
  const group = domain.pathname.replace(TRAILING_SLASH, "");
  if (group && !url.pathname.startsWith(`${group}/`)) {
    return;
  }
  return target
    ? { ...target, key: `${domainName}:${target.body.externalIssue}` }
    : undefined;
}

function parseTarget(
  url: URL,
  integration: NativeIntegration
): ParsedTarget | undefined {
  const domain = integrationUrl(integration);
  if (!(domain && integration.domainName)) {
    return;
  }
  const provider = integration.provider.key;
  if (provider === "vsts") {
    return parseAzureIssue(url, domain);
  }
  if (domain.host !== url.host) {
    return;
  }
  if (["github", "github_enterprise", "bitbucket"].includes(provider)) {
    const target = parseRepositoryIssue(url);
    const account = domain.pathname.split("/").find(Boolean);
    if (
      account &&
      target?.body.repo?.split("/")[0]?.toLowerCase() !== account.toLowerCase()
    ) {
      return;
    }
    return target;
  }
  if (provider === "gitlab") {
    return parseScopedGitlabIssue(url, domain, integration.domainName);
  }
  if (provider === "jira" || provider === "jira_server") {
    const prefix = domain.pathname.replace(TRAILING_SLASH, "");
    if (prefix && !url.pathname.startsWith(`${prefix}/browse/`)) {
      return;
    }
    return parseJiraIssue(url);
  }
}

async function listFreshPages<T>(
  fetchPage: (cursor?: string) => Promise<PaginatedResponse<T[]>>
): Promise<T[]> {
  const items: T[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGINATION_PAGES; page++) {
    const response = await fetchPage(cursor);
    items.push(...response.data);
    cursor = response.nextCursor;
    if (!cursor) {
      return items;
    }
  }
  throw new ValidationError(
    "Too many results to resolve the issue link safely."
  );
}

async function listIntegrations(
  orgSlug: string,
  issueId: string
): Promise<NativeIntegration[]> {
  const regionUrl = await resolveOrgRegion(orgSlug);
  // The SDK exposes integration detail and mutations, but no issue-integration list.
  return listFreshPages(async (cursor) => {
    const response = await apiRequestToRegion<NativeIntegration[]>(
      regionUrl,
      issuePath(orgSlug, issueId),
      {
        params: { cursor, per_page: API_MAX_PER_PAGE },
        cache: "no-store",
      }
    );
    return {
      data: response.data,
      nextCursor: parseLinkHeader(response.headers.get("Link")).nextCursor,
    };
  });
}

async function listFreshRepositories(
  orgSlug: string
): Promise<ListOrganizationReposResponse> {
  const config = getSdkConfig(await resolveOrgRegion(orgSlug), {
    cache: "no-store",
  });
  return listFreshPages(async (cursor) => {
    // per_page is supported by Sentry's paginator but absent from the SDK query type.
    const query = { cursor, per_page: API_MAX_PER_PAGE };
    const result = await listOrganizationRepos({
      ...config,
      path: { organization_id_or_slug: orgSlug },
      query,
    });
    return unwrapPaginatedResult<ListOrganizationReposResponse>(
      result,
      "Failed to list repositories"
    );
  });
}

function flattenLinks(integrations: NativeIntegration[]): NativeIssueLink[] {
  return integrations.flatMap((integration) =>
    integration.externalIssues.map((link) => ({
      ...link,
      id: String(link.id),
      integrationId: integration.id,
      provider: integration.provider.key,
      url:
        parseTarget(parseUrl(link.url), integration)?.url ??
        parseUrl(link.url).href,
    }))
  );
}

/** Fetch every link fresh, including links whose provider is no longer supported. */
export async function listNativeIssueLinks(
  orgSlug: string,
  issueId: string
): Promise<NativeIssueLink[]> {
  return flattenLinks(await listIntegrations(orgSlug, issueId));
}

function matchesNativeUrl(link: NativeIssueLink, target: URL): boolean {
  const existing = parseUrl(link.url);
  if (link.provider === "vsts") {
    const issueId = WORK_ITEM.exec(target.pathname)?.[2];
    const account = azureAccount(target);
    return Boolean(
      issueId &&
        account &&
        account === azureAccount(existing) &&
        issueId === WORK_ITEM.exec(existing.pathname)?.[2]
    );
  }
  if (existing.host !== target.host) {
    return false;
  }
  if (link.provider === "gitlab") {
    const existingMatch = GITLAB_ISSUE.exec(existing.pathname);
    const targetMatch = GITLAB_ISSUE.exec(target.pathname);
    return Boolean(
      existingMatch &&
        targetMatch &&
        existingMatch[1] === targetMatch[1] &&
        existingMatch[2] === targetMatch[2]
    );
  }
  if (["github", "github_enterprise", "bitbucket"].includes(link.provider)) {
    const key = parseRepositoryIssue(target)?.key.toLowerCase();
    return Boolean(
      key && key === parseRepositoryIssue(existing)?.key.toLowerCase()
    );
  }
  if (["jira", "jira_server"].includes(link.provider)) {
    const canonical = parseJiraIssue(target)?.url;
    return Boolean(canonical && canonical === parseJiraIssue(existing)?.url);
  }
  return existing.href === target.href;
}

/** Match local link metadata without contacting the issue tracker. */
export function findNativeIssueLink(
  links: NativeIssueLink[],
  url: string,
  integrationId?: string
): NativeIssueLink | undefined {
  const target = parseUrl(url);
  const matches = links.filter(
    (link) =>
      (!integrationId || integrationId === link.integrationId) &&
      matchesNativeUrl(link, target)
  );
  if (matches.length > 1) {
    throw new ValidationError(
      "This issue is linked through multiple integrations. Specify --integration <id>."
    );
  }
  return matches[0];
}

/** Prepare a reference using installed integration metadata; performs no mutations. */
export async function resolveNativeIssueLink(options: {
  orgSlug: string;
  issueId: string;
  url: string;
  integrationId?: string;
}): Promise<PreparedNativeIssueLink> {
  const url = parseUrl(options.url);
  if (SCM_CHANGE.test(url.pathname)) {
    throw new ValidationError(
      "External issue linking accepts tracker issues, not commits or pull requests."
    );
  }
  const integrations = await listIntegrations(options.orgSlug, options.issueId);
  let candidates = integrations.flatMap((integration) => {
    if (
      integration.status !== "active" ||
      (options.integrationId && options.integrationId !== integration.id)
    ) {
      return [];
    }
    const target = parseTarget(url, integration);
    return target ? [{ integration, target }] : [];
  });
  if (
    candidates.some(({ integration }) =>
      ["github", "github_enterprise"].includes(integration.provider.key)
    )
  ) {
    const repositories = await listFreshRepositories(options.orgSlug);
    candidates = candidates.flatMap(({ integration, target }) => {
      if (!["github", "github_enterprise"].includes(integration.provider.key)) {
        return [{ integration, target }];
      }
      const repository = repositories.find(
        (repo) =>
          repo.status === "active" &&
          repo.integrationId === integration.id &&
          repo.name.toLowerCase() === target.body.repo?.toLowerCase()
      );
      if (!repository) {
        return [];
      }
      // Sentry's repository lookup is case-sensitive; use its registered spelling.
      return [
        {
          integration,
          target: {
            ...target,
            body: { ...target.body, repo: repository.name },
            key: `${repository.name}#${target.body.externalIssue}`,
            url: `${url.origin}/${repository.name}/issues/${target.body.externalIssue}`,
          },
        },
      ];
    });
  }
  if (candidates.length === 0) {
    throw new ValidationError(
      "No installed native issue-tracker integration matches this URL. Check --integration, or use --app <slug> for a Sentry App."
    );
  }
  if (candidates.length > 1) {
    throw new ValidationError(
      `Multiple integrations match this URL. Specify --integration <id>: ${candidates.map(({ integration }) => `${integration.id} (${integration.name})`).join(", ")}`
    );
  }
  const selected = candidates[0];
  if (!selected) {
    throw new ValidationError("No matching integration.");
  }
  return {
    orgSlug: options.orgSlug,
    issueId: options.issueId,
    regionUrl: await resolveOrgRegion(options.orgSlug),
    integrationId: selected.integration.id,
    provider: selected.integration.provider.key,
    ...selected.target,
    existing: findNativeIssueLink(
      flattenLinks(integrations),
      selected.target.url,
      selected.integration.id
    ),
  };
}

/** Link an existing tracker issue, without a comment or automatic mutation retry. */
export async function linkNativeIssue(
  prepared: PreparedNativeIssueLink
): Promise<{ link: NativeIssueLink; changed: boolean }> {
  if (prepared.existing) {
    return { link: prepared.existing, changed: false };
  }
  const result = await updateOrganizationIssueIntegration({
    ...getSdkConfig(prepared.regionUrl, {
      retry: false,
      cache: "no-store",
    }),
    path: {
      organization_id_or_slug: prepared.orgSlug,
      issue_id: prepared.issueId,
      integration_id: prepared.integrationId,
    },
    body: prepared.body,
  });
  const data = unwrapResult<ExternalIssueLinkResponse>(
    result,
    "Failed to link external issue"
  );
  return {
    link: {
      ...data,
      id: String(data.id),
      integrationId: String(data.integrationId),
      provider: prepared.provider,
    },
    changed: true,
  };
}

/** The DELETE identifier is Sentry's ExternalIssue ID, not the provider key. */
export async function unlinkNativeIssueLink(
  orgSlug: string,
  issueId: string,
  link: NativeIssueLink
): Promise<void> {
  const externalIssue = Number(link.id);
  if (!Number.isSafeInteger(externalIssue) || externalIssue <= 0) {
    throw new ValidationError(
      "External issue link ID must be a safe positive integer."
    );
  }
  const result = await deleteOrganizationIssueIntegration({
    ...getSdkConfig(await resolveOrgRegion(orgSlug), {
      retry: false,
      cache: "no-store",
    }),
    path: {
      organization_id_or_slug: orgSlug,
      issue_id: issueId,
      integration_id: link.integrationId,
    },
    query: { externalIssue },
  });
  unwrapResult<void>(result, "Failed to unlink external issue");
}
