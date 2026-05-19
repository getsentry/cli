/**
 * Unit tests for handleFinalResult in wizard-runner.ts.
 *
 * Kept as a mocked sibling file because mock.module() on @sentry/node-core/light
 * would pollute the module graph for other wizard-runner tests that may not
 * want Sentry calls mocked.
 */

import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { WizardOutput, WorkflowRunResult } from "../../src/lib/init/types.js";

// ============================================================================
// Mock Setup — must precede all imports of the module under test
// ============================================================================

const tags: Record<string, unknown> = {};

mock.module("@sentry/node-core/light", () => ({
  addBreadcrumb: () => {},
  captureException: () => {},
  getTraceData: () => ({}),
  setTag: (key: string, value: unknown) => {
    tags[key] = value;
  },
}));

// Import AFTER mock setup so the mocked module is used
import { handleFinalResult } from "../../src/lib/init/wizard-runner.js";
import { WizardError } from "../../src/lib/errors.js";

// ============================================================================
// Test helpers
// ============================================================================

function makeSpinnerHandle() {
  return { start: () => {}, stop: () => {} };
}

function makeSpinState(running = false) {
  return { running };
}

/** Minimal WizardUI stub — only the methods formatError touches. */
function makeUI() {
  return {
    log: { error: () => {}, warn: () => {}, info: () => {}, message: () => {} },
    cancel: () => {},
    feedback: () => {},
    summary: () => {},
    outro: () => {},
    intro: () => {},
    setStep: () => {},
    markFilesAnalyzed: () => {},
  } as any;
}

function makeBailResult(partial: Partial<WizardOutput> = {}): WorkflowRunResult {
  return {
    status: "success",
    result: { exitCode: 30, ...partial },
  };
}

// ============================================================================
// Tests
// ============================================================================

beforeEach(() => {
  for (const key of Object.keys(tags)) {
    delete tags[key];
  }
});

describe("handleFinalResult", () => {
  describe("WizardError message", () => {
    test("uses bail message from result.result.message when present", () => {
      const result = makeBailResult({
        message: "Dependency installation failed after 5 attempts: pnpm exited with code 1",
      });

      expect(() =>
        handleFinalResult(result, makeSpinnerHandle(), makeSpinState(), makeUI())
      ).toThrow(
        "Dependency installation failed after 5 attempts: pnpm exited with code 1"
      );
    });

    test("falls back to generic message when result.result.message is absent", () => {
      const result = makeBailResult({ message: undefined });

      expect(() =>
        handleFinalResult(result, makeSpinnerHandle(), makeSpinState(), makeUI())
      ).toThrow("Workflow returned an error");
    });
  });

  describe("wizard.exit_code tag", () => {
    test("tags wizard.exit_code with the workflow exit code", () => {
      const result = makeBailResult({ exitCode: 11 });

      expect(() =>
        handleFinalResult(result, makeSpinnerHandle(), makeSpinState(), makeUI())
      ).toThrow(WizardError);

      expect(tags["wizard.exit_code"]).toBe(11);
    });

    test("does not set wizard.exit_code when exitCode is absent", () => {
      const result: WorkflowRunResult = { status: "failed", error: "network error" };

      expect(() =>
        handleFinalResult(result, makeSpinnerHandle(), makeSpinState(), makeUI())
      ).toThrow(WizardError);

      expect(tags["wizard.exit_code"]).toBeUndefined();
    });
  });
});
