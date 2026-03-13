/**
 * Trial Start Command Tests
 *
 * Tests for the trial start command in src/commands/trial/start.ts.
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

import { startCommand } from "../../../src/commands/trial/start.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as apiClient from "../../../src/lib/api-client.js";
import { ValidationError } from "../../../src/lib/errors.js";
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

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const MOCK_TRIAL: ProductTrial = {
  category: "seerUsers",
  startDate: null,
  endDate: null,
  reasonCode: 0,
  isStarted: false,
  lengthDays: 14,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("trial start command", () => {
  let getProductTrialsSpy: ReturnType<typeof spyOn>;
  let startProductTrialSpy: ReturnType<typeof spyOn>;
  let resolveOrgSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    getProductTrialsSpy = spyOn(apiClient, "getProductTrials");
    startProductTrialSpy = spyOn(
      apiClient,
      "startProductTrial"
    ).mockResolvedValue(undefined);
    resolveOrgSpy = spyOn(resolveTarget, "resolveOrg");
  });

  afterEach(() => {
    getProductTrialsSpy.mockRestore();
    startProductTrialSpy.mockRestore();
    resolveOrgSpy.mockRestore();
  });

  test("starts a trial and returns JSON result", async () => {
    resolveOrgSpy.mockResolvedValue({ org: "test-org" });
    getProductTrialsSpy.mockResolvedValue([MOCK_TRIAL]);

    const { context, stdoutWrite } = createMockContext();
    const func = await startCommand.loader();
    await func.call(context, { json: true }, "seer");

    const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
    const parsed = JSON.parse(output);
    expect(parsed.name).toBe("seer");
    expect(parsed.category).toBe("seerUsers");
    expect(parsed.organization).toBe("test-org");
    expect(parsed.started).toBe(true);
    expect(parsed.lengthDays).toBe(14);
  });

  test("calls startProductTrial with correct args", async () => {
    resolveOrgSpy.mockResolvedValue({ org: "test-org" });
    getProductTrialsSpy.mockResolvedValue([MOCK_TRIAL]);

    const { context } = createMockContext();
    const func = await startCommand.loader();
    await func.call(context, { json: true }, "seer");

    expect(startProductTrialSpy).toHaveBeenCalledWith("test-org", "seerUsers");
  });

  test("human output shows success message", async () => {
    resolveOrgSpy.mockResolvedValue({ org: "test-org" });
    getProductTrialsSpy.mockResolvedValue([MOCK_TRIAL]);

    const { context, stdoutWrite } = createMockContext();
    const func = await startCommand.loader();
    await func.call(context, { json: false }, "seer");

    const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("Seer");
    expect(output).toContain("trial started");
    expect(output).toContain("test-org");
  });

  test("throws ValidationError for unknown trial name", async () => {
    resolveOrgSpy.mockResolvedValue({ org: "test-org" });

    const { context } = createMockContext();
    const func = await startCommand.loader();

    await expect(
      func.call(context, { json: false }, "unknown-name")
    ).rejects.toThrow(ValidationError);
  });

  test("throws ValidationError when no trial available", async () => {
    resolveOrgSpy.mockResolvedValue({ org: "test-org" });
    getProductTrialsSpy.mockResolvedValue([]);

    const { context } = createMockContext();
    const func = await startCommand.loader();

    await expect(func.call(context, { json: false }, "seer")).rejects.toThrow(
      ValidationError
    );
  });

  test("error message uses display name when no trial available", async () => {
    resolveOrgSpy.mockResolvedValue({ org: "test-org" });
    getProductTrialsSpy.mockResolvedValue([]);

    const { context } = createMockContext();
    const func = await startCommand.loader();

    try {
      await func.call(context, { json: false }, "seer");
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as ValidationError).message).toContain("Seer");
    }
  });

  test("throws ContextError when org cannot be resolved", async () => {
    resolveOrgSpy.mockResolvedValue(null);

    const { context } = createMockContext();
    const func = await startCommand.loader();

    await expect(func.call(context, { json: false }, "seer")).rejects.toThrow(
      "Organization"
    );
  });

  test("uses org from second positional argument", async () => {
    resolveOrgSpy.mockResolvedValue({ org: "my-org" });
    getProductTrialsSpy.mockResolvedValue([MOCK_TRIAL]);

    const { context } = createMockContext();
    const func = await startCommand.loader();
    await func.call(context, { json: true }, "seer", "my-org");

    expect(resolveOrgSpy).toHaveBeenCalledWith(
      expect.objectContaining({ org: "my-org" })
    );
  });

  test("detects swapped arguments (org first, name second)", async () => {
    resolveOrgSpy.mockResolvedValue({ org: "my-org" });
    getProductTrialsSpy.mockResolvedValue([MOCK_TRIAL]);

    const { context } = createMockContext();
    const func = await startCommand.loader();
    // Swapped: org first, name second
    await func.call(context, { json: true }, "my-org", "seer");

    // Should resolve correctly despite swap
    expect(resolveOrgSpy).toHaveBeenCalledWith(
      expect.objectContaining({ org: "my-org" })
    );
    expect(getProductTrialsSpy).toHaveBeenCalledWith("my-org");
  });

  test("starts replays trial", async () => {
    const replaysTrial: ProductTrial = {
      ...MOCK_TRIAL,
      category: "replays",
    };
    resolveOrgSpy.mockResolvedValue({ org: "test-org" });
    getProductTrialsSpy.mockResolvedValue([replaysTrial]);

    const { context, stdoutWrite } = createMockContext();
    const func = await startCommand.loader();
    await func.call(context, { json: true }, "replays");

    const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
    const parsed = JSON.parse(output);
    expect(parsed.name).toBe("replays");
    expect(parsed.category).toBe("replays");
    expect(startProductTrialSpy).toHaveBeenCalledWith("test-org", "replays");
  });
});
