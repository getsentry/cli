/**
 * Tests for the `issue plan` command's handling of the
 * WAITING_FOR_USER_RESPONSE root-cause state.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../../../src/commands/issue/utils.js", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../../src/commands/issue/utils.js")
    >();
  return Object.fromEntries(
    Object.entries(actual).map(([key, value]) => [
      key,
      typeof value === "function" ? vi.fn(value) : value,
    ])
  );
});

import { isatty } from "node:tty";
import { planCommand } from "../../../src/commands/issue/plan.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as issueUtils from "../../../src/commands/issue/utils.js";
import { CliError } from "../../../src/lib/errors.js";
import { logger } from "../../../src/lib/logger.js";
import type { AutofixState, RootCause } from "../../../src/types/seer.js";

vi.mock("node:tty", () => ({ isatty: vi.fn() }));

vi.mock("../../../src/lib/api-client.js", () => ({
  triggerSolutionPlanning: vi.fn(async () => ({})),
}));

const PLAN_FLAGS = { json: false, force: false, fresh: false } as const;

function sampleCause(id: number, description: string): RootCause {
  return { id, description };
}

function waitingState(causes: RootCause[]): AutofixState {
  return {
    status: "WAITING_FOR_USER_RESPONSE",
    run_id: 42,
    steps: [
      {
        id: "root-cause",
        key: "root_cause_analysis",
        status: "WAITING_FOR_USER_RESPONSE",
        title: "Root cause",
        causes,
      },
    ],
  };
}

function createMockContext() {
  return {
    stdout: { write: vi.fn(() => true) },
    stderr: { write: vi.fn(() => true) },
    cwd: "/tmp",
  };
}

async function runPlan(context: ReturnType<typeof createMockContext>) {
  const func = await planCommand.loader();
  await func.call(context, PLAN_FLAGS, "IOS-1");
}

describe("issue plan waiting-for-user-response", () => {
  let resolveSpy: ReturnType<typeof vi.spyOn>;
  let analyzeSpy: ReturnType<typeof vi.spyOn>;
  let promptSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    resolveSpy = vi.spyOn(issueUtils, "resolveOrgAndIssueId");
    analyzeSpy = vi.spyOn(issueUtils, "ensureRootCauseAnalysis");
    promptSpy = vi.fn();
    // The command prompts through a tagged logger, so intercept withTag.
    vi.spyOn(logger, "withTag").mockReturnValue({
      info: vi.fn(),
      prompt: promptSpy,
    } as unknown as ReturnType<typeof logger.withTag>);
    resolveSpy.mockResolvedValue({ org: "test-org", issueId: "1" });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("throws a UI hint when not interactive", async () => {
    vi.mocked(isatty).mockReturnValue(false);
    analyzeSpy.mockResolvedValue(waitingState([sampleCause(0, "A cause")]));

    await expect(runPlan(createMockContext())).rejects.toBeInstanceOf(CliError);
    expect(promptSpy).not.toHaveBeenCalled();
  });

  test("prompts for a root cause when interactive", async () => {
    vi.mocked(isatty).mockReturnValue(true);
    analyzeSpy.mockResolvedValue(
      waitingState([sampleCause(0, "First"), sampleCause(1, "Second")])
    );
    promptSpy.mockResolvedValue("1");
    const solutionSpy = vi
      .spyOn(issueUtils, "pollAutofixState")
      .mockResolvedValue({ status: "COMPLETED", run_id: 42, steps: [] });

    await runPlan(createMockContext());

    expect(promptSpy).toHaveBeenCalledWith(
      "Select a root cause to plan against:",
      expect.objectContaining({ type: "select" })
    );
    expect(solutionSpy).toHaveBeenCalled();
  });

  test("throws when the user cancels the selection", async () => {
    vi.mocked(isatty).mockReturnValue(true);
    analyzeSpy.mockResolvedValue(waitingState([sampleCause(0, "A cause")]));
    // consola returns a cancel symbol (non-string) when cancelled.
    promptSpy.mockResolvedValue(Symbol("clack:cancel"));

    await expect(runPlan(createMockContext())).rejects.toBeInstanceOf(CliError);
  });
});
