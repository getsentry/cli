import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createCommand } from "../../../../src/commands/alert/metrics/create.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as apiClient from "../../../../src/lib/api-client.js";
import { ValidationError } from "../../../../src/lib/errors.js";
import type { ResolvedTarget } from "../../../../src/lib/resolve-target.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as resolveTarget from "../../../../src/lib/resolve-target.js";
import { useTestConfigDir } from "../../../helpers.js";

const getConfigDir = useTestConfigDir("test-alert-metrics-create-", {
  isolateProjectRoot: true,
});

const sampleTarget: ResolvedTarget = {
  org: "test-org",
  project: "ignored",
  orgDisplay: "test-org",
  projectDisplay: "ignored",
};

type CreateFlags = {
  readonly name: string;
  readonly query: string;
  readonly aggregate: string;
  readonly dataset: string;
  readonly "time-window": number;
  readonly trigger?: string[];
  readonly "dry-run": boolean;
  readonly json: boolean;
};

function createContext() {
  return {
    stdout: { write: vi.fn(() => true) },
    stderr: { write: vi.fn(() => true) },
    cwd: getConfigDir(),
  };
}

describe("alert metrics create", () => {
  let resolveSpy: ReturnType<typeof vi.spyOn>;
  let createSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resolveSpy = vi.spyOn(resolveTarget, "resolveTargetsFromParsedArg");
    createSpy = vi.spyOn(apiClient, "createMetricAlertRule");
  });

  afterEach(() => {
    resolveSpy.mockRestore();
    createSpy.mockRestore();
  });

  test("rejects unsupported dataset", async () => {
    const context = createContext();
    const func = (await createCommand.loader()) as unknown as (
      this: unknown,
      flags: CreateFlags,
      arg: string
    ) => Promise<void>;

    await expect(
      func.call(
        context,
        {
          name: "Metric Rule",
          query: "event.type:error",
          aggregate: "count()",
          dataset: "unknown",
          "time-window": 5,
          trigger: ['{"alertThreshold":100,"actions":[{"id":"notify"}]}'],
          "dry-run": true,
          json: true,
        },
        "test-org"
      )
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test("dry run does not call create API", async () => {
    const context = createContext();
    resolveSpy.mockResolvedValue({ targets: [sampleTarget] });
    const func = (await createCommand.loader()) as unknown as (
      this: unknown,
      flags: CreateFlags,
      arg: string
    ) => Promise<void>;

    await func.call(
      context,
      {
        name: "Metric Rule",
        query: "event.type:error",
        aggregate: "count()",
        dataset: "errors",
        "time-window": 5,
        trigger: ['{"alertThreshold":100,"actions":[{"id":"notify"}]}'],
        "dry-run": true,
        json: true,
      },
      "test-org"
    );

    expect(createSpy).not.toHaveBeenCalled();
  });

  test("calls create API with parsed trigger payload", async () => {
    const context = createContext();
    resolveSpy.mockResolvedValue({ targets: [sampleTarget] });
    createSpy.mockResolvedValue({
      id: "77",
      name: "Metric Rule",
      status: 0,
    });
    const func = (await createCommand.loader()) as unknown as (
      this: unknown,
      flags: CreateFlags,
      arg: string
    ) => Promise<void>;

    await func.call(
      context,
      {
        name: "Metric Rule",
        query: "event.type:error",
        aggregate: "count()",
        dataset: "errors",
        "time-window": 5,
        trigger: ['{"alertThreshold":100,"actions":[{"id":"notify"}]}'],
        "dry-run": false,
        json: true,
      },
      "test-org"
    );

    expect(createSpy).toHaveBeenCalledWith("test-org", {
      name: "Metric Rule",
      query: "event.type:error",
      aggregate: "count()",
      dataset: "errors",
      timeWindow: 5,
      triggers: [{ alertThreshold: 100, actions: [{ id: "notify" }] }],
    });
  });
});
