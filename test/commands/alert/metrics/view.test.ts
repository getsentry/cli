/**
 * Alert metrics view — parsing, name resolution, and non-404 API error propagation.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { viewCommand } from "../../../../src/commands/alert/metrics/view.js";
import type { MetricAlertRule } from "../../../../src/lib/api-client.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as apiClient from "../../../../src/lib/api-client.js";
import { ApiError, ValidationError } from "../../../../src/lib/errors.js";
import type { ResolvedTarget } from "../../../../src/lib/resolve-target.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as resolveTarget from "../../../../src/lib/resolve-target.js";
import { useTestConfigDir } from "../../../helpers.js";

const getConfigDir = useTestConfigDir("test-alert-metrics-view-", {
  isolateProjectRoot: true,
});

const sampleTarget: ResolvedTarget = {
  org: "test-org",
  project: "ignored",
  orgDisplay: "test-org",
  projectDisplay: "ignored",
};

const baseRule: MetricAlertRule = {
  id: "1",
  name: "Metric Rule Alpha",
  status: 0,
  query: "event.type:error",
  aggregate: "count()",
  dataset: "errors",
  timeWindow: 5,
  environment: null,
  owner: null,
  projects: [],
  dateCreated: "2026-01-01T00:00:00Z",
};

type ViewFlags = { readonly web: boolean; readonly json: boolean };

function createContext() {
  const stdoutWrite = vi.fn(() => true);
  return {
    context: {
      stdout: { write: stdoutWrite },
      stderr: { write: vi.fn(() => true) },
      cwd: getConfigDir(),
    },
    stdoutWrite,
  };
}

describe("alert metrics view", () => {
  let getRuleSpy: ReturnType<typeof vi.spyOn>;
  let listRulesSpy: ReturnType<typeof vi.spyOn>;
  let resolveSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    getRuleSpy = vi.spyOn(apiClient, "getMetricAlertRule");
    listRulesSpy = vi.spyOn(apiClient, "listMetricAlertsPaginated");
    resolveSpy = vi.spyOn(resolveTarget, "resolveTargetsFromParsedArg");
  });

  afterEach(() => {
    getRuleSpy.mockRestore();
    listRulesSpy.mockRestore();
    resolveSpy.mockRestore();
  });

  test("rejects org/ with no rule id or name (ValidationError)", async () => {
    const { context } = createContext();
    // Parse fails before target resolution; no need to mock resolve
    const func = (await viewCommand.loader()) as unknown as (
      this: unknown,
      flags: ViewFlags,
      arg: string
    ) => Promise<void>;

    await expect(
      func.call(context, { web: false, json: true }, "acme/")
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test("numeric id: propagates non-404 API errors (e.g. 500)", async () => {
    const { context } = createContext();
    resolveSpy.mockResolvedValue({ targets: [sampleTarget] });
    getRuleSpy.mockRejectedValue(new ApiError("Server error", 500, "nope"));
    const func = (await viewCommand.loader()) as unknown as (
      this: unknown,
      flags: ViewFlags,
      arg: string
    ) => Promise<void>;

    await expect(
      func.call(context, { web: false, json: true }, "test-org/42")
    ).rejects.toBeInstanceOf(ApiError);
  });

  test("name: no exact match with suggestions returns ValidationError with Did you mean", async () => {
    const { context, stdoutWrite } = createContext();
    resolveSpy.mockResolvedValue({ targets: [sampleTarget] });
    listRulesSpy.mockResolvedValue({
      data: [baseRule],
      nextCursor: undefined,
    });
    const func = (await viewCommand.loader()) as unknown as (
      this: unknown,
      flags: ViewFlags,
      arg: string
    ) => Promise<void>;

    const err = await func
      .call(context, { web: false, json: true }, "test-org/Metric Rule Alph")
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ValidationError).message).toContain("Did you mean");
    expect((err as ValidationError).message).toContain("Metric Rule Alpha");
    expect(stdoutWrite).not.toHaveBeenCalled();
  });
});
