import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createCommand } from "../../../../src/commands/alert/issues/create.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as apiClient from "../../../../src/lib/api-client.js";
import { ValidationError } from "../../../../src/lib/errors.js";
import type { ResolvedTarget } from "../../../../src/lib/resolve-target.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as resolveTarget from "../../../../src/lib/resolve-target.js";
import { useTestConfigDir } from "../../../helpers.js";

const getConfigDir = useTestConfigDir("test-alert-issues-create-", {
  isolateProjectRoot: true,
});

const sampleTarget: ResolvedTarget = {
  org: "test-org",
  project: "test-project",
  orgDisplay: "test-org",
  projectDisplay: "test-project",
};

type CreateFlags = {
  readonly name: string;
  readonly condition?: string[];
  readonly action?: string[];
  readonly "action-match"?: "all" | "any";
  readonly frequency: number;
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

describe("alert issues create", () => {
  let resolveSpy: ReturnType<typeof vi.spyOn>;
  let createSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resolveSpy = vi.spyOn(resolveTarget, "resolveTargetsFromParsedArg");
    createSpy = vi.spyOn(apiClient, "createIssueAlertRule");
  });

  afterEach(() => {
    resolveSpy.mockRestore();
    createSpy.mockRestore();
  });

  test("requires --action-match", async () => {
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
          name: "Rule A",
          condition: ['{"id":"condition-a"}'],
          action: ['{"id":"action-a"}'],
          frequency: 30,
          "dry-run": true,
          json: true,
        },
        "test-org/test-project"
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
        name: "Rule A",
        condition: ['{"id":"condition-a"}'],
        action: ['{"id":"action-a"}'],
        "action-match": "all",
        frequency: 30,
        "dry-run": true,
        json: true,
      },
      "test-org/test-project"
    );

    expect(createSpy).not.toHaveBeenCalled();
  });

  test("calls create API with parsed body", async () => {
    const context = createContext();
    resolveSpy.mockResolvedValue({ targets: [sampleTarget] });
    createSpy.mockResolvedValue({
      id: "99",
      name: "Rule A",
      status: "active",
    });
    const func = (await createCommand.loader()) as unknown as (
      this: unknown,
      flags: CreateFlags,
      arg: string
    ) => Promise<void>;

    await func.call(
      context,
      {
        name: "Rule A",
        condition: ['{"id":"condition-a"}'],
        action: ['{"id":"action-a"}'],
        "action-match": "any",
        frequency: 15,
        "dry-run": false,
        json: true,
      },
      "test-org/test-project"
    );

    expect(createSpy).toHaveBeenCalledWith("test-org", "test-project", {
      name: "Rule A",
      conditions: [{ id: "condition-a" }],
      actions: [{ id: "action-a" }],
      actionMatch: "any",
      frequency: 15,
    });
  });
});
