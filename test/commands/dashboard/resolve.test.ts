/**
 * Dashboard Resolution Utility Tests
 *
 * Tests for positional argument parsing, dashboard ID resolution,
 * and org resolution in src/commands/dashboard/resolve.ts.
 */

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import {
  parseDashboardPositionalArgs,
  resolveDashboardId,
  resolveOrgFromTarget,
} from "../../../src/commands/dashboard/resolve.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as apiClient from "../../../src/lib/api-client.js";
import { parseOrgProjectArg } from "../../../src/lib/arg-parsing.js";
import { ContextError, ValidationError } from "../../../src/lib/errors.js";
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
});

// ---------------------------------------------------------------------------
// resolveDashboardId
// ---------------------------------------------------------------------------

describe("resolveDashboardId", () => {
  let listDashboardsSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    listDashboardsSpy = spyOn(apiClient, "listDashboards");
  });

  afterEach(() => {
    listDashboardsSpy.mockRestore();
  });

  test("numeric string returns directly without API call", async () => {
    const id = await resolveDashboardId("test-org", "42");
    expect(id).toBe("42");
    expect(listDashboardsSpy).not.toHaveBeenCalled();
  });

  test("title match returns matching dashboard ID", async () => {
    listDashboardsSpy.mockResolvedValue([
      { id: "10", title: "Errors Overview" },
      { id: "20", title: "Performance" },
    ]);

    const id = await resolveDashboardId("test-org", "Performance");
    expect(id).toBe("20");
  });

  test("title match is case-insensitive", async () => {
    listDashboardsSpy.mockResolvedValue([
      { id: "10", title: "Errors Overview" },
    ]);

    const id = await resolveDashboardId("test-org", "errors overview");
    expect(id).toBe("10");
  });

  test("no match throws ValidationError with available dashboards", async () => {
    listDashboardsSpy.mockResolvedValue([
      { id: "10", title: "Errors Overview" },
      { id: "20", title: "Performance" },
    ]);

    try {
      await resolveDashboardId("test-org", "Missing Dashboard");
      expect.unreachable("Should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      const message = (error as ValidationError).message;
      expect(message).toContain("Missing Dashboard");
      expect(message).toContain("Errors Overview");
      expect(message).toContain("Performance");
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
