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
import {
  linkExternalIssue,
  unlinkExternalIssue,
} from "../../../src/lib/issue-links.js";
import { mockFetch, useTestConfigDir } from "../../helpers.js";

const REGION = "https://eu.sentry.io";
const INTEGRATIONS = "/api/0/organizations/test-org/issues/42/integrations/";
const SOURCE = { orgSlug: "test-org", issueId: "42" };
const JIRA_URL = "https://tracker.example.com/browse/PROJ-7";
const LINK: NativeIssueLink = {
  id: "1234",
  integrationId: "10",
  provider: "jira",
  key: "PROJ-7",
  url: JIRA_URL,
  displayName: "PROJ-7",
};

function integration(
  provider = "jira",
  domainName: string | null = "tracker.example.com",
  id = "10",
  externalIssues: NativeIssueLink[] = []
) {
  return {
    id,
    name: `Example ${provider}`,
    domainName,
    icon: null,
    accountType: null,
    scopes: null,
    outOfDate: null,
    missingFeatures: null,
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
    externalIssues: externalIssues.map((link) => ({
      ...link,
      title: link.title ?? null,
      description: null,
    })),
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
      url: JIRA_URL.toLowerCase(),
      canonical: JIRA_URL,
    },
    {
      provider: "jira_server",
      domain: "tracker.example.com",
      url: "https://tracker.example.com/jira/browse/PROJ-7",
      canonical: "https://tracker.example.com/jira/browse/PROJ-7",
    },
    {
      provider: "gitlab",
      domain: "gitlab.example.com/group/subgroup",
      url: "https://gitlab.example.com/group/subgroup/project/-/issues/7",
      canonical: "https://gitlab.example.com/group/subgroup/project/-/issues/7",
    },
    {
      provider: "gitlab",
      domain: "gitlab.example.com/group/subgroup",
      url: "https://gitlab.example.com/group/subgroup/pull/-/issues/7",
      canonical: "https://gitlab.example.com/group/subgroup/pull/-/issues/7",
    },
    {
      provider: "gitlab",
      domain: "gitlab.example.com",
      url: "https://gitlab.example.com/gitlab/group/project/issues/7",
      canonical: "https://gitlab.example.com/gitlab/group/project/-/issues/7",
    },
    {
      provider: "gitlab",
      domain: "gitlab.example.com/group/subgroup",
      url: "https://gitlab.example.com/services/gitlab/group/subgroup/project/-/issues/7",
      canonical:
        "https://gitlab.example.com/services/gitlab/group/subgroup/project/-/issues/7",
    },
    {
      provider: "bitbucket",
      domain: "bitbucket.org/workspace",
      url: "https://bitbucket.org/workspace/repo/issues/7/a-title",
      canonical: "https://bitbucket.org/workspace/repo/issues/7",
    },
    {
      provider: "bitbucket",
      domain: "username",
      url: "https://bitbucket.org/username/commits/issues/7",
      canonical: "https://bitbucket.org/username/commits/issues/7",
    },
    {
      provider: "vsts",
      domain: "https://example.visualstudio.com",
      url: "https://dev.azure.com/example/project/_workitems/edit/7",
      canonical: "https://dev.azure.com/example/project/_workitems/edit/7",
    },
    {
      provider: "vsts",
      domain: "https://dev.azure.com/example",
      url: "https://example.visualstudio.com/project/_workitems/edit/7",
      canonical: "https://example.visualstudio.com/project/_workitems/edit/7",
    },
    ...["github", "github_enterprise"].flatMap((provider) =>
      ["issues", "pull"].map((path) => ({
        provider,
        domain: `${provider === "github" ? "github.com" : "github.example.com"}/owner`,
        url: `https://${provider === "github" ? "github.com" : "github.example.com"}/OWNER/repo/${path}/7`,
        canonical: `https://${provider === "github" ? "github.com" : "github.example.com"}/OWNER/repo/${path}/7`,
      }))
    ),
  ])("links $provider using the URL without repository discovery or a comment", async (fixture) => {
    const requests = mockApi(async (request) => {
      const url = new URL(request.url);
      expect(url.origin).toBe(REGION);
      expect(request.cache).toBe("no-store");
      if (request.method === "PUT") {
        expect(url.pathname).toBe(`${INTEGRATIONS}10/`);
        expect(await request.json()).toEqual({
          externalIssue: fixture.url,
        });
        return Response.json(
          { ...LINK, id: 1234, integrationId: 10, url: fixture.canonical },
          { status: 201 }
        );
      }
      expect(request.method).toBe("GET");
      expect(url.pathname).toBe(INTEGRATIONS);
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
      url: fixture.url,
    });
    expect(prepared.existing).toBeUndefined();
    expect(requests).toHaveLength(1);
    expect(await linkNativeIssue(prepared)).toMatchObject({
      changed: true,
      link: { url: fixture.canonical },
    });
    expect(requests.map((request) => request.method)).toEqual(["GET", "PUT"]);
  });

  test.each([
    { provider: "github", host: "github.com" },
    { provider: "github_enterprise", host: "github.example.com" },
  ])("links, recognizes and unlinks a $provider PR across both URL forms", async ({
    provider,
    host,
  }) => {
    const pullUrl = `https://${host}/Owner/Repo/pull/7`;
    const issueUrl = `https://${host}/Owner/Repo/issues/7`;
    const storedLink = {
      ...LINK,
      provider,
      key: "Owner/Repo#7",
      displayName: "Owner/Repo#7",
      url: issueUrl,
    };
    let linked = false;
    const submittedUrls: unknown[] = [];
    const requests = mockApi(async (request) => {
      const url = new URL(request.url);
      expect(url.origin).toBe(REGION);
      expect(request.cache).toBe("no-store");
      if (request.method === "PUT") {
        expect(url.pathname).toBe(`${INTEGRATIONS}10/`);
        const body = await request.json();
        expect(Object.keys(body)).toEqual(["externalIssue"]);
        submittedUrls.push(body.externalIssue);
        const status = linked ? 200 : 201;
        linked = true;
        // The mutation uses GitHub's html_url; listing reconstructs /issues/N.
        return Response.json(
          { ...storedLink, id: 1234, integrationId: 10, url: pullUrl },
          { status }
        );
      }
      if (request.method === "DELETE") {
        expect(url.pathname).toBe(`${INTEGRATIONS}10/`);
        expect(url.searchParams.get("externalIssue")).toBe("1234");
        linked = false;
        return new Response(null, { status: 204 });
      }
      expect(request.method).toBe("GET");
      if (url.pathname === INTEGRATIONS) {
        return json([
          integration(
            provider,
            `${host}/owner`,
            "10",
            linked ? [storedLink] : []
          ),
        ]);
      }
      throw new Error(`Unexpected request: ${request.url}`);
    });

    const options = {
      ...SOURCE,
      url: `https://${host}/OWNER/repo/pull/7/files?source=cli#diff`,
    };
    expect(await linkExternalIssue(options)).toMatchObject({
      linked: true,
      changed: true,
      externalIssue: { id: "1234", identifier: "Owner/Repo#7", url: pullUrl },
    });
    for (const url of [pullUrl, issueUrl]) {
      expect(await linkExternalIssue({ ...SOURCE, url })).toMatchObject({
        linked: true,
        changed: false,
        externalIssue: { id: "1234" },
      });
    }
    expect(
      await unlinkExternalIssue({ ...options, dryRun: true })
    ).toMatchObject({
      linked: true,
      changed: false,
      dryRun: true,
    });
    expect(await unlinkExternalIssue(options)).toMatchObject({
      linked: false,
      changed: true,
      externalIssue: { id: "1234" },
    });
    expect(await unlinkExternalIssue(options)).toMatchObject({
      linked: false,
      changed: false,
    });
    expect(
      requests
        .filter((request) => request.method !== "GET")
        .map((request) => request.method)
    ).toEqual(["PUT", "PUT", "PUT", "DELETE"]);
    expect(submittedUrls).toEqual([
      `https://${host}/OWNER/repo/pull/7/files?source=cli`,
      pullUrl,
      issueUrl,
    ]);
  });

  test("preserves the full query while stripping fragment and trailing slash", async () => {
    mockApi(() => json([integration()]));
    const prepared = await resolveNativeIssueLink({
      ...SOURCE,
      url: `${JIRA_URL}/?source=cli#details`,
    });
    expect(prepared.url).toBe(`${JIRA_URL}?source=cli`);
  });

  test.each([
    {
      domain: "tracker.example.com",
      url: "https://tracker.example.com/projects/PROJ/issues/PROJ-7",
      stored: JIRA_URL,
    },
    {
      domain: "tracker.example.com",
      url: "https://tracker.example.com/jira/software/projects/PROJ/boards/1?selectedIssue=PROJ-7&view=detail",
      stored: JIRA_URL,
    },
    {
      domain: "tracker.example.com/jira",
      url: "https://tracker.example.com/jira/secure/RapidBoard.jspa?rapidView=1&selectedIssue=PROJ-7",
      stored: "https://tracker.example.com/jira/browse/PROJ-7",
    },
    {
      domain: "tracker.example.com",
      url: "https://tracker.example.com/jira-archive/board?selectedIssue=PROJ-7",
      stored: JIRA_URL,
    },
    {
      domain: "tracker.example.com",
      url: "https://tracker.example.com/browse/PROJ-1?selectedIssue=invalid&selectedIssue=proj-7&selectedIssue=PROJ-1",
      stored: JIRA_URL,
    },
  ])("forwards Jira copy link $url and matches its stored browse alias", async ({
    domain,
    url,
    stored,
  }) => {
    const requests = mockApi(async (request) => {
      if (request.method === "GET")
        return json([integration("jira_server", domain)]);
      expect(await request.json()).toEqual({ externalIssue: url });
      return Response.json(
        { ...LINK, id: 1234, integrationId: 10, url: stored },
        { status: 201 }
      );
    });
    const prepared = await resolveNativeIssueLink({ ...SOURCE, url });
    expect(await linkNativeIssue(prepared)).toMatchObject({
      changed: true,
      link: { url: stored },
    });
    expect(
      findNativeIssueLink(
        [{ ...LINK, provider: "jira_server", url: stored }],
        url
      )?.id
    ).toBe(LINK.id);
    expect(requests).toHaveLength(2);
  });

  test("selects GitHub cloud installations with missing domain metadata by owner", async () => {
    mockApi(() => json([{ ...integration("github", null), name: "Owner" }]));
    expect(
      await resolveNativeIssueLink({
        ...SOURCE,
        url: "https://github.com/OWNER/repo/issues/7",
      })
    ).toMatchObject({ integrationId: "10" });
    await expect(
      resolveNativeIssueLink({
        ...SOURCE,
        url: "https://github.com/another/repo/issues/7",
      })
    ).rejects.toThrow("No installed native");
  });

  test("requires an explicit Enterprise installation when its host metadata is missing", async () => {
    mockApi(() =>
      json([{ ...integration("github_enterprise", null), name: "Owner" }])
    );
    const options = {
      ...SOURCE,
      url: "https://github.example.com/OWNER/repo/pull/7",
    };
    await expect(resolveNativeIssueLink(options)).rejects.toThrow(
      "--integration"
    );
    expect(
      await resolveNativeIssueLink({ ...options, integrationId: "10" })
    ).toMatchObject({ integrationId: "10", url: options.url });
  });

  test("requires a selector for GitLab installations sharing a host", async () => {
    mockApi(() =>
      json([
        integration("gitlab", "gitlab.example.com/group", "10"),
        integration("gitlab", "gitlab.example.com/another", "20"),
      ])
    );
    const options = {
      ...SOURCE,
      url: "https://gitlab.example.com/deployment/group/repo/-/issues/7",
    };
    await expect(resolveNativeIssueLink(options)).rejects.toThrow(
      "Multiple integrations"
    );
    expect(
      await resolveNativeIssueLink({ ...options, integrationId: "10" })
    ).toMatchObject({ integrationId: "10", url: options.url });
  });

  test("malformed stored URLs and domains do not block an unrelated valid association", async () => {
    const requests = mockApi((request) =>
      request.method === "PUT"
        ? json({ ...LINK, id: 1234, integrationId: 10 })
        : json([
            integration("jira", "https://", "20"),
            integration("vsts", "unrecognized.example.com", "30"),
            integration("jira", "tracker.example.com", "10", [
              { ...LINK, id: "999", url: "not a URL" },
              LINK,
            ]),
          ])
    );
    const prepared = await resolveNativeIssueLink({ ...SOURCE, url: JIRA_URL });
    expect(await linkNativeIssue(prepared)).toMatchObject({
      changed: false,
      link: LINK,
    });
    const links = await listNativeIssueLinks(SOURCE.orgSlug, SOURCE.issueId);
    expect(findNativeIssueLink(links, JIRA_URL)?.id).toBe(LINK.id);
    expect(requests.map((request) => request.method)).toEqual([
      "GET",
      "PUT",
      "GET",
    ]);
  });

  test.each([
    ["github", "github.com/owner", "https://github.com/owner/repo/issues/7"],
    [
      "github",
      "github.com/owner",
      "https://github.com/owner/repo/commit/abcdef",
    ],
    [
      "bitbucket",
      "bitbucket.org/owner",
      "https://bitbucket.org/owner/repo/pull-requests/7",
    ],
    [
      "gitlab",
      "gitlab.com/owner",
      "https://gitlab.com/owner/repo/-/merge_requests/7",
    ],
  ])("delegates %s URL and repository validation to the backend: %s %s", async (provider, domain, url) => {
    const requests = mockApi(async (request) => {
      if (request.method === "GET")
        return json([integration(provider, domain)]);
      expect(await request.json()).toEqual({ externalIssue: url });
      return Response.json(
        { detail: "Invalid provider reference" },
        { status: 400 }
      );
    });
    await expect(
      resolveNativeIssueLink({ ...SOURCE, url }).then(linkNativeIssue)
    ).rejects.toBeInstanceOf(ApiError);
    expect(requests.map((request) => request.method)).toEqual(["GET", "PUT"]);
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

  test.each([
    200, 201,
  ])("uses backend HTTP %i even when preflight found a link", async (status) => {
    const requests = mockApi((request) =>
      request.method === "GET"
        ? json([integration("jira", "tracker.example.com", "10", [LINK])])
        : Response.json({ ...LINK, id: 1234, integrationId: 10 }, { status })
    );
    const prepared = await resolveNativeIssueLink({ ...SOURCE, url: JIRA_URL });
    expect(prepared.existing).toEqual(LINK);
    // A concurrent unlink can remove the association after preflight.
    expect(await linkNativeIssue(prepared)).toEqual({
      link: LINK,
      changed: status === 201,
    });
    expect(requests.map((request) => request.method)).toEqual(["GET", "PUT"]);
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

  test("a concurrent PUT no-op uses the backend's 200 status", async () => {
    mockApi((request) =>
      request.method === "GET"
        ? json([integration()])
        : json({ ...LINK, id: 1234, integrationId: 10 })
    );
    const prepared = await resolveNativeIssueLink({ ...SOURCE, url: JIRA_URL });
    expect(prepared.existing).toBeUndefined();
    expect(await linkNativeIssue(prepared)).toEqual({
      link: LINK,
      changed: false,
    });
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

  test.each([
    "https://tracker.example.com/jira-archive/browse/PROJ-7",
    "https://tracker.example.com/other/projects/PROJ/issues/PROJ-7",
    "https://tracker.example.com/other/board?selectedIssue=PROJ-7",
    "https://other.example.com/jira/browse/PROJ-7",
  ])("does not match Jira aliases outside the stored context: %s", (target) => {
    expect(
      findNativeIssueLink(
        [
          {
            ...LINK,
            provider: "jira_server",
            url: "https://tracker.example.com/jira/browse/PROJ-7",
          },
        ],
        target
      )
    ).toBeUndefined();
  });

  test("a Jira sibling on the same host does not block an Enterprise issue match", () => {
    const enterprise = {
      ...LINK,
      id: "5678",
      provider: "github_enterprise",
      url: "https://tracker.example.com/owner/repo/issues/7",
    };
    expect(findNativeIssueLink([LINK, enterprise], enterprise.url)).toBe(
      enterprise
    );
  });

  test("rejects ambiguous links and accepts an integration selector", () => {
    const second = { ...LINK, id: "5678", integrationId: "20" };
    expect(() => findNativeIssueLink([LINK, second], JIRA_URL)).toThrow(
      "--integration"
    );
    expect(findNativeIssueLink([LINK, second], JIRA_URL, "20")).toBe(second);
  });

  test("distinguishes GitHub PR numbers, repositories and hosts", () => {
    const link = {
      ...LINK,
      provider: "github",
      url: "https://github.com/owner/repo/pull/7",
    };
    expect(
      findNativeIssueLink([link], "https://github.com/owner/repo/pull/8")
    ).toBeUndefined();
    expect(
      findNativeIssueLink([link], "https://github.com/owner/other/pull/7")
    ).toBeUndefined();
    expect(
      findNativeIssueLink([link], "https://other.example.com/owner/repo/pull/7")
    ).toBeUndefined();
  });

  test("never equates invalid URLs just because both lack a parsed issue key", () => {
    const link = {
      ...LINK,
      provider: "github",
      url: "https://github.com/owner/repo/commit/abc",
    };
    expect(
      findNativeIssueLink([link], "https://github.com/owner/repo/commit/def")
    ).toBeUndefined();
    expect(
      findNativeIssueLink([LINK], "https://other.example.com/browse/PROJ-7")
    ).toBeUndefined();
  });
});
