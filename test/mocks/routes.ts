/**
 * Mock API Routes for E2E Tests
 *
 * Defines all API routes and their responses using fixture data.
 * Routes are used by the mock server to simulate Sentry API responses.
 */

import methodNotAllowedFixture from "../fixtures/errors/method-not-allowed.json";
import notFoundFixture from "../fixtures/errors/not-found.json";
import eventFixture from "../fixtures/event.json";
import issueFixture from "../fixtures/issue.json";
import issuesFixture from "../fixtures/issues.json";
import organizationFixture from "../fixtures/organization.json";
import organizationsFixture from "../fixtures/organizations.json";
import projectFixture from "../fixtures/project.json";
import projectsFixture from "../fixtures/projects.json";
import type { MockRoute, MockServer } from "./server.js";
import { createMockServer } from "./server.js";

export const TEST_ORG = "test-org";
export const TEST_PROJECT = "test-project";
export const TEST_TOKEN = "test-auth-token-12345";
export const TEST_ISSUE_ID = "400001";
export const TEST_ISSUE_SHORT_ID = "TEST-PROJECT-1A";
export const TEST_EVENT_ID = "abc123def456abc123def456abc12345";
export const TEST_DSN = "https://abc123@o123.ingest.sentry.io/456789";

const projectKeysFixture = [
  {
    id: "key-123",
    name: "Default",
    dsn: {
      public: TEST_DSN,
      secret: "https://abc123:secret@o123.ingest.sentry.io/456789",
    },
    isActive: true,
    dateCreated: "2024-01-01T00:00:00.000Z",
  },
];

export const apiRoutes: MockRoute[] = [
  // Organizations
  {
    method: "GET",
    path: "/api/0/organizations/",
    response: organizationsFixture,
  },
  {
    method: "GET",
    path: "/api/0/organizations/:orgSlug/",
    response: (_req, params) => {
      if (params.orgSlug === TEST_ORG) {
        return { body: organizationFixture };
      }
      return { status: 404, body: notFoundFixture };
    },
  },
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

  // Projects
  {
    method: "GET",
    path: "/api/0/projects/",
    response: projectsFixture,
  },
  {
    method: "GET",
    path: "/api/0/organizations/:orgSlug/projects/",
    response: (_req, params) => {
      if (params.orgSlug === TEST_ORG) {
        return { body: projectsFixture };
      }
      return { status: 404, body: notFoundFixture };
    },
  },
  {
    method: "GET",
    path: "/api/0/projects/:orgSlug/:projectSlug/",
    response: (_req, params) => {
      if (params.orgSlug === TEST_ORG && params.projectSlug === TEST_PROJECT) {
        return { body: projectFixture };
      }
      return { status: 404, body: notFoundFixture };
    },
  },
  {
    method: "GET",
    path: "/api/0/projects/:orgSlug/:projectSlug/keys/",
    response: (_req, params) => {
      if (params.orgSlug === TEST_ORG && params.projectSlug === TEST_PROJECT) {
        return { body: projectKeysFixture };
      }
      return { status: 404, body: notFoundFixture };
    },
  },

  // Issues
  {
    method: "GET",
    path: "/api/0/projects/:orgSlug/:projectSlug/issues/",
    response: (_req, params) => {
      if (params.orgSlug === TEST_ORG && params.projectSlug === TEST_PROJECT) {
        return { body: issuesFixture };
      }
      return { status: 404, body: notFoundFixture };
    },
  },
  {
    method: "GET",
    path: "/api/0/issues/:issueId/",
    response: (_req, params) => {
      if (params.issueId === TEST_ISSUE_ID) {
        return { body: issueFixture };
      }
      return { status: 404, body: notFoundFixture };
    },
  },
  {
    method: "GET",
    path: "/api/0/organizations/:orgSlug/issues/:shortId/",
    response: (_req, params) => {
      if (
        params.orgSlug === TEST_ORG &&
        params.shortId.toUpperCase() === TEST_ISSUE_SHORT_ID
      ) {
        return { body: issueFixture };
      }
      return { status: 404, body: notFoundFixture };
    },
  },
  {
    method: "GET",
    path: "/api/0/organizations/:orgSlug/issues/:issueId/events/latest/",
    response: (_req, params) => {
      if (params.orgSlug === TEST_ORG && params.issueId === TEST_ISSUE_ID) {
        return { body: eventFixture };
      }
      return { status: 404, body: notFoundFixture };
    },
  },

  // Events
  {
    method: "GET",
    path: "/api/0/projects/:orgSlug/:projectSlug/events/:eventId/",
    response: (_req, params) => {
      if (
        params.orgSlug === TEST_ORG &&
        params.projectSlug === TEST_PROJECT &&
        params.eventId === TEST_EVENT_ID
      ) {
        return { body: eventFixture };
      }
      return { status: 404, body: notFoundFixture };
    },
  },
];

export function createSentryMockServer(): MockServer {
  return createMockServer(apiRoutes, { validTokens: [TEST_TOKEN] });
}
