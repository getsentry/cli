/**
 * Dashboard Resolution Utility Tests
 *
 * Tests for positional argument parsing, dashboard ID resolution,
 * and org resolution in src/commands/dashboard/resolve.ts.
 */

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import {
  parseDashboardListArgs,
  parseDashboardPositionalArgs,
  resolveDashboardId,
  resolveOrgFromTarget,
} from "../../../src/commands/dashboard/resolve.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as apiClient from "../../../src/lib/api-client.js";
import { parseOrgProjectArg } from "../../../src/lib/arg-parsing.js";
import { ContextError, ValidationError } from "../../../src/lib/errors.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as region from "../../../src/lib/region.js";
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
  let resolveEffectiveOrgSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    resolveOrgSpy = spyOn(resolveTarget, "resolveOrg");
    // Default: resolveEffectiveOrg returns the input unchanged
    resolveEffectiveOrgSpy = spyOn(
      region,
      "resolveEffectiveOrg"
    ).mockImplementation((slug: string) => Promise.resolve(slug));
  });

  afterEach(() => {
    resolveOrgSpy.mockRestore();
    resolveEffectiveOrgSpy.mockRestore();
  });

  test("explicit type normalizes org via resolveEffectiveOrg", async () => {
    const parsed = parseOrgProjectArg("my-org/my-project");
    const org = await resolveOrgFromTarget(
      parsed,
      "/tmp",
      "sentry dashboard view"
    );
    expect(org).toBe("my-org");
    expect(resolveEffectiveOrgSpy).toHaveBeenCalledWith("my-org");
    expect(resolveOrgSpy).not.toHaveBeenCalled();
  });

  test("explicit type with o-prefixed numeric ID resolves to slug", async () => {
    resolveEffectiveOrgSpy.mockResolvedValue("my-org");
    const parsed = parseOrgProjectArg("o1169445/my-project");
    const org = await resolveOrgFromTarget(
      parsed,
      "/tmp",
      "sentry dashboard list"
    );
    expect(org).toBe("my-org");
    expect(resolveEffectiveOrgSpy).toHaveBeenCalledWith("o1169445");
  });

  test("auto-detect with null resolveOrg throws ContextError", async () => {
    resolveOrgSpy.mockResolvedValue(null);
    const parsed = parseOrgProjectArg(undefined);

    await expect(
      resolveOrgFromTarget(parsed, "/tmp", "sentry dashboard view")
    ).rejects.toThrow(ContextError);
  });

  test("auto-detect delegates to resolveOrg", async () => {
    resolveOrgSpy.mockResolvedValue({ org: "detected-org" });
    const parsed = parseOrgProjectArg(undefined);
    const org = await resolveOrgFromTarget(
      parsed,
      "/tmp",
      "sentry dashboard list"
    );
    expect(org).toBe("detected-org");
    expect(resolveOrgSpy).toHaveBeenCalled();
  });
});
