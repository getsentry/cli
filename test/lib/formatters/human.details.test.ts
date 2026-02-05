/**
 * Tests for human formatter detail functions
 *
 * These tests cover formatters that display detailed information about
 * organizations, projects, and issues. They use mock data objects.
 */

import { describe, expect, test } from "bun:test";
import {
  calculateOrgSlugWidth,
  calculateProjectColumnWidths,
  formatIssueDetails,
  formatOrgDetails,
  formatOrgRow,
  formatProjectDetails,
  formatProjectRow,
} from "../../../src/lib/formatters/human.js";
import type {
  SentryIssue,
  SentryOrganization,
  SentryProject,
} from "../../../src/types/index.js";

// Helper to strip ANSI codes for content testing
function stripAnsi(str: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI codes use control chars
  return str.replace(/\x1b\[[0-9;]*m/g, "");
}

// Mock data factories

function createMockOrg(
  overrides: Partial<SentryOrganization> = {}
): SentryOrganization {
  return {
    id: "123",
    slug: "acme-corp",
    name: "Acme Corporation",
    dateCreated: "2024-01-01T00:00:00Z",
    require2FA: false,
    isEarlyAdopter: false,
    features: [],
    ...overrides,
  };
}

function createMockProject(
  overrides: Partial<SentryProject & { orgSlug?: string }> = {}
): SentryProject & { orgSlug?: string } {
  return {
    id: "456",
    slug: "frontend",
    name: "Frontend App",
    platform: "javascript",
    status: "active",
    dateCreated: "2024-01-01T00:00:00Z",
    hasSessions: true,
    hasReplays: false,
    hasProfiles: false,
    hasMonitors: false,
    features: [],
    ...overrides,
  };
}

function createMockIssue(overrides: Partial<SentryIssue> = {}): SentryIssue {
  return {
    id: "789",
    shortId: "FRONTEND-ABC",
    title: "TypeError: Cannot read property 'foo' of undefined",
    level: "error",
    status: "unresolved",
    count: "42",
    userCount: 10,
    firstSeen: "2024-01-01T00:00:00Z",
    lastSeen: "2024-01-15T12:30:00Z",
    permalink: "https://sentry.io/issues/789",
    ...overrides,
  };
}

// Organization Formatting Tests

describe("calculateOrgSlugWidth", () => {
  test("returns minimum width of 4 for empty array", () => {
    expect(calculateOrgSlugWidth([])).toBe(4);
  });

  test("returns max slug length when longer than minimum", () => {
    const orgs = [
      createMockOrg({ slug: "ab" }),
      createMockOrg({ slug: "longer-org-slug" }),
      createMockOrg({ slug: "medium" }),
    ];
    expect(calculateOrgSlugWidth(orgs)).toBe(15); // "longer-org-slug".length
  });

  test("returns minimum when all slugs are shorter", () => {
    const orgs = [createMockOrg({ slug: "ab" }), createMockOrg({ slug: "xy" })];
    expect(calculateOrgSlugWidth(orgs)).toBe(4); // minimum is 4
  });
});

describe("formatOrgRow", () => {
  test("formats organization row with padding", () => {
    const org = createMockOrg({ slug: "acme", name: "Acme Inc" });
    const result = formatOrgRow(org, 10);
    expect(result).toBe("acme        Acme Inc");
  });

  test("handles long slug correctly", () => {
    const org = createMockOrg({ slug: "very-long-org", name: "Test" });
    const result = formatOrgRow(org, 15);
    expect(result).toBe("very-long-org    Test");
  });
});

describe("formatOrgDetails", () => {
  test("formats basic organization details", () => {
    const org = createMockOrg({
      slug: "acme",
      name: "Acme Corp",
      id: "123",
      require2FA: true,
      isEarlyAdopter: true,
    });

    const lines = formatOrgDetails(org).map(stripAnsi);

    expect(lines[0]).toBe("acme: Acme Corp");
    expect(lines.some((l) => l.includes("Slug:       acme"))).toBe(true);
    expect(lines.some((l) => l.includes("Name:       Acme Corp"))).toBe(true);
    expect(lines.some((l) => l.includes("ID:         123"))).toBe(true);
    expect(lines.some((l) => l.includes("2FA:        Required"))).toBe(true);
    expect(lines.some((l) => l.includes("Early Adopter: Yes"))).toBe(true);
  });

  test("formats organization without 2FA", () => {
    const org = createMockOrg({ require2FA: false, isEarlyAdopter: false });
    const lines = formatOrgDetails(org).map(stripAnsi);

    expect(lines.some((l) => l.includes("2FA:        Not required"))).toBe(
      true
    );
    expect(lines.some((l) => l.includes("Early Adopter: No"))).toBe(true);
  });

  test("includes features when present", () => {
    const org = createMockOrg({
      features: ["feature-a", "feature-b", "feature-c"],
    });
    const lines = formatOrgDetails(org).map(stripAnsi);

    expect(lines.some((l) => l.includes("Features (3)"))).toBe(true);
    expect(lines.some((l) => l.includes("feature-a"))).toBe(true);
  });

  test("handles missing dateCreated", () => {
    const org = createMockOrg({ dateCreated: undefined });
    const lines = formatOrgDetails(org).map(stripAnsi);

    // Should not throw and should not include Created line
    expect(lines.some((l) => l.startsWith("Created:"))).toBe(false);
  });
});

// Project Formatting Tests

describe("calculateProjectColumnWidths", () => {
  test("returns minimum widths for empty array", () => {
    const result = calculateProjectColumnWidths([]);
    expect(result.orgWidth).toBe(3);
    expect(result.slugWidth).toBe(7);
    expect(result.nameWidth).toBe(4);
  });

  test("calculates widths based on content", () => {
    const projects = [
      createMockProject({
        orgSlug: "acme-corp",
        slug: "frontend-app",
        name: "Frontend Application",
      }),
      createMockProject({ orgSlug: "beta", slug: "api", name: "API" }),
    ];

    const result = calculateProjectColumnWidths(projects);

    expect(result.orgWidth).toBe(9); // "acme-corp".length
    expect(result.slugWidth).toBe(12); // "frontend-app".length
    expect(result.nameWidth).toBe(20); // "Frontend Application".length
  });

  test("handles missing orgSlug", () => {
    const projects = [
      createMockProject({ orgSlug: undefined, slug: "test", name: "Test" }),
    ];

    const result = calculateProjectColumnWidths(projects);
    expect(result.orgWidth).toBe(3); // minimum
  });
});

describe("formatProjectRow", () => {
  test("formats project row with all columns", () => {
    const project = createMockProject({
      orgSlug: "acme",
      slug: "frontend",
      name: "Frontend",
      platform: "javascript",
    });

    const result = formatProjectRow(project, {
      orgWidth: 8,
      slugWidth: 10,
      nameWidth: 10,
    });

    expect(result).toBe("acme      frontend    Frontend    javascript");
  });

  test("handles missing platform", () => {
    const project = createMockProject({
      orgSlug: "acme",
      slug: "api",
      name: "API",
      platform: undefined,
    });

    const result = formatProjectRow(project, {
      orgWidth: 5,
      slugWidth: 5,
      nameWidth: 5,
    });

    expect(result).toBe("acme   api    API    ");
  });

  test("handles missing orgSlug", () => {
    const project = createMockProject({
      orgSlug: undefined,
      slug: "test",
      name: "Test",
      platform: "python",
    });

    const result = formatProjectRow(project, {
      orgWidth: 5,
      slugWidth: 5,
      nameWidth: 5,
    });

    expect(result).toBe("       test   Test   python");
  });
});

describe("formatProjectDetails", () => {
  test("formats basic project details", () => {
    const project = createMockProject({
      slug: "frontend",
      name: "Frontend App",
      id: "456",
      platform: "javascript",
      status: "active",
    });

    const lines = formatProjectDetails(project).map(stripAnsi);

    expect(lines[0]).toBe("frontend: Frontend App");
    expect(lines.some((l) => l.includes("Slug:       frontend"))).toBe(true);
    expect(lines.some((l) => l.includes("Name:       Frontend App"))).toBe(
      true
    );
    expect(lines.some((l) => l.includes("ID:         456"))).toBe(true);
    expect(lines.some((l) => l.includes("Platform:   javascript"))).toBe(true);
    expect(lines.some((l) => l.includes("Status:     active"))).toBe(true);
  });

  test("includes DSN when provided", () => {
    const project = createMockProject();
    const dsn = "https://abc123@sentry.io/456";

    const lines = formatProjectDetails(project, dsn).map(stripAnsi);

    expect(lines.some((l) => l.includes(`DSN:        ${dsn}`))).toBe(true);
  });

  test("shows 'No DSN available' when DSN is null", () => {
    const project = createMockProject();

    const lines = formatProjectDetails(project, null).map(stripAnsi);

    expect(lines.some((l) => l.includes("DSN:        No DSN available"))).toBe(
      true
    );
  });

  test("includes organization context when present", () => {
    const project = createMockProject({
      organization: { slug: "acme", name: "Acme Corp" },
    });

    const lines = formatProjectDetails(project).map(stripAnsi);

    expect(
      lines.some((l) => l.includes("Organization: Acme Corp (acme)"))
    ).toBe(true);
  });

  test("includes capability flags", () => {
    const project = createMockProject({
      hasSessions: true,
      hasReplays: true,
      hasProfiles: false,
      hasMonitors: true,
    });

    const lines = formatProjectDetails(project).map(stripAnsi);

    expect(lines.some((l) => l.includes("Sessions:  Yes"))).toBe(true);
    expect(lines.some((l) => l.includes("Replays:   Yes"))).toBe(true);
    expect(lines.some((l) => l.includes("Profiles:  No"))).toBe(true);
    expect(lines.some((l) => l.includes("Monitors:  Yes"))).toBe(true);
  });

  test("handles missing firstEvent", () => {
    const project = createMockProject({ firstEvent: undefined });
    const lines = formatProjectDetails(project).map(stripAnsi);

    expect(lines.some((l) => l.includes("First Event: No events yet"))).toBe(
      true
    );
  });

  test("formats firstEvent date when present", () => {
    const project = createMockProject({
      firstEvent: "2024-06-15T10:30:00Z",
    });
    const lines = formatProjectDetails(project).map(stripAnsi);

    expect(lines.some((l) => l.startsWith("First Event:"))).toBe(true);
    // Should contain a formatted date (locale-dependent)
    expect(lines.some((l) => l.includes("2024") || l.includes("15"))).toBe(
      true
    );
  });
});

// Issue Formatting Tests

describe("formatIssueDetails", () => {
  test("formats basic issue details", () => {
    const issue = createMockIssue({
      shortId: "PROJ-ABC",
      title: "Test Error",
      status: "unresolved",
      level: "error",
      count: "100",
      userCount: 25,
    });

    const lines = formatIssueDetails(issue).map(stripAnsi);

    expect(lines[0]).toBe("PROJ-ABC: Test Error");
    expect(lines.some((l) => l.includes("Status:"))).toBe(true);
    expect(lines.some((l) => l.includes("Level:      error"))).toBe(true);
    expect(lines.some((l) => l.includes("Events:     100"))).toBe(true);
    expect(lines.some((l) => l.includes("Users:      25"))).toBe(true);
  });

  test("includes substatus when present", () => {
    const issue = createMockIssue({
      status: "unresolved",
      substatus: "ongoing",
    });

    const lines = formatIssueDetails(issue).map(stripAnsi);

    expect(lines.some((l) => l.includes("(Ongoing)"))).toBe(true);
  });

  test("includes priority when present", () => {
    const issue = createMockIssue({ priority: "high" });
    const lines = formatIssueDetails(issue).map(stripAnsi);

    expect(lines.some((l) => l.includes("Priority:   High"))).toBe(true);
  });

  test("shows unhandled indicator", () => {
    const issue = createMockIssue({ isUnhandled: true });
    const lines = formatIssueDetails(issue).map(stripAnsi);

    expect(lines.some((l) => l.includes("(unhandled)"))).toBe(true);
  });

  test("includes project info when present", () => {
    const issue = createMockIssue({
      project: { slug: "frontend", name: "Frontend App" },
    });

    const lines = formatIssueDetails(issue).map(stripAnsi);

    expect(
      lines.some((l) => l.includes("Project:    Frontend App (frontend)"))
    ).toBe(true);
  });

  test("formats single release correctly", () => {
    const issue = createMockIssue({
      firstRelease: { shortVersion: "1.0.0" },
      lastRelease: { shortVersion: "1.0.0" },
    });

    const lines = formatIssueDetails(issue).map(stripAnsi);

    expect(lines.some((l) => l === "Release:    1.0.0")).toBe(true);
  });

  test("formats release range when different", () => {
    const issue = createMockIssue({
      firstRelease: { shortVersion: "1.0.0" },
      lastRelease: { shortVersion: "2.0.0" },
    });

    const lines = formatIssueDetails(issue).map(stripAnsi);

    expect(lines.some((l) => l.includes("Releases:   1.0.0 -> 2.0.0"))).toBe(
      true
    );
  });

  test("includes assignee name", () => {
    const issue = createMockIssue({
      assignedTo: { name: "John Doe" },
    });

    const lines = formatIssueDetails(issue).map(stripAnsi);

    expect(lines.some((l) => l.includes("Assignee:   John Doe"))).toBe(true);
  });

  test("shows Unassigned when no assignee", () => {
    const issue = createMockIssue({ assignedTo: undefined });
    const lines = formatIssueDetails(issue).map(stripAnsi);

    expect(lines.some((l) => l.includes("Assignee:   Unassigned"))).toBe(true);
  });

  test("includes culprit when present", () => {
    const issue = createMockIssue({ culprit: "app.js in handleClick" });
    const lines = formatIssueDetails(issue).map(stripAnsi);

    expect(
      lines.some((l) => l.includes("Culprit:    app.js in handleClick"))
    ).toBe(true);
  });

  test("includes metadata message when present", () => {
    const issue = createMockIssue({
      metadata: { value: "Cannot read property 'x' of null" },
    });

    const lines = formatIssueDetails(issue).map(stripAnsi);

    expect(lines.some((l) => l === "Message:")).toBe(true);
    expect(
      lines.some((l) => l.includes("Cannot read property 'x' of null"))
    ).toBe(true);
  });

  test("includes metadata filename and function", () => {
    const issue = createMockIssue({
      metadata: { filename: "src/app.js", function: "handleClick" },
    });

    const lines = formatIssueDetails(issue).map(stripAnsi);

    expect(lines.some((l) => l.includes("File:       src/app.js"))).toBe(true);
    expect(lines.some((l) => l.includes("Function:   handleClick"))).toBe(true);
  });

  test("includes permalink", () => {
    const issue = createMockIssue({
      permalink: "https://sentry.io/issues/123",
    });

    const lines = formatIssueDetails(issue).map(stripAnsi);

    expect(
      lines.some((l) => l.includes("Link:       https://sentry.io/issues/123"))
    ).toBe(true);
  });

  test("handles missing optional fields gracefully", () => {
    const issue = createMockIssue({
      platform: undefined,
      type: undefined,
      priority: undefined,
      substatus: undefined,
      isUnhandled: undefined,
      project: undefined,
      firstRelease: undefined,
      lastRelease: undefined,
      culprit: undefined,
      metadata: undefined,
    });

    // Should not throw
    const lines = formatIssueDetails(issue).map(stripAnsi);

    expect(lines.length).toBeGreaterThan(5);
    expect(lines.some((l) => l.includes("Platform:   unknown"))).toBe(true);
    expect(lines.some((l) => l.includes("Type:       unknown"))).toBe(true);
  });
});
