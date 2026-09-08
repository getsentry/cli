import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  findNativeIssueLink,
  linkNativeIssue,
  listNativeIssueLinks,
  type NativeIssueLink,
  resolveNativeIssueLink,
  unlinkNativeIssueLink,
} from "../../../src/lib/api/issue-integrations.js";
import { setAuthToken } from "../../../src/lib/db/auth.js";
import { setOrgRegion } from "../../../src/lib/db/regions.js";
import { ApiError } from "../../../src/lib/errors.js";
import { mockFetch, useTestConfigDir } from "../../helpers.js";

const REGION = "https://eu.sentry.io";
const INTEGRATIONS = "/api/0/organizations/test-org/issues/42/integrations/";
const REPOSITORIES = "/api/0/organizations/test-org/repos/";
const SOURCE = { orgSlug: "test-org", issueId: "42" };
const JIRA_URL = "https://tracker.example.com/browse/PROJ-7";
const LINK: NativeIssueLink = {
  id: "1234",
  integrationId: "10",
  provider: "jira",
  key: "PROJ-7",
  url: JIRA_URL,
  displayName: "PROJ-7",
  title: "Example issue",
};

function integration(
  provider = "jira",
  domainName = "tracker.example.com",
  id = "10",
  externalIssues: NativeIssueLink[] = []
) {
  return {
    id,
    name: `Example ${provider}`,
    domainName,
    provider: {
      key: provider,
      slug: provider,
      name: `Example ${provider}`,
      canAdd: true,
      canDisable: false,
      features: ["issue-basic"],
      aspects: {},
    },
    status: "active",
    externalIssues,
  };
}

function repository(name: string, integrationId: string) {
  return {
    id: "100",
    name,
    integrationId,
    status: "active",
    dateCreated: "2026-01-01T00:00:00Z",
  };
}

function json(data: unknown, headers?: HeadersInit): Response {
  return Response.json(data, { status: 200, headers });
}

function mockApi(
  respond: (request: Request) => Response | Promise<Response>
): Request[] {
  const requests: Request[] = [];
  globalThis.fetch = mockFetch(async (input, init) => {
    const request = new Request(input, init);
    requests.push(request);
    return respond(request);
  });
  return requests;
}

describe("native tracker issue links", () => {
  useTestConfigDir("native-issue-links-");
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    setAuthToken("test-token", 3600, "test-refresh");
    setOrgRegion(SOURCE.orgSlug, REGION);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test.each([
    {
      provider: "jira",
      domain: "tracker.example.com",
      url: `${JIRA_URL.toLowerCase()}/?source=cli#details`,
      canonical: JIRA_URL,
      body: { externalIssue: "PROJ-7" },
    },
    {
      provider: "jira_server",
      domain: "tracker.example.com",
      url: "https://tracker.example.com/jira/browse/PROJ-7",
      canonical: "https://tracker.example.com/jira/browse/PROJ-7",
      body: { externalIssue: "PROJ-7" },
    },
    {
      provider: "gitlab",
      domain: "gitlab.example.com/group/subgroup",
      url: "https://gitlab.example.com/group/subgroup/project/-/issues/7",
      canonical: "https://gitlab.example.com/group/subgroup/project/-/issues/7",
      body: { externalIssue: "group/subgroup/project#7" },
    },
    {
      provider: "bitbucket",
      domain: "bitbucket.org/workspace",
      url: "https://bitbucket.org/workspace/repo/issues/7/a-title",
      canonical: "https://bitbucket.org/workspace/repo/issues/7",
      body: { repo: "workspace/repo", externalIssue: "7" },
    },
    {
      provider: "bitbucket",
      domain: "username",
      url: "https://bitbucket.org/username/commits/issues/7",
      canonical: "https://bitbucket.org/username/commits/issues/7",
      body: { repo: "username/commits", externalIssue: "7" },
    },
    {
      provider: "vsts",
      domain: "https://example.visualstudio.com",
      url: "https://dev.azure.com/example/project/_workitems/edit/7",
      canonical: "https://example.visualstudio.com/_workitems/edit/7",
      body: { externalIssue: "7" },
    },
    {
      provider: "vsts",
      domain: "https://dev.azure.com/example",
      url: "https://example.visualstudio.com/project/_workitems/edit/7",
      canonical: "https://dev.azure.com/example/_workitems/edit/7",
      body: { externalIssue: "7" },
    },
  ])("prepares $provider without creating or commenting", async (fixture) => {
    const requests = mockApi((request) => {
      expect(new URL(request.url).pathname).toBe(INTEGRATIONS);
      expect(new URL(request.url).origin).toBe(REGION);
      expect(request.cache).toBe("no-store");
      expect(request.method).toBe("GET");
      return json([integration(fixture.provider, fixture.domain)]);
    });

    const prepared = await resolveNativeIssueLink({
      ...SOURCE,
      url: fixture.url,
    });

    expect(prepared).toMatchObject({
      ...SOURCE,
      regionUrl: REGION,
      integrationId: "10",
      provider: fixture.provider,
      url: fixture.canonical,
      body: fixture.body,
    });
    expect(prepared.existing).toBeUndefined();
    expect(requests).toHaveLength(1);
  });

  test.each([
    { provider: "github", host: "github.com" },
    { provider: "github_enterprise", host: "github.example.com" },
  ])("matches the registered $provider installation and spelling", async ({
    provider,
    host,
  }) => {
    const requests = mockApi((request) => {
      const { pathname } = new URL(request.url);
      expect(request.method).toBe("GET");
      if (pathname === INTEGRATIONS) {
        return json([
          integration(provider, `${host}/owner`, "10"),
          integration(provider, `${host}/owner`, "20"),
        ]);
      }
      expect(pathname).toBe(REPOSITORIES);
      return json([repository("Owner/Repo", "20")]);
    });

    const prepared = await resolveNativeIssueLink({
      ...SOURCE,
      url: `https://${host}/OWNER/repo/issues/7`,
    });

    expect(prepared).toMatchObject({
      integrationId: "20",
      body: { repo: "Owner/Repo", externalIssue: "7" },
      url: `https://${host}/Owner/Repo/issues/7`,
    });
    expect(requests).toHaveLength(2);
  });

  test("does not select GitHub repositories absent from the installation", async () => {
    mockApi((request) =>
      json(
        new URL(request.url).pathname === INTEGRATIONS
          ? [integration("github", "github.com/owner")]
          : [repository("owner/repo", "20")]
      )
    );
    await expect(
      resolveNativeIssueLink({
        ...SOURCE,
        url: "https://github.com/owner/repo/issues/7",
      })
    ).rejects.toThrow("No installed native");
  });

  test.each([
    { name: "non-array page", data: {} },
    {
      name: "missing link array",
      data: [{ ...integration(), externalIssues: undefined }],
    },
    {
      name: "invalid link record",
      data: [{ ...integration(), externalIssues: [{}] }],
    },
  ])("rejects an invalid integration response: $name", async ({ data }) => {
    const requests = mockApi(() => json(data));
    await expect(
      resolveNativeIssueLink({ ...SOURCE, url: JIRA_URL }).then(linkNativeIssue)
    ).rejects.toBeInstanceOf(ApiError);
    expect(requests.map((request) => request.method)).toEqual(["GET"]);
  });

  test.each([
    { name: "empty 204", response: () => new Response(null, { status: 204 }) },
    { name: "non-array page", response: () => json({}) },
    {
      name: "invalid repository",
      response: () => json([{ ...repository("owner/repo", "10"), name: 42 }]),
    },
  ])("rejects an invalid SDK repository response: $name", async ({
    response,
  }) => {
    const requests = mockApi((request) =>
      new URL(request.url).pathname === INTEGRATIONS
        ? json([integration("github", "github.com/owner")])
        : response()
    );
    await expect(
      resolveNativeIssueLink({
        ...SOURCE,
        url: "https://github.com/owner/repo/issues/7",
      }).then(linkNativeIssue)
    ).rejects.toBeInstanceOf(ApiError);
    expect(requests.map((request) => request.method)).toEqual(["GET", "GET"]);
  });

  test("preserves repository pagination and provider body fields through the SDK", async () => {
    const githubLink = {
      ...LINK,
      provider: "github",
      key: "owner/repo#7",
      url: "https://github.com/owner/repo/issues/7",
    };
    const requests = mockApi(async (request) => {
      const url = new URL(request.url);
      expect(url.origin).toBe(REGION);
      expect(request.cache).toBe("no-store");
      if (request.method === "PUT") {
        expect(url.pathname).toBe(`${INTEGRATIONS}10/`);
        expect(await request.json()).toEqual({
          repo: "owner/repo",
          externalIssue: "7",
        });
        return json({ ...githubLink, id: 1234, integrationId: 10 });
      }
      expect(request.method).toBe("GET");
      if (url.pathname === INTEGRATIONS) {
        return json([integration("github", "github.com/owner")]);
      }
      expect(url.pathname).toBe(REPOSITORIES);
      expect(url.searchParams.get("per_page")).toBe("100");
      if (!url.searchParams.has("cursor")) {
        return json([], {
          Link: '<https://eu.sentry.io/ignored>; rel="next"; results="true"; cursor="second"',
        });
      }
      expect(url.searchParams.get("cursor")).toBe("second");
      return json([repository("owner/repo", "10")]);
    });

    const prepared = await resolveNativeIssueLink({
      ...SOURCE,
      url: githubLink.url,
    });
    expect(await linkNativeIssue(prepared)).toEqual({
      link: githubLink,
      changed: true,
    });
    expect(requests).toHaveLength(4);
  });

  test("fetches all integration pages before deciding the link is absent", async () => {
    const requests = mockApi((request) => {
      const url = new URL(request.url);
      expect(url.pathname).toBe(INTEGRATIONS);
      expect(url.searchParams.get("per_page")).toBe("100");
      if (!url.searchParams.has("cursor")) {
        return json([integration("jira", "other.example.com")], {
          Link: '<https://eu.sentry.io/ignored>; rel="next"; results="true"; cursor="second"',
        });
      }
      expect(url.searchParams.get("cursor")).toBe("second");
      return json([
        integration("jira", "tracker.example.com", "20", [
          { ...LINK, integrationId: "20" },
        ]),
      ]);
    });

    const prepared = await resolveNativeIssueLink({ ...SOURCE, url: JIRA_URL });
    expect(prepared.existing?.id).toBe(LINK.id);
    expect(prepared.integrationId).toBe("20");
    expect(requests).toHaveLength(2);
  });

  test("fresh duplicate preflight prevents PUT", async () => {
    const requests = mockApi((request) => {
      expect(request.method).toBe("GET");
      return json([integration("jira", "tracker.example.com", "10", [LINK])]);
    });

    const prepared = await resolveNativeIssueLink({ ...SOURCE, url: JIRA_URL });
    expect(await linkNativeIssue(prepared)).toEqual({
      link: LINK,
      changed: false,
    });
    expect(requests).toHaveLength(1);
  });

  test("PUT sends the existing key without a comment and reads bypass stale cache", async () => {
    const requests = mockApi(async (request) => {
      expect(new URL(request.url).origin).toBe(REGION);
      expect(request.cache).toBe("no-store");
      if (request.method === "PUT") {
        expect(new URL(request.url).pathname).toBe(`${INTEGRATIONS}10/`);
        expect(await request.json()).toEqual({ externalIssue: "PROJ-7" });
        return json({ ...LINK, id: 1234, integrationId: 10 });
      }
      expect(request.method).toBe("GET");
      return json([integration()]);
    });

    await listNativeIssueLinks(SOURCE.orgSlug, SOURCE.issueId);
    const prepared = await resolveNativeIssueLink({ ...SOURCE, url: JIRA_URL });
    expect(await linkNativeIssue(prepared)).toEqual({
      link: LINK,
      changed: true,
    });
    expect(requests.map((request) => request.method)).toEqual([
      "GET",
      "GET",
      "PUT",
    ]);
  });

  test.each([
    { name: "empty 204", response: () => new Response(null, { status: 204 }) },
    { name: "empty object", response: () => json({}) },
    { name: "invalid numeric IDs", response: () => json(LINK) },
  ])("does not report success for an invalid SDK mutation response: $name", async ({
    response,
  }) => {
    const requests = mockApi((request) =>
      request.method === "GET" ? json([integration()]) : response()
    );
    const prepared = await resolveNativeIssueLink({ ...SOURCE, url: JIRA_URL });
    const mutation = linkNativeIssue(prepared);
    await expect(mutation).rejects.toBeInstanceOf(ApiError);
    await expect(mutation).rejects.toThrow(
      "inspect the current links before retrying"
    );
    expect(requests.map((request) => request.method)).toEqual(["GET", "PUT"]);
  });

  test.each([
    "PUT",
    "DELETE",
  ])("does not retry failed %s mutations", async (method) => {
    const requests = mockApi((request) => {
      if (request.method === "GET") {
        return json([integration()]);
      }
      expect(request.method).toBe(method);
      return new Response(JSON.stringify({ detail: "Temporary error" }), {
        status: 503,
      });
    });
    const prepared = await resolveNativeIssueLink({ ...SOURCE, url: JIRA_URL });
    const mutation =
      method === "PUT"
        ? linkNativeIssue(prepared)
        : unlinkNativeIssueLink(SOURCE.orgSlug, SOURCE.issueId, LINK);
    await expect(mutation).rejects.toThrow();
    expect(
      requests.filter((request) => request.method === method)
    ).toHaveLength(1);
  });

  test("DELETE uses Sentry's ExternalIssue ID and accepts an empty 204 response", async () => {
    const requests = mockApi((request) => {
      const url = new URL(request.url);
      expect(url.origin).toBe(REGION);
      expect(request.cache).toBe("no-store");
      expect(request.method).toBe("DELETE");
      expect(url.pathname).toBe(`${INTEGRATIONS}10/`);
      expect(url.searchParams.get("externalIssue")).toBe("1234");
      return new Response(null, { status: 204 });
    });
    await unlinkNativeIssueLink(SOURCE.orgSlug, SOURCE.issueId, LINK);
    expect(requests).toHaveLength(1);
  });

  test("lists and unlinks an existing issue whose title is null", async () => {
    const requests = mockApi((request) => {
      if (request.method === "GET") {
        return json([
          { ...integration(), externalIssues: [{ ...LINK, title: null }] },
        ]);
      }
      expect(request.method).toBe("DELETE");
      expect(new URL(request.url).searchParams.get("externalIssue")).toBe(
        "1234"
      );
      return new Response(null, { status: 204 });
    });
    const link = findNativeIssueLink(
      await listNativeIssueLinks(SOURCE.orgSlug, SOURCE.issueId),
      JIRA_URL
    );
    expect(link).toEqual({ ...LINK, title: undefined });
    if (!link) {
      throw new Error("Expected the existing external issue link");
    }
    await unlinkNativeIssueLink(SOURCE.orgSlug, SOURCE.issueId, link);
    expect(requests.map((request) => request.method)).toEqual([
      "GET",
      "DELETE",
    ]);
  });

  test("rejects an unlink ID that the SDK numeric query cannot represent exactly", async () => {
    const requests = mockApi(() => new Response(null, { status: 204 }));
    await expect(
      unlinkNativeIssueLink(SOURCE.orgSlug, SOURCE.issueId, {
        ...LINK,
        id: "9007199254740993",
      })
    ).rejects.toThrow("safe positive integer");
    expect(requests).toHaveLength(0);
  });

  test("requires integration selection when multiple Jira installations match", async () => {
    mockApi(() =>
      json([integration(), integration("jira", "tracker.example.com", "20")])
    );
    await expect(
      resolveNativeIssueLink({ ...SOURCE, url: JIRA_URL })
    ).rejects.toThrow("--integration");
    const prepared = await resolveNativeIssueLink({
      ...SOURCE,
      url: JIRA_URL,
      integrationId: "20",
    });
    expect(prepared.integrationId).toBe("20");
  });

  test.each([
    {
      provider: "gitlab",
      domain: "gitlab.example.com/team",
      url: "https://gitlab.example.com/another/repo/issues/7",
    },
    {
      provider: "jira",
      domain: "https://tracker.example.com/jira",
      url: JIRA_URL,
    },
    {
      provider: "vsts",
      domain: "https://dev.azure.com/example",
      url: "https://dev.azure.com/another/project/_workitems/edit/7",
    },
    {
      provider: "bitbucket",
      domain: "bitbucket.org/team",
      url: "https://bitbucket.org/another/repo/issues/7",
    },
  ])("rejects a URL outside the $provider installation", async ({
    provider,
    domain,
    url,
  }) => {
    mockApi(() => json([integration(provider, domain)]));
    await expect(resolveNativeIssueLink({ ...SOURCE, url })).rejects.toThrow(
      "No installed native"
    );
  });

  test.each([
    "https://github.com/owner/repo/pull/7",
    "https://gitlab.com/owner/repo/-/merge_requests/7",
    "https://github.com/owner/repo/commit/abcdef",
    "https://username:secret@tracker.example.com/browse/PROJ-7",
    "javascript:alert(1)",
    "PROJ-7",
  ])("rejects unsupported input before API calls: %s", async (url) => {
    const requests = mockApi(() => json([]));
    await expect(resolveNativeIssueLink({ ...SOURCE, url })).rejects.toThrow();
    expect(requests).toHaveLength(0);
  });
});

describe("findNativeIssueLink", () => {
  test.each([
    {
      provider: "jira",
      existing: JIRA_URL,
      target: `${JIRA_URL.toLowerCase()}/?source=cli#details`,
    },
    {
      provider: "gitlab",
      existing: "https://gitlab.com/group/repo/issues/7",
      target: "https://gitlab.com/group/repo/-/issues/7",
    },
    {
      provider: "github",
      existing: "https://github.com/owner/repo/issues/7",
      target: "https://github.com/OWNER/Repo/issues/7/",
    },
    {
      provider: "bitbucket",
      existing: "https://bitbucket.org/owner/repo/issues/7/a-title",
      target: "https://bitbucket.org/owner/repo/issues/7",
    },
    {
      provider: "vsts",
      existing: "https://example.visualstudio.com/_workitems/edit/7",
      target: "https://dev.azure.com/example/project/_workitems/edit/7",
    },
  ])("matches $provider using stored metadata alone", ({
    provider,
    existing,
    target,
  }) => {
    const link = { ...LINK, provider, url: existing };
    expect(findNativeIssueLink([link], target)).toBe(link);
  });

  test("rejects ambiguous links and accepts an integration selector", () => {
    const second = { ...LINK, id: "5678", integrationId: "20" };
    expect(() => findNativeIssueLink([LINK, second], JIRA_URL)).toThrow(
      "--integration"
    );
    expect(findNativeIssueLink([LINK, second], JIRA_URL, "20")).toBe(second);
  });

  test("never equates invalid URLs just because both lack a parsed issue key", () => {
    const link = {
      ...LINK,
      provider: "github",
      url: "https://github.com/owner/repo/pull/7",
    };
    expect(
      findNativeIssueLink([link], "https://github.com/owner/repo/pull/8")
    ).toBeUndefined();
    expect(
      findNativeIssueLink([LINK], "https://other.example.com/browse/PROJ-7")
    ).toBeUndefined();
  });
});
