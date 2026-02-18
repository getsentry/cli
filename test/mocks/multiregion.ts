/**
 * Multi-Region Mock Server for E2E Tests
 *
 * Creates a control silo and multiple region servers to test multi-region
 * functionality. The control silo handles auth and returns region URLs,
 * while each region server handles org-specific data.
 */

import methodNotAllowedFixture from "../fixtures/errors/method-not-allowed.json";
import notFoundFixture from "../fixtures/errors/not-found.json";
import euIssuesFixture from "../fixtures/regions/eu/issues.json";
import euOrganizationsFixture from "../fixtures/regions/eu/organizations.json";
import euProjectsFixture from "../fixtures/regions/eu/projects.json";
import usIssuesFixture from "../fixtures/regions/us/issues.json";
import usOrganizationsFixture from "../fixtures/regions/us/organizations.json";
import usProjectsFixture from "../fixtures/regions/us/projects.json";
import userFixture from "../fixtures/user.json";

import type { MockRoute, MockServer } from "./server.js";
import { createMockServer } from "./server.js";

export const TEST_TOKEN = "test-auth-token-12345";

/** US region organization slugs */
export const US_ORGS = ["acme-corp", "widgets-inc"] as const;

/** EU region organization slugs */
export const EU_ORGS = ["euro-gmbh", "berlin-startup"] as const;

/** US region project slugs by org */
export const US_PROJECTS: Record<string, string[]> = {
  "acme-corp": ["acme-frontend", "acme-backend"],
  "widgets-inc": ["widgets-app"],
};

/** EU region project slugs by org */
export const EU_PROJECTS: Record<string, string[]> = {
  "euro-gmbh": ["euro-portal", "euro-api"],
  "berlin-startup": ["berlin-app"],
};

type MultiRegionOptions = {
  /** If true, control silo returns 404 for /users/me/regions/ (self-hosted mode) */
  selfHostedMode?: boolean;
  /** If true, only return the US region (single-region mode) */
  singleRegionMode?: boolean;
};

/**
 * Creates routes for a region server.
 */
function createRegionRoutes(
  organizationsFixture: unknown[],
  projectsFixture: unknown[],
  issuesFixture: unknown[],
  orgSlugs: readonly string[]
): MockRoute[] {
  const orgSet = new Set(orgSlugs);
  const projectsByOrg = new Map<string, unknown[]>();
  const issuesByProject = new Map<string, unknown[]>();

  // Group projects by org
  for (const project of projectsFixture as Array<{
    organization?: { slug: string };
    slug: string;
  }>) {
    const orgSlug = project.organization?.slug;
    if (orgSlug) {
      if (!projectsByOrg.has(orgSlug)) {
        projectsByOrg.set(orgSlug, []);
      }
      projectsByOrg.get(orgSlug)!.push(project);
    }
  }

  // Group issues by project
  for (const issue of issuesFixture as Array<{ project?: { slug: string } }>) {
    const projectSlug = issue.project?.slug;
    if (projectSlug) {
      if (!issuesByProject.has(projectSlug)) {
        issuesByProject.set(projectSlug, []);
      }
      issuesByProject.get(projectSlug)!.push(issue);
    }
  }

  return [
    // Organizations list
    {
      method: "GET",
      path: "/api/0/organizations/",
      response: organizationsFixture,
    },
    // Organization detail
    {
      method: "GET",
      path: "/api/0/organizations/:orgSlug/",
      response: (_req, params) => {
        if (orgSet.has(params.orgSlug)) {
          const org = (organizationsFixture as Array<{ slug: string }>).find(
            (o) => o.slug === params.orgSlug
          );
          if (org) {
            return { body: org };
          }
        }
        return { status: 404, body: notFoundFixture };
      },
    },
    // Projects list for org
    {
      method: "GET",
      path: "/api/0/organizations/:orgSlug/projects/",
      response: (_req, params) => {
        if (orgSet.has(params.orgSlug)) {
          const projects = projectsByOrg.get(params.orgSlug) ?? [];
          return { body: projects };
        }
        return { status: 404, body: notFoundFixture };
      },
    },
    // All projects (used by findProjectByDsnKey)
    {
      method: "GET",
      path: "/api/0/projects/",
      response: projectsFixture,
    },
    // Project detail
    {
      method: "GET",
      path: "/api/0/projects/:orgSlug/:projectSlug/",
      response: (_req, params) => {
        if (orgSet.has(params.orgSlug)) {
          const projects = projectsByOrg.get(params.orgSlug) ?? [];
          const project = (projects as Array<{ slug: string }>).find(
            (p) => p.slug === params.projectSlug
          );
          if (project) {
            return { body: project };
          }
        }
        return { status: 404, body: notFoundFixture };
      },
    },
    // Issues list (org-scoped endpoint used by @sentry/api SDK)
    // Filters by project slug from the "query" search param (e.g., query=project:my-project)
    {
      method: "GET",
      path: "/api/0/organizations/:orgSlug/issues/",
      response: (req, params) => {
        if (orgSet.has(params.orgSlug)) {
          const url = new URL(req.url);
          const query = url.searchParams.get("query") ?? "";
          const projectMatch = query.match(/project:(\S+)/);
          const projectSlug = projectMatch?.[1];
          if (projectSlug) {
            const issues = issuesByProject.get(projectSlug) ?? [];
            return { body: issues };
          }
          // No project filter: return all issues for all projects in this org
          const orgProjects = projectsByOrg.get(params.orgSlug) ?? [];
          const allIssues = (orgProjects as Array<{ slug: string }>).flatMap(
            (p) => issuesByProject.get(p.slug) ?? []
          );
          return { body: allIssues };
        }
        return { status: 404, body: notFoundFixture };
      },
    },
    // Issues list (legacy project-scoped endpoint)
    {
      method: "GET",
      path: "/api/0/projects/:orgSlug/:projectSlug/issues/",
      response: (_req, params) => {
        if (orgSet.has(params.orgSlug)) {
          const issues = issuesByProject.get(params.projectSlug) ?? [];
          return { body: issues };
        }
        return { status: 404, body: notFoundFixture };
      },
    },
    // Prevent accidental mutations
    {
      method: "DELETE",
      path: "/api/0/organizations/",
      response: methodNotAllowedFixture,
      status: 405,
    },
    {
      method: "POST",
      path: "/api/0/organizations/",
      response: methodNotAllowedFixture,
      status: 405,
    },
  ];
}

/**
 * Creates routes for the control silo server.
 */
function createControlSiloRoutes(
  usRegionUrl: string,
  euRegionUrl: string,
  options: MultiRegionOptions
): MockRoute[] {
  const routes: MockRoute[] = [
    // User info (always available on control silo)
    {
      method: "GET",
      path: "/api/0/users/me/",
      response: userFixture,
    },
  ];

  if (options.selfHostedMode) {
    // Self-hosted mode: regions endpoint returns 404
    routes.push({
      method: "GET",
      path: "/api/0/users/me/regions/",
      response: notFoundFixture,
      status: 404,
    });

    // In self-hosted mode, control silo also serves organizations directly
    routes.push({
      method: "GET",
      path: "/api/0/organizations/",
      response: usOrganizationsFixture,
    });
  } else if (options.singleRegionMode) {
    // Single region mode: only return US region
    routes.push({
      method: "GET",
      path: "/api/0/users/me/regions/",
      response: {
        regions: [{ name: "us", url: usRegionUrl }],
      },
    });
  } else {
    // Multi-region mode: return both regions
    routes.push({
      method: "GET",
      path: "/api/0/users/me/regions/",
      response: {
        regions: [
          { name: "us", url: usRegionUrl },
          { name: "de", url: euRegionUrl },
        ],
      },
    });
  }

  return routes;
}

export type MultiRegionMockServer = {
  /** Control silo server (handles auth, user info, region discovery) */
  readonly controlSilo: MockServer;
  /** US region server */
  readonly usRegion: MockServer;
  /** EU region server */
  readonly euRegion: MockServer;
  /** URL to use as SENTRY_URL (points to control silo) */
  readonly url: string;
  /** Start all servers */
  start(): Promise<void>;
  /** Stop all servers */
  stop(): void;
};

/**
 * Create a multi-region mock server setup for E2E tests.
 *
 * @param options - Configuration options
 * @returns Multi-region mock server instance
 */
export function createMultiRegionMockServer(
  options: MultiRegionOptions = {}
): MultiRegionMockServer {
  // Create region servers first (we need their URLs for control silo)
  const usRegion = createMockServer(
    createRegionRoutes(
      usOrganizationsFixture,
      usProjectsFixture,
      usIssuesFixture,
      US_ORGS
    ),
    { validTokens: [TEST_TOKEN] }
  );

  const euRegion = createMockServer(
    createRegionRoutes(
      euOrganizationsFixture,
      euProjectsFixture,
      euIssuesFixture,
      EU_ORGS
    ),
    { validTokens: [TEST_TOKEN] }
  );

  // Control silo needs region URLs, but they're not available until servers start
  // So we create a wrapper that initializes control silo routes after region servers start
  let controlSilo: MockServer | null = null;

  return {
    get controlSilo() {
      if (!controlSilo) {
        throw new Error("Control silo not initialized. Call start() first.");
      }
      return controlSilo;
    },
    get usRegion() {
      return usRegion;
    },
    get euRegion() {
      return euRegion;
    },
    get url() {
      if (!controlSilo) {
        throw new Error("Control silo not initialized. Call start() first.");
      }
      return controlSilo.url;
    },

    async start() {
      // Start region servers first to get their URLs
      await usRegion.start();
      await euRegion.start();

      // Now create control silo with actual region URLs
      const controlRoutes = createControlSiloRoutes(
        usRegion.url,
        euRegion.url,
        options
      );
      controlSilo = createMockServer(controlRoutes, {
        validTokens: [TEST_TOKEN],
      });
      await controlSilo.start();
    },

    stop() {
      controlSilo?.stop();
      usRegion.stop();
      euRegion.stop();
    },
  };
}
