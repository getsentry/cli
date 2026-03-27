/**
 * Dashboard Resolution Utility Tests
 *
 * Tests for positional argument parsing, dashboard ID resolution,
 * and org resolution in src/commands/dashboard/resolve.ts.
 */

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import {
  enrichDashboardError,
  parseDashboardListArgs,
  parseDashboardPositionalArgs,
  resolveDashboardId,
  resolveOrgFromTarget,
} from "../../../src/commands/dashboard/resolve.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as apiClient from "../../../src/lib/api-client.js";
import { parseOrgProjectArg } from "../../../src/lib/arg-parsing.js";
import {
  ApiError,
  ContextError,
  ResolutionError,
  ValidationError,
} from "../../../src/lib/errors.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as resolveTarget from "../../../src/lib/resolve-target.js";

// ---------------------------------------------------------------------------
// parseDashboardPositionalArgs
// ---------------------------------------------------------------------------

describe("parseDashboardPositionalArgs", () => {
  test("throws ValidationError for empty args", () => {
    expect(() => parseDashboardPositionalArgs([])).toThrow(ValidationError);
  });

  test("error message contains 'Dashboard ID or title'", () => {
    try {
      parseDashboardPositionalArgs([]);
      expect.unreachable("Should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).message).toContain(
        "Dashboard ID or title"
      );
    }
  });

  test("single arg returns dashboardRef only", () => {
    const result = parseDashboardPositionalArgs(["123"]);
    expect(result.dashboardRef).toBe("123");
    expect(result.targetArg).toBeUndefined();
  });

  test("two args returns target + dashboardRef", () => {
    const result = parseDashboardPositionalArgs(["my-org/", "My Dashboard"]);
    expect(result.dashboardRef).toBe("My Dashboard");
    expect(result.targetArg).toBe("my-org/");
  });

  test("two args with bare org slug auto-appends /", () => {
    const result = parseDashboardPositionalArgs(["my-org", "12345"]);
    expect(result.dashboardRef).toBe("12345");
    expect(result.targetArg).toBe("my-org/");
  });

  test("two args with org/project is unchanged", () => {
    const result = parseDashboardPositionalArgs(["my-org/my-project", "12345"]);
    expect(result.dashboardRef).toBe("12345");
    expect(result.targetArg).toBe("my-org/my-project");
  });
});

// ---------------------------------------------------------------------------
// parseDashboardListArgs
// ---------------------------------------------------------------------------

describe("parseDashboardListArgs", () => {
  test("empty args returns undefined for both", () => {
    const result = parseDashboardListArgs([]);
    expect(result.targetArg).toBeUndefined();
    expect(result.titleFilter).toBeUndefined();
  });

  test("single arg with trailing slash is target", () => {
    const result = parseDashboardListArgs(["my-org/"]);
    expect(result.targetArg).toBe("my-org/");
    expect(result.titleFilter).toBeUndefined();
  });

  test("single arg with glob * is title filter", () => {
    const result = parseDashboardListArgs(["Error*"]);
    expect(result.targetArg).toBeUndefined();
    expect(result.titleFilter).toBe("Error*");
  });

  test("single arg with space is title filter", () => {
    const result = parseDashboardListArgs(["My Dashboard"]);
    expect(result.targetArg).toBeUndefined();
    expect(result.titleFilter).toBe("My Dashboard");
  });

  test("single arg with glob ? is title filter", () => {
    const result = parseDashboardListArgs(["?something"]);
    expect(result.targetArg).toBeUndefined();
    expect(result.titleFilter).toBe("?something");
  });

  test("single arg with glob [ is title filter", () => {
    const result = parseDashboardListArgs(["[abc]"]);
    expect(result.targetArg).toBeUndefined();
    expect(result.titleFilter).toBe("[abc]");
  });

  test("single bare word is title filter (dashboards are org-scoped)", () => {
    const result = parseDashboardListArgs(["performance"]);
    expect(result.targetArg).toBeUndefined();
    expect(result.titleFilter).toBe("performance");
  });

  test("two args with trailing slash target and glob filter", () => {
    const result = parseDashboardListArgs(["my-org/", "Error*"]);
    expect(result.targetArg).toBe("my-org/");
    expect(result.titleFilter).toBe("Error*");
  });

  test("two args with bare org slug auto-appends /", () => {
    const result = parseDashboardListArgs(["my-org", "Error*"]);
    expect(result.targetArg).toBe("my-org/");
    expect(result.titleFilter).toBe("Error*");
  });

  test("two args with org/project and glob filter", () => {
    const result = parseDashboardListArgs(["my-org/my-project", "*API*"]);
    expect(result.targetArg).toBe("my-org/my-project");
    expect(result.titleFilter).toBe("*API*");
  });

  test("multi-word unquoted filter: remaining args joined with spaces", () => {
    const result = parseDashboardListArgs(["sentry/cli", "CLI", "Health"]);
    expect(result.targetArg).toBe("sentry/cli");
    expect(result.titleFilter).toBe("CLI Health");
  });

  test("multi-word unquoted filter with bare org", () => {
    const result = parseDashboardListArgs(["my-org", "Error", "Overview"]);
    expect(result.targetArg).toBe("my-org/");
    expect(result.titleFilter).toBe("Error Overview");
  });

  test("single arg org/project/name splits into target + filter", () => {
    const result = parseDashboardListArgs(["sentry/cli/CLI"]);
    expect(result.targetArg).toBe("sentry/cli");
    expect(result.titleFilter).toBe("CLI");
  });

  test("single arg org/project/name with spaces in name", () => {
    const result = parseDashboardListArgs(["sentry/cli/My Dashboard"]);
    expect(result.targetArg).toBe("sentry/cli");
    expect(result.titleFilter).toBe("My Dashboard");
  });

  test("single arg org/ is target only (one slash, trailing)", () => {
    const result = parseDashboardListArgs(["my-org/"]);
    expect(result.targetArg).toBe("my-org/");
    expect(result.titleFilter).toBeUndefined();
  });

  test("single arg org/project is target only (one slash)", () => {
    const result = parseDashboardListArgs(["my-org/my-project"]);
    expect(result.targetArg).toBe("my-org/my-project");
    expect(result.titleFilter).toBeUndefined();
  });

  test("single arg org/project/ is target only (trailing slash after project)", () => {
    const result = parseDashboardListArgs(["my-org/my-project/"]);
    expect(result.targetArg).toBe("my-org/my-project/");
    expect(result.titleFilter).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// resolveDashboardId
// ---------------------------------------------------------------------------

describe("resolveDashboardId", () => {
  let listDashboardsPaginatedSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    listDashboardsPaginatedSpy = spyOn(apiClient, "listDashboardsPaginated");
  });

  afterEach(() => {
    listDashboardsPaginatedSpy.mockRestore();
  });

  test("numeric string returns directly without API call", async () => {
    const id = await resolveDashboardId("test-org", "42");
    expect(id).toBe("42");
    expect(listDashboardsPaginatedSpy).not.toHaveBeenCalled();
  });

  test("title match returns matching dashboard ID", async () => {
    listDashboardsPaginatedSpy.mockResolvedValue({
      data: [
        { id: "10", title: "Errors Overview" },
        { id: "20", title: "Performance" },
      ],
      nextCursor: undefined,
    });

    const id = await resolveDashboardId("test-org", "Performance");
    expect(id).toBe("20");
  });

  test("title match is case-insensitive", async () => {
    listDashboardsPaginatedSpy.mockResolvedValue({
      data: [{ id: "10", title: "Errors Overview" }],
      nextCursor: undefined,
    });

    const id = await resolveDashboardId("test-org", "errors overview");
    expect(id).toBe("10");
  });

  test("ID/slug match returns matching dashboard ID", async () => {
    listDashboardsPaginatedSpy.mockResolvedValue({
      data: [
        { id: "default-overview", title: "General" },
        { id: "20", title: "Performance" },
      ],
      nextCursor: undefined,
    });

    const id = await resolveDashboardId("test-org", "default-overview");
    expect(id).toBe("default-overview");
  });

  test("ID match is case-insensitive", async () => {
    listDashboardsPaginatedSpy.mockResolvedValue({
      data: [{ id: "default-overview", title: "General" }],
      nextCursor: undefined,
    });

    const id = await resolveDashboardId("test-org", "Default-Overview");
    expect(id).toBe("default-overview");
  });

  test("ID match takes priority over title match", async () => {
    listDashboardsPaginatedSpy.mockResolvedValue({
      data: [
        { id: "perf", title: "Performance Dashboard" },
        { id: "30", title: "perf" },
      ],
      nextCursor: undefined,
    });

    const id = await resolveDashboardId("test-org", "perf");
    expect(id).toBe("perf");
  });

  test("title match still works when no ID matches", async () => {
    listDashboardsPaginatedSpy.mockResolvedValue({
      data: [{ id: "default-overview", title: "General" }],
      nextCursor: undefined,
    });

    const id = await resolveDashboardId("test-org", "General");
    expect(id).toBe("default-overview");
  });

  test("no match throws ValidationError with fuzzy suggestions", async () => {
    listDashboardsPaginatedSpy.mockResolvedValue({
      data: [
        { id: "10", title: "Errors Overview" },
        { id: "20", title: "Performance" },
      ],
      nextCursor: undefined,
    });

    try {
      await resolveDashboardId("test-org", "Missing Dashboard");
      expect.unreachable("Should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      const message = (error as ValidationError).message;
      expect(message).toContain("Missing Dashboard");
    }
  });

  test("title not found shows fuzzy suggestions for close misspelling", async () => {
    listDashboardsPaginatedSpy.mockResolvedValue({
      data: [
        { id: "10", title: "Errors Overview" },
        { id: "20", title: "Performance" },
      ],
      nextCursor: undefined,
    });

    try {
      await resolveDashboardId("test-org", "Eror Overview");
      expect.unreachable("Should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      const message = (error as ValidationError).message;
      expect(message).toContain("Eror Overview");
      expect(message).toContain("Did you mean");
      expect(message).toContain("Errors Overview");
    }
  });

  test("no dashboards at all shows empty org message", async () => {
    listDashboardsPaginatedSpy.mockResolvedValue({
      data: [],
      nextCursor: undefined,
    });

    try {
      await resolveDashboardId("test-org", "My Dashboard");
      expect.unreachable("Should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      const message = (error as ValidationError).message;
      expect(message).toContain("My Dashboard");
      expect(message).toContain("No dashboards found in this organization.");
    }
  });
});

// ---------------------------------------------------------------------------
// resolveOrgFromTarget
// ---------------------------------------------------------------------------

describe("resolveOrgFromTarget", () => {
  let resolveOrgSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    resolveOrgSpy = spyOn(resolveTarget, "resolveOrg");
  });

  afterEach(() => {
    resolveOrgSpy.mockRestore();
  });

  test("explicit type returns org directly", async () => {
    const parsed = parseOrgProjectArg("my-org/my-project");
    const org = await resolveOrgFromTarget(
      parsed,
      "/tmp",
      "sentry dashboard view"
    );
    expect(org).toBe("my-org");
    expect(resolveOrgSpy).not.toHaveBeenCalled();
  });

  test("auto-detect with null resolveOrg throws ContextError", async () => {
    resolveOrgSpy.mockResolvedValue(null);
    const parsed = parseOrgProjectArg(undefined);

    await expect(
      resolveOrgFromTarget(parsed, "/tmp", "sentry dashboard view")
    ).rejects.toThrow(ContextError);
  });
});

// ---------------------------------------------------------------------------
// enrichDashboardError
// ---------------------------------------------------------------------------

describe("enrichDashboardError", () => {
  test("re-throws non-ApiError unchanged", () => {
    const original = new Error("network failure");
    expect(() =>
      enrichDashboardError(original, { orgSlug: "my-org", operation: "list" })
    ).toThrow(original);
  });

  test("re-throws ApiError with unhandled status unchanged", () => {
    const original = new ApiError("rate limited", 429, "Too many requests");
    expect(() =>
      enrichDashboardError(original, { orgSlug: "my-org", operation: "list" })
    ).toThrow(ApiError);
    try {
      enrichDashboardError(original, { orgSlug: "my-org", operation: "list" });
    } catch (error) {
      expect(error).toBe(original);
    }
  });

  // -- 404 errors --

  test("404 on list throws ResolutionError mentioning org", () => {
    const apiErr = new ApiError("Not Found", 404);
    try {
      enrichDashboardError(apiErr, { orgSlug: "my-org", operation: "list" });
      expect.unreachable("Should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ResolutionError);
      const msg = (error as ResolutionError).message;
      expect(msg).toContain("'my-org'");
      expect(msg).toContain("not found");
      expect(msg).toContain("sentry dashboard list");
      expect(msg).toContain("sentry org list");
    }
  });

  test("404 on view with dashboardId throws ResolutionError for dashboard", () => {
    const apiErr = new ApiError("Not Found", 404);
    try {
      enrichDashboardError(apiErr, {
        orgSlug: "my-org",
        dashboardId: "12345",
        operation: "view",
      });
      expect.unreachable("Should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ResolutionError);
      const msg = (error as ResolutionError).message;
      expect(msg).toContain("Dashboard 12345");
      expect(msg).toContain("'my-org'");
      expect(msg).toContain("not found");
      expect(msg).toContain("sentry dashboard list");
    }
  });

  test("404 on create without dashboardId throws ResolutionError for org", () => {
    const apiErr = new ApiError("Not Found", 404);
    try {
      enrichDashboardError(apiErr, { orgSlug: "bad-org", operation: "create" });
      expect.unreachable("Should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ResolutionError);
      const msg = (error as ResolutionError).message;
      expect(msg).toContain("'bad-org'");
      expect(msg).toContain("not found");
    }
  });

  // -- 403 errors --

  test("403 with dashboardId throws ResolutionError for dashboard access", () => {
    const apiErr = new ApiError("Forbidden", 403, "No permission");
    try {
      enrichDashboardError(apiErr, {
        orgSlug: "my-org",
        dashboardId: "99",
        operation: "view",
      });
      expect.unreachable("Should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ResolutionError);
      const msg = (error as ResolutionError).message;
      expect(msg).toContain("Dashboard 99");
      expect(msg).toContain("access denied");
      expect(msg).toContain("No permission");
    }
  });

  test("403 without dashboardId throws ResolutionError for org dashboards", () => {
    const apiErr = new ApiError("Forbidden", 403);
    try {
      enrichDashboardError(apiErr, { orgSlug: "my-org", operation: "list" });
      expect.unreachable("Should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ResolutionError);
      const msg = (error as ResolutionError).message;
      expect(msg).toContain("Dashboards in 'my-org'");
      expect(msg).toContain("access denied");
    }
  });

  test("403 includes default detail when API provides none", () => {
    const apiErr = new ApiError("Forbidden", 403);
    try {
      enrichDashboardError(apiErr, { orgSlug: "my-org", operation: "list" });
      expect.unreachable("Should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ResolutionError);
      const msg = (error as ResolutionError).message;
      expect(msg).toContain("You do not have permission.");
    }
  });

  // -- 400 errors --

  test("400 on update throws enriched ApiError with dashboard context", () => {
    const apiErr = new ApiError("Bad Request", 400, "Invalid widget config");
    try {
      enrichDashboardError(apiErr, {
        orgSlug: "my-org",
        dashboardId: "42",
        operation: "update",
      });
      expect.unreachable("Should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      const msg = (error as ApiError).message;
      expect(msg).toContain("Dashboard update failed");
      expect(msg).toContain("'my-org'");
      expect((error as ApiError).detail).toContain("Invalid widget config");
    }
  });

  test("400 on non-update operation re-throws unchanged", () => {
    const apiErr = new ApiError("Bad Request", 400, "some detail");
    expect(() =>
      enrichDashboardError(apiErr, { orgSlug: "my-org", operation: "list" })
    ).toThrow(apiErr);
  });
});
