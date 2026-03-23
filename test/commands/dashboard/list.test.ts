/**
 * Dashboard List Command Tests
 *
 * Tests for the dashboard list command in src/commands/dashboard/list.ts.
 * Uses spyOn pattern to mock API client, resolve-target, and browser.
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from "bun:test";

import { listCommand } from "../../../src/commands/dashboard/list.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as apiClient from "../../../src/lib/api-client.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as browser from "../../../src/lib/browser.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as polling from "../../../src/lib/polling.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as resolveTarget from "../../../src/lib/resolve-target.js";
import type { DashboardListItem } from "../../../src/types/dashboard.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockContext(cwd = "/tmp") {
  const stdoutWrite = mock(() => true);
  const stderrWrite = mock(() => true);
  return {
    context: {
      stdout: { write: stdoutWrite },
      stderr: { write: stderrWrite },
      cwd,
    },
    stdoutWrite,
    stderrWrite,
  };
}

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const DASHBOARD_A: DashboardListItem = {
  id: "1",
  title: "Errors Overview",
  widgetDisplay: ["big_number", "line"],
  dateCreated: "2026-01-15T10:00:00Z",
};

const DASHBOARD_B: DashboardListItem = {
  id: "42",
  title: "Performance",
  widgetDisplay: ["table"],
  dateCreated: "2026-02-20T12:00:00Z",
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("dashboard list command", () => {
  let listDashboardsSpy: ReturnType<typeof spyOn>;
  let resolveOrgSpy: ReturnType<typeof spyOn>;
  let openInBrowserSpy: ReturnType<typeof spyOn>;
  let withProgressSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    listDashboardsSpy = spyOn(apiClient, "listDashboards");
    resolveOrgSpy = spyOn(resolveTarget, "resolveOrg");
    openInBrowserSpy = spyOn(browser, "openInBrowser").mockResolvedValue(
      undefined as never
    );
    // Bypass spinner — just run the callback directly
    withProgressSpy = spyOn(polling, "withProgress").mockImplementation(
      (_opts, fn) =>
        fn(() => {
          /* no-op setMessage */
        })
    );
  });

  afterEach(() => {
    listDashboardsSpy.mockRestore();
    resolveOrgSpy.mockRestore();
    openInBrowserSpy.mockRestore();
    withProgressSpy.mockRestore();
  });

  test("outputs JSON array of dashboards with --json", async () => {
    resolveOrgSpy.mockResolvedValue({ org: "test-org" });
    listDashboardsSpy.mockResolvedValue([DASHBOARD_A, DASHBOARD_B]);

    const { context, stdoutWrite } = createMockContext();
    const func = await listCommand.loader();
    await func.call(
      context,
      { json: true, web: false, fresh: false, limit: 30 },
      undefined
    );

    const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
    const parsed = JSON.parse(output);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].id).toBe("1");
    expect(parsed[0].title).toBe("Errors Overview");
    expect(parsed[1].id).toBe("42");
  });

  test("outputs empty JSON array when no dashboards exist", async () => {
    resolveOrgSpy.mockResolvedValue({ org: "test-org" });
    listDashboardsSpy.mockResolvedValue([]);

    const { context, stdoutWrite } = createMockContext();
    const func = await listCommand.loader();
    await func.call(
      context,
      { json: true, web: false, fresh: false, limit: 30 },
      undefined
    );

    const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
    expect(JSON.parse(output)).toEqual([]);
  });

  test("outputs human-readable table with column headers", async () => {
    resolveOrgSpy.mockResolvedValue({ org: "test-org" });
    listDashboardsSpy.mockResolvedValue([DASHBOARD_A, DASHBOARD_B]);

    const { context, stdoutWrite } = createMockContext();
    const func = await listCommand.loader();
    await func.call(
      context,
      { json: false, web: false, fresh: false, limit: 30 },
      undefined
    );

    const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("ID");
    expect(output).toContain("TITLE");
    expect(output).toContain("WIDGETS");
    expect(output).toContain("Errors Overview");
    expect(output).toContain("Performance");
  });

  test("shows empty state message when no dashboards exist", async () => {
    resolveOrgSpy.mockResolvedValue({ org: "test-org" });
    listDashboardsSpy.mockResolvedValue([]);

    const { context, stdoutWrite } = createMockContext();
    const func = await listCommand.loader();
    await func.call(
      context,
      { json: false, web: false, fresh: false, limit: 30 },
      undefined
    );

    const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("No dashboards found.");
  });

  test("human output footer contains dashboards URL", async () => {
    resolveOrgSpy.mockResolvedValue({ org: "test-org" });
    listDashboardsSpy.mockResolvedValue([DASHBOARD_A]);

    const { context, stdoutWrite } = createMockContext();
    const func = await listCommand.loader();
    await func.call(
      context,
      { json: false, web: false, fresh: false, limit: 30 },
      undefined
    );

    const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("dashboards");
    expect(output).toContain("test-org");
  });

  test("uses org from positional argument", async () => {
    resolveOrgSpy.mockResolvedValue({ org: "my-org" });
    listDashboardsSpy.mockResolvedValue([DASHBOARD_A]);

    const { context } = createMockContext();
    const func = await listCommand.loader();
    await func.call(
      context,
      { json: true, web: false, fresh: false, limit: 30 },
      "my-org/"
    );

    expect(listDashboardsSpy).toHaveBeenCalledWith("my-org", { perPage: 30 });
  });

  test("throws ContextError when org cannot be resolved", async () => {
    resolveOrgSpy.mockResolvedValue(null);

    const { context } = createMockContext();
    const func = await listCommand.loader();

    await expect(
      func.call(
        context,
        { json: false, web: false, fresh: false, limit: 30 },
        undefined
      )
    ).rejects.toThrow("Organization");
  });

  test("--web flag opens browser instead of listing", async () => {
    resolveOrgSpy.mockResolvedValue({ org: "test-org" });

    const { context } = createMockContext();
    const func = await listCommand.loader();
    await func.call(
      context,
      { json: false, web: true, fresh: false, limit: 30 },
      undefined
    );

    expect(openInBrowserSpy).toHaveBeenCalled();
    expect(listDashboardsSpy).not.toHaveBeenCalled();
  });

  test("passes limit to API via withProgress", async () => {
    resolveOrgSpy.mockResolvedValue({ org: "test-org" });
    listDashboardsSpy.mockResolvedValue([DASHBOARD_A]);

    const { context } = createMockContext();
    const func = await listCommand.loader();
    await func.call(
      context,
      { json: true, web: false, fresh: false, limit: 10 },
      undefined
    );

    expect(withProgressSpy).toHaveBeenCalled();
    expect(listDashboardsSpy).toHaveBeenCalledWith("test-org", {
      perPage: 10,
    });
  });
});
