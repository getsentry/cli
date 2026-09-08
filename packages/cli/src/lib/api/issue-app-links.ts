/**
 * Link existing tracker issues through installed Sentry Apps' issue-link forms.
 * App callbacks and search URIs come only from the installed component schema.
 */

import {
  type GroupExternalIssueResponse,
  type ListOrganizationSentryAppInstallationsResponse,
  listOrganizationIssueExternalIssues,
  listOrganizationSentryAppInstallations,
} from "@sentry/api";
import {
  vGroupExternalIssueResponse,
  vListOrganizationSentryAppInstallationsResponse,
} from "@sentry/api/valibot";
import {
  array,
  boolean,
  type GenericSchema,
  type InferOutput,
  nullish,
  number,
  object,
  optional,
  picklist,
  safeParse,
  string,
  tuple,
  union,
  unknown,
} from "valibot";
import { ApiError, ValidationError } from "../errors.js";
import { resolveOrgRegion } from "../region.js";
import { getControlSiloUrl, getSdkConfig } from "../sentry-client.js";
import {
  apiRequestToRegion,
  apiRequestToRegionNoContent,
  MAX_PAGINATION_PAGES,
  type PaginatedResponse,
  parseLinkHeader,
  unwrapPaginatedResult,
} from "./infrastructure.js";

/** A stored Sentry App association; id identifies the link, not the remote ticket. */
export type AppIssueLink = GroupExternalIssueResponse[number];
type AppInstallation = ListOrganizationSentryAppInstallationsResponse[number];
const ChoiceSchema = tuple([
  union([string(), number()]),
  union([string(), number()]),
]);
const FieldSchema = object({
  name: string(),
  type: picklist(["select", "text", "textarea"]),
  choices: optional(array(ChoiceSchema)),
  options: optional(array(ChoiceSchema)),
  defaultValue: nullish(union([string(), number()])),
  depends_on: optional(array(string())),
  multiple: optional(boolean()),
  uri: optional(string()),
});
const LinkFormSchema = object({
  uri: string(),
  required_fields: optional(array(FieldSchema)),
  optional_fields: optional(array(FieldSchema)),
});
const ComponentSchema = object({
  type: string(),
  error: optional(unknown()),
  sentryApp: object({ slug: string(), uuid: string() }),
  schema: object({ link: optional(LinkFormSchema) }),
});
const ComponentsSchema = array(ComponentSchema);
const ChoicesResponseSchema = object({ choices: array(ChoiceSchema) });
type Choice = InferOutput<typeof ChoiceSchema>;
type Field = InferOutput<typeof FieldSchema>;
type LinkForm = InferOutput<typeof LinkFormSchema>;
type Component = InferOutput<typeof ComponentSchema>;

/** Inputs for a read-only preflight of the app's existing-issue link action. */
export type ResolveAppIssueLinkOptions = {
  /** Organization containing the Sentry issue and app installation. */
  orgSlug: string;
  /** Numeric Sentry group ID, required by external-issue-actions. */
  issueId: string;
  /** Existing external resource URL. */
  url: string;
  /** Installed app slug; defaults to linear for a linear.app issue URL. */
  appSlug?: string;
  /** Sentry project ID, forwarded to app searches that need project context. */
  projectId?: string;
  /** Additional form values keyed by names from the installed link schema. */
  fields?: Record<string, string>;
};

/** Read-only preflight result. Pass to linkAppIssue to execute the app action. */
export type PreparedAppIssueLink = {
  /** Organization and numeric Sentry issue being linked. */
  orgSlug: string;
  /** Numeric Sentry group ID. */
  issueId: string;
  /** Installed app slug and requested external URL for display/dry-run. */
  appSlug: string;
  /** Requested external resource URL. */
  url: string;
  /** Human-facing issue key when available. */
  displayName: string;
  /** UUID selected from this organization's installed apps. */
  installationUuid: string;
  /** Link action URI supplied by the installed app schema. */
  uri: string;
  /** Validated form fields, sent at the top level of the action request. */
  fields: Record<string, string | number>;
  /** Existing association to the same target; no callback is needed. */
  existing?: AppIssueLink;
};

const LINEAR_ISSUE_PATH = /^\/([^/]+)\/issue\/([a-z][a-z0-9]*-\d+)(?:\/|$)/i;
const TARGET_FIELD =
  /^(issue_?id|issue|external_?issue|external_?id|issue_?url|url)$/i;
const RESERVED_FIELDS = new Set([
  "groupId",
  "action",
  "uri",
  "__proto__",
  "constructor",
  "prototype",
]);
const TRAILING_SLASHES = /\/+$/;
const CHOICE_LABEL_TOKENS = /[^A-Z0-9-]+/;
const URL_FIELD = /url/i;
const NUMERIC_ID = /^\d+$/;

function parseTarget(raw: string) {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ValidationError(
      "External issue must be a valid HTTP(S) URL",
      "url"
    );
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  ) {
    throw new ValidationError(
      "External issue must be an HTTP(S) URL without credentials",
      "url"
    );
  }
  const linear =
    url.hostname === "linear.app" ? LINEAR_ISSUE_PATH.exec(url.pathname) : null;
  if (url.hostname === "linear.app" && !linear) {
    throw new ValidationError(
      "Expected a Linear issue URL containing /issue/TEAM-123",
      "url"
    );
  }
  const identity = linear
    ? `linear.app/${linear[1]?.toLowerCase()}/${linear[2]?.toUpperCase()}`
    : `${url.origin}${url.pathname.replace(TRAILING_SLASHES, "")}${url.search}${url.hash}`;
  return { url, identity, key: linear?.[2]?.toUpperCase() };
}

/** Match a stored target by URL, ignoring Linear title suffixes; reject ambiguous matches. */
export function findAppIssueLink(
  links: AppIssueLink[],
  url: string,
  appSlug?: string
): AppIssueLink | undefined {
  const target = parseTarget(url);
  const matches = links.filter(
    (link) =>
      (!appSlug || link.serviceType === appSlug) &&
      parseTarget(link.webUrl).identity === target.identity
  );
  if (matches.length > 1) {
    throw new ValidationError(
      "Multiple app links match this URL; specify the app with --app",
      "app"
    );
  }
  return matches[0];
}

/** Fetch a complete, validated collection; partial results cannot safely authorize a link mutation. */
async function listAll<T>(
  fetchPage: (
    cursor: string | undefined
  ) => Promise<PaginatedResponse<unknown>>,
  endpoint: string,
  schema: GenericSchema<unknown, T[]>
): Promise<T[]> {
  const result: T[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGINATION_PAGES; page++) {
    const { data, nextCursor } = await fetchPage(cursor);
    const parsed = safeParse(schema, data);
    if (!parsed.success) {
      throw new ApiError(
        "Unexpected API response when listing app issue links",
        0,
        undefined,
        endpoint
      );
    }
    result.push(...parsed.output);
    cursor = nextCursor;
    if (!cursor) {
      return result;
    }
    if (seen.has(cursor)) {
      throw new ApiError(
        "App issue link pagination repeated a cursor",
        0,
        undefined,
        endpoint
      );
    }
    seen.add(cursor);
  }
  throw new ApiError(
    "App issue link pagination exceeded the safety limit",
    0,
    undefined,
    endpoint
  );
}

function groupPath(orgSlug: string, issueId: string): string {
  if (
    !orgSlug ||
    orgSlug === "." ||
    orgSlug === ".." ||
    !NUMERIC_ID.test(issueId)
  ) {
    throw new ValidationError(
      "App links require an organization and numeric Sentry issue ID",
      "issueId"
    );
  }
  return `/organizations/${encodeURIComponent(orgSlug)}/issues/${encodeURIComponent(issueId)}/external-issues/`;
}

/** Retrieve all app associations in the issue's region, bypassing stale cached preflights. */
export async function listAppIssueLinks(
  orgSlug: string,
  issueId: string
): Promise<AppIssueLink[]> {
  const endpoint = groupPath(orgSlug, issueId);
  const config = getSdkConfig(await resolveOrgRegion(orgSlug), {
    cache: "no-store",
  });
  return listAll<AppIssueLink>(
    async (cursor) => {
      const result = await listOrganizationIssueExternalIssues({
        ...config,
        path: { organization_id_or_slug: orgSlug, issue_id: issueId },
        // SDK0.256.0 omits cursor from this paginated endpoint's query schema.
        query: { cursor } as never,
      });
      return unwrapPaginatedResult(result, "Failed to list app issue links");
    },
    endpoint,
    vGroupExternalIssueResponse
  );
}

/** Preserve the app's single association per Sentry issue; replacing a target requires explicit unlink. */
function checkExisting(
  links: AppIssueLink[],
  url: string,
  appSlug: string
): AppIssueLink | undefined {
  const existing = findAppIssueLink(links, url, appSlug);
  if (
    links.some(
      (link) => link.serviceType === appSlug && link.id !== existing?.id
    )
  ) {
    throw new ValidationError(
      `This issue already has a different ${appSlug} link. Unlink it before linking another issue.`,
      "app"
    );
  }
  return existing;
}

function validateUri(uri: unknown): asserts uri is string {
  if (
    typeof uri !== "string" ||
    !uri.startsWith("/") ||
    uri.startsWith("//") ||
    uri.includes("\\")
  ) {
    throw new ValidationError(
      "The installed app has an invalid relative action URI",
      "app"
    );
  }
}

async function resolveInstallation(
  orgSlug: string,
  appSlug: string
): Promise<AppInstallation> {
  const config = getSdkConfig(getControlSiloUrl(), { cache: "no-store" });
  const installations = await listAll<AppInstallation>(
    async (cursor) => {
      const result = await listOrganizationSentryAppInstallations({
        ...config,
        path: { organization_id_or_slug: orgSlug },
        query: { cursor },
      });
      return unwrapPaginatedResult(
        result,
        "Failed to list Sentry App installations"
      );
    },
    `/organizations/${encodeURIComponent(orgSlug)}/sentry-app-installations/`,
    vListOrganizationSentryAppInstallationsResponse
  );
  const matches = installations.filter(
    (item) =>
      item.organization.slug === orgSlug &&
      item.app.slug === appSlug &&
      item.status === "installed"
  );
  const installation = matches[0];
  if (matches.length !== 1 || !installation) {
    throw new ValidationError(
      matches.length
        ? `Multiple installed apps match ${appSlug}`
        : `App ${appSlug} is not installed in this organization`,
      "app"
    );
  }
  return installation;
}

async function getLinkForm(
  orgSlug: string,
  installation: AppInstallation
): Promise<LinkForm> {
  const endpoint = `/organizations/${encodeURIComponent(orgSlug)}/sentry-app-components/`;
  // SDK0.256.0 has no operation for installed app UI components.
  const components = await listAll<Component>(
    async (cursor) => {
      const { data, headers } = await apiRequestToRegion<unknown>(
        getControlSiloUrl(),
        endpoint,
        {
          params: { filter: "issue-link", cursor },
          cache: "no-store",
        }
      );
      return {
        data,
        nextCursor: parseLinkHeader(headers.get("Link")).nextCursor,
      };
    },
    endpoint,
    ComponentsSchema
  );
  const matches = components.filter(
    (item) =>
      item.type === "issue-link" &&
      item.sentryApp.uuid === installation.app.uuid
  );
  const component = matches[0];
  const form = component?.schema.link;
  if (matches.length !== 1 || !component || !form) {
    throw new ValidationError(
      `App ${installation.app.slug} does not expose an unambiguous issue-link form`,
      "app"
    );
  }
  if (component.error) {
    throw new ApiError(
      `App ${installation.app.slug} could not prepare its issue-link form`,
      0,
      JSON.stringify(component.error)
    );
  }
  validateUri(form.uri);
  return form;
}

async function getChoices({
  installationUuid,
  field,
  query,
  values,
  projectId,
}: {
  installationUuid: string;
  field: Field;
  query: string;
  values: Record<string, string | number>;
  projectId?: string;
}): Promise<Choice[]> {
  if (!field.uri) {
    return field.choices ?? field.options ?? [];
  }
  validateUri(field.uri);
  const dependentData: Record<string, string | number> = {};
  for (const name of field.depends_on ?? []) {
    if (values[name] === undefined) {
      throw new ValidationError(
        `App field ${field.name} requires --field ${name}=VALUE`,
        "field"
      );
    }
    dependentData[name] = values[name];
  }
  // SDK0.256.0 does not expose app form option searches.
  const { data } = await apiRequestToRegion<{ choices: Choice[] }>(
    getControlSiloUrl(),
    `/sentry-app-installations/${encodeURIComponent(installationUuid)}/external-requests/`,
    {
      params: {
        uri: field.uri,
        query,
        projectId,
        dependentData: field.depends_on?.length
          ? JSON.stringify(dependentData)
          : undefined,
      },
      cache: "no-store",
      schema: ChoicesResponseSchema,
    }
  );
  return data.choices;
}

function selectChoice(
  choices: Choice[],
  query: string,
  linearKey?: string
): string | number {
  const matches = choices.filter(
    ([value, label]) =>
      String(value) === query ||
      String(label) === query ||
      (linearKey !== undefined &&
        String(label)
          .toUpperCase()
          .split(CHOICE_LABEL_TOKENS)
          .find((token) => token.length > 0) === linearKey)
  );
  const choice = matches[0];
  if (matches.length !== 1 || !choice) {
    throw new ValidationError(
      matches.length
        ? "App search returned multiple exact issue matches"
        : "App search did not return an exact match for the external issue",
      "url"
    );
  }
  return choice[0];
}

/** Resolve form dependencies while keeping the target field bound to the requested issue URL. */
async function resolveFields(
  options: ResolveAppIssueLinkOptions,
  form: LinkForm,
  installationUuid: string
): Promise<Record<string, string | number>> {
  const required = form.required_fields ?? [];
  const fields = [...required, ...(form.optional_fields ?? [])];
  const values = seedFields(fields, options.fields ?? {});
  const targetField = findTargetField(fields, required);
  const pending = fields.filter(
    (field) => field === targetField || values[field.name] !== undefined
  );
  const resolved = new Set<string>();
  while (pending.length) {
    const index = pending.findIndex((item) =>
      (item.depends_on ?? []).every((name) => resolved.has(name))
    );
    const field = pending[index];
    if (!field) {
      throw new ValidationError(
        "App link fields have missing or circular dependencies; supply the required --field values",
        "field"
      );
    }
    pending.splice(index, 1);
    values[field.name] = await resolveFieldValue({
      field,
      targetField,
      values,
      options,
      installationUuid,
    });
    resolved.add(field.name);
  }
  const missing = required.filter(
    (field) => values[field.name] === undefined || values[field.name] === ""
  );
  if (missing.length) {
    throw new ValidationError(
      `Missing app link fields: ${missing.map((field) => `--field ${field.name}=VALUE`).join(", ")}`,
      "field"
    );
  }
  return values;
}

function seedFields(
  fields: Field[],
  supplied: Record<string, string>
): Record<string, string | number> {
  const values: Record<string, string | number> = {};
  if (new Set(fields.map((field) => field.name)).size !== fields.length) {
    throw new ValidationError(
      "App link schema contains duplicate field names",
      "app"
    );
  }
  for (const [name, value] of Object.entries(supplied)) {
    if (
      RESERVED_FIELDS.has(name) ||
      !fields.some((field) => field.name === name)
    ) {
      throw new ValidationError(
        `Unknown or reserved app link field: ${name}`,
        "field"
      );
    }
    values[name] = value;
  }
  for (const field of fields) {
    if (RESERVED_FIELDS.has(field.name)) {
      throw new ValidationError(
        `App link schema uses reserved field ${field.name}`,
        "app"
      );
    }
    if (field.multiple) {
      throw new ValidationError(
        `App link field ${field.name} requires multiple values and is not supported`,
        "field"
      );
    }
    if (
      values[field.name] === undefined &&
      field.defaultValue !== undefined &&
      field.defaultValue !== null
    ) {
      values[field.name] = field.defaultValue;
    }
  }
  return values;
}

function findTargetField(fields: Field[], required: Field[]): Field {
  const candidates = fields.filter((field) => TARGET_FIELD.test(field.name));
  let targetField = candidates.length === 1 ? candidates[0] : undefined;
  if (candidates.length === 0 && required.length === 1) {
    targetField = required[0];
  }
  if (!targetField) {
    throw new ValidationError(
      "Cannot identify one external issue field in the app link schema",
      "app"
    );
  }
  return targetField;
}

async function resolveFieldValue({
  field,
  targetField,
  values,
  options,
  installationUuid,
}: {
  field: Field;
  targetField: Field;
  values: Record<string, string | number>;
  options: ResolveAppIssueLinkOptions;
  installationUuid: string;
}): Promise<string | number> {
  const target = parseTarget(options.url);
  const query = target.key ?? options.url;
  const input = field === targetField ? query : String(values[field.name]);
  let value: string | number = input;
  if (field.type === "select") {
    value = selectChoice(
      await getChoices({
        installationUuid,
        field,
        query: input,
        values,
        projectId: options.projectId,
      }),
      input,
      field === targetField ? target.key : undefined
    );
  } else if (field === targetField && URL_FIELD.test(field.name)) {
    value = options.url;
  }
  if (
    field === targetField &&
    options.fields?.[field.name] !== undefined &&
    options.fields[field.name] !== String(value) &&
    options.fields[field.name] !== query
  ) {
    throw new ValidationError(
      `App field ${field.name} conflicts with the requested issue URL`,
      "field"
    );
  }
  return value;
}

/** Resolve the installed app and form using reads only; never register a local-only fallback. */
export async function resolveAppIssueLink(
  options: ResolveAppIssueLinkOptions
): Promise<PreparedAppIssueLink> {
  const target = parseTarget(options.url);
  const appSlug = options.appSlug ?? (target.key ? "linear" : undefined);
  if (!appSlug) {
    throw new ValidationError(
      "Specify --app for this external issue URL",
      "app"
    );
  }
  if (!NUMERIC_ID.test(options.issueId)) {
    throw new ValidationError(
      "App linking requires the numeric Sentry issue ID",
      "issueId"
    );
  }
  const existing = checkExisting(
    await listAppIssueLinks(options.orgSlug, options.issueId),
    options.url,
    appSlug
  );
  const installation = await resolveInstallation(options.orgSlug, appSlug);
  if (existing) {
    return {
      ...options,
      appSlug,
      installationUuid: installation.uuid,
      displayName: existing.displayName,
      uri: "",
      fields: {},
      existing,
    };
  }
  const form = await getLinkForm(options.orgSlug, installation);
  return {
    orgSlug: options.orgSlug,
    issueId: options.issueId,
    appSlug,
    url: options.url,
    displayName: target.key ?? options.url,
    installationUuid: installation.uuid,
    uri: form.uri,
    fields: await resolveFields(options, form, installation.uuid),
  };
}

/** Execute one app callback after a fresh singleton check; concurrent server-side replacements remain possible. */
export async function linkAppIssue(
  prepared: PreparedAppIssueLink
): Promise<{ link: AppIssueLink; changed: boolean }> {
  const existing = checkExisting(
    await listAppIssueLinks(prepared.orgSlug, prepared.issueId),
    prepared.url,
    prepared.appSlug
  );
  if (existing) {
    return { link: existing, changed: false };
  }
  if (prepared.existing) {
    throw new ValidationError(
      "The app link changed after preflight; run the command again",
      "url"
    );
  }
  validateUri(prepared.uri);
  // SDK0.256.0 only has direct registration, which skips the app's link callback.
  const { data: link } = await apiRequestToRegion<AppIssueLink>(
    getControlSiloUrl(),
    `/sentry-app-installations/${encodeURIComponent(prepared.installationUuid)}/external-issue-actions/`,
    {
      method: "POST",
      body: {
        ...prepared.fields,
        groupId: prepared.issueId,
        action: "link",
        uri: prepared.uri,
      },
      retry: false,
      cache: "no-store",
      schema: vGroupExternalIssueResponse.item,
    }
  );
  if (
    String(link.issueId) !== prepared.issueId ||
    link.serviceType !== prepared.appSlug ||
    parseTarget(link.webUrl).identity !== parseTarget(prepared.url).identity
  ) {
    throw new ApiError(
      "The app returned a different issue after linking; inspect the current links before retrying",
      0
    );
  }
  return { link, changed: true };
}

/** Remove only the selected local app association; this existing endpoint requires event:admin. */
export async function unlinkAppIssueLink(
  orgSlug: string,
  issueId: string,
  linkId: string
): Promise<void> {
  if (!NUMERIC_ID.test(linkId)) {
    throw new ValidationError(
      "App unlink requires the numeric association ID",
      "linkId"
    );
  }
  // The SDK's installation unlink uses different auth; this group-scoped operation is absent.
  await apiRequestToRegionNoContent(
    await resolveOrgRegion(orgSlug),
    `${groupPath(orgSlug, issueId)}${encodeURIComponent(linkId)}/`,
    {
      method: "DELETE",
      retry: false,
      cache: "no-store",
    }
  );
}
