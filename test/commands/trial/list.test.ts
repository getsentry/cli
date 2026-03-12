/**
 * Trial List Command Tests
 *
 * Tests for the trial list command in src/commands/trial/list.ts.
 * Uses spyOn pattern to mock API client and resolve-target.
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

import { listCommand } from "../../../src/commands/trial/list.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as apiClient from "../../../src/lib/api-client.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as resolveTarget from "../../../src/lib/resolve-target.js";
import type { ProductTrial } from "../../../src/types/index.js";

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
      setContext: mock(() => {
        // no-op for test
      }),
    },
    stdoutWrite,
    stderrWrite,
  };
}

/** Helper to create a date string N days from now */
function daysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0]!;
}

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const AVAILABLE_TRIAL: ProductTrial = {
  category: "seerUsers",
  startDate: null,
  endDate: null,
  reasonCode: 0,
  isStarted: false,
  lengthDays: 14,
};

const ACTIVE_TRIAL: ProductTrial = {
  category: "replays",
  startDate: "2025-06-01",
  endDate: daysFromNow(7),
  reasonCode: 0,
  isStarted: true,
  lengthDays: 14,
};

const EXPIRED_TRIAL: ProductTrial = {
  category: "transactions",
  startDate: "2025-01-01",
  endDate: "2025-01-15",
  reasonCode: 0,
  isStarted: true,
  lengthDays: 14,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("trial list command", () => {
  let getProductTrialsSpy: ReturnType<typeof spyOn>;
  let resolveOrgSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    getProductTrialsSpy = spyOn(apiClient, "getProductTrials");
    resolveOrgSpy = spyOn(resolveTarget, "resolveOrg");
  });

  afterEach(() => {
    getProductTrialsSpy.mockRestore();
    resolveOrgSpy.mockRestore();
  });

  test("outputs JSON array of trials with --json", async () => {
    resolveOrgSpy.mockResolvedValue({ org: "test-org" });
    getProductTrialsSpy.mockResolvedValue([AVAILABLE_TRIAL, ACTIVE_TRIAL]);

    const { context, stdoutWrite } = createMockContext();
    const func = await listCommand.loader();
    await func.call(context, { json: true }, undefined);

    const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
    const parsed = JSON.parse(output);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].name).toBe("seer");
    expect(parsed[0].category).toBe("seerUsers");
    expect(parsed[0].status).toBe("available");
    expect(parsed[1].name).toBe("replays");
    expect(parsed[1].status).toBe("active");
  });

  test("excludes displayName from JSON output", async () => {
    resolveOrgSpy.mockResolvedValue({ org: "test-org" });
    getProductTrialsSpy.mockResolvedValue([AVAILABLE_TRIAL]);

    const { context, stdoutWrite } = createMockContext();
    const func = await listCommand.loader();
    await func.call(context, { json: true }, undefined);

    const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
    const parsed = JSON.parse(output);
    expect(parsed[0]).not.toHaveProperty("displayName");
  });

  test("outputs human-readable table with column headers", async () => {
    resolveOrgSpy.mockResolvedValue({ org: "test-org" });
    getProductTrialsSpy.mockResolvedValue([
      AVAILABLE_TRIAL,
      ACTIVE_TRIAL,
      EXPIRED_TRIAL,
    ]);

    const { context, stdoutWrite } = createMockContext();
    const func = await listCommand.loader();
    await func.call(context, { json: false }, undefined);

    const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("NAME");
    expect(output).toContain("PRODUCT");
    expect(output).toContain("STATUS");
    expect(output).toContain("DAYS LEFT");
    expect(output).toContain("seer");
    expect(output).toContain("replays");
    expect(output).toContain("performance");
  });

  test("shows empty state message when no trials exist", async () => {
    resolveOrgSpy.mockResolvedValue({ org: "test-org" });
    getProductTrialsSpy.mockResolvedValue([]);

    const { context, stdoutWrite } = createMockContext();
    const func = await listCommand.loader();
    await func.call(context, { json: false }, undefined);

    const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("No product trials found");
  });

  test("outputs empty JSON array when no trials exist", async () => {
    resolveOrgSpy.mockResolvedValue({ org: "test-org" });
    getProductTrialsSpy.mockResolvedValue([]);

    const { context, stdoutWrite } = createMockContext();
    const func = await listCommand.loader();
    await func.call(context, { json: true }, undefined);

    const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
    expect(JSON.parse(output)).toEqual([]);
  });

  test("uses org from positional argument", async () => {
    resolveOrgSpy.mockResolvedValue({ org: "my-org" });
    getProductTrialsSpy.mockResolvedValue([AVAILABLE_TRIAL]);

    const { context } = createMockContext();
    const func = await listCommand.loader();
    await func.call(context, { json: true }, "my-org");

    expect(resolveOrgSpy).toHaveBeenCalledWith(
      expect.objectContaining({ org: "my-org" })
    );
    expect(getProductTrialsSpy).toHaveBeenCalledWith("my-org");
  });

  test("throws ContextError when org cannot be resolved", async () => {
    resolveOrgSpy.mockResolvedValue(null);

    const { context } = createMockContext();
    const func = await listCommand.loader();

    await expect(
      func.call(context, { json: false }, undefined)
    ).rejects.toThrow("Organization");
  });

  test("includes hint about starting trial when available trials exist", async () => {
    resolveOrgSpy.mockResolvedValue({ org: "test-org" });
    getProductTrialsSpy.mockResolvedValue([AVAILABLE_TRIAL]);

    const { context, stdoutWrite } = createMockContext();
    const func = await listCommand.loader();
    await func.call(context, { json: false }, undefined);

    const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("sentry trial start");
  });
});
