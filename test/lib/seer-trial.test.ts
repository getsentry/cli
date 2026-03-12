/**
 * Seer Trial Prompt Tests
 *
 * Tests for the interactive trial prompt flow.
 * Note: isTrialEligible tests that depend on isatty(0) mocking live in
 * test/isolated/ to avoid mock.module pollution. Tests here focus on
 * promptAndStartTrial which doesn't call isatty directly.
 */

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";

// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as apiClient from "../../src/lib/api-client.js";
import { SeerError } from "../../src/lib/errors.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as loggerModule from "../../src/lib/logger.js";
import {
  isTrialEligible,
  promptAndStartTrial,
} from "../../src/lib/seer-trial.js";

describe("isTrialEligible", () => {
  // Note: These tests run in a non-interactive terminal (bun test),
  // so isatty(0) returns false. We can only test the false cases here.
  // The positive case (isatty=true) would need mock.module in an isolated test.

  test("returns false for ai_disabled reason", () => {
    const err = new SeerError("ai_disabled", "test-org");
    expect(isTrialEligible(err)).toBe(false);
  });

  test("returns false when orgSlug is undefined", () => {
    const err = new SeerError("no_budget");
    expect(isTrialEligible(err)).toBe(false);
  });

  test("returns false when orgSlug is undefined for not_enabled", () => {
    const err = new SeerError("not_enabled");
    expect(isTrialEligible(err)).toBe(false);
  });
});

describe("promptAndStartTrial", () => {
  let getProductTrialsSpy: ReturnType<typeof spyOn>;
  let startProductTrialSpy: ReturnType<typeof spyOn>;
  let loggerPromptSpy: ReturnType<typeof spyOn>;
  let loggerWithTagSpy: ReturnType<typeof spyOn>;
  let stderrOutput: string;
  let mockStderr: NodeJS.WriteStream;

  const MOCK_SEER_TRIAL = {
    category: "seerUsers",
    startDate: null,
    endDate: null,
    reasonCode: 0,
    isStarted: false,
    lengthDays: 14,
  };

  beforeEach(() => {
    stderrOutput = "";
    mockStderr = {
      write(data: string) {
        stderrOutput += data;
      },
    } as unknown as NodeJS.WriteStream;

    getProductTrialsSpy = spyOn(
      apiClient,
      "getProductTrials"
    ).mockResolvedValue([]);
    startProductTrialSpy = spyOn(
      apiClient,
      "startProductTrial"
    ).mockResolvedValue(undefined);

    // Mock the logger's withTag to return an object with a mock prompt
    loggerPromptSpy = spyOn({ prompt: async () => false }, "prompt");
    const mockLogInstance = { prompt: loggerPromptSpy };
    loggerWithTagSpy = spyOn(loggerModule.logger, "withTag").mockReturnValue(
      mockLogInstance as ReturnType<typeof loggerModule.logger.withTag>
    );
  });

  afterEach(() => {
    getProductTrialsSpy.mockRestore();
    startProductTrialSpy.mockRestore();
    loggerWithTagSpy.mockRestore();
  });

  test("returns false when no trial is available", async () => {
    getProductTrialsSpy.mockResolvedValue([]);

    const result = await promptAndStartTrial(
      "test-org",
      "no_budget",
      mockStderr
    );

    expect(result).toBe(false);
    expect(getProductTrialsSpy).toHaveBeenCalledWith("test-org");
    // Should not prompt if no trial available
    expect(loggerPromptSpy).not.toHaveBeenCalled();
  });

  test("returns false when only non-seer trials exist", async () => {
    getProductTrialsSpy.mockResolvedValue([
      { ...MOCK_SEER_TRIAL, category: "replays" },
    ]);

    const result = await promptAndStartTrial(
      "test-org",
      "no_budget",
      mockStderr
    );

    expect(result).toBe(false);
    expect(loggerPromptSpy).not.toHaveBeenCalled();
  });

  test("returns false when seer trial is already started", async () => {
    getProductTrialsSpy.mockResolvedValue([
      { ...MOCK_SEER_TRIAL, isStarted: true },
    ]);

    const result = await promptAndStartTrial(
      "test-org",
      "no_budget",
      mockStderr
    );

    expect(result).toBe(false);
    expect(loggerPromptSpy).not.toHaveBeenCalled();
  });

  test("returns false when trial check throws (graceful degradation)", async () => {
    getProductTrialsSpy.mockRejectedValue(new Error("Network error"));

    const result = await promptAndStartTrial(
      "test-org",
      "no_budget",
      mockStderr
    );

    expect(result).toBe(false);
    expect(loggerPromptSpy).not.toHaveBeenCalled();
  });

  test("returns false when user declines the prompt", async () => {
    getProductTrialsSpy.mockResolvedValue([MOCK_SEER_TRIAL]);
    loggerPromptSpy.mockResolvedValue(false);

    const result = await promptAndStartTrial(
      "test-org",
      "no_budget",
      mockStderr
    );

    expect(result).toBe(false);
    expect(stderrOutput).toContain("run out of Seer quota");
    expect(startProductTrialSpy).not.toHaveBeenCalled();
  });

  test("returns false when user cancels with Ctrl+C (Symbol)", async () => {
    getProductTrialsSpy.mockResolvedValue([MOCK_SEER_TRIAL]);
    // consola returns Symbol(clack:cancel) on Ctrl+C
    loggerPromptSpy.mockResolvedValue(Symbol("clack:cancel"));

    const result = await promptAndStartTrial(
      "test-org",
      "no_budget",
      mockStderr
    );

    expect(result).toBe(false);
    expect(startProductTrialSpy).not.toHaveBeenCalled();
  });

  test("starts trial and returns true on confirmation", async () => {
    getProductTrialsSpy.mockResolvedValue([MOCK_SEER_TRIAL]);
    loggerPromptSpy.mockResolvedValue(true);
    startProductTrialSpy.mockResolvedValue(undefined);

    const result = await promptAndStartTrial(
      "test-org",
      "no_budget",
      mockStderr
    );

    expect(result).toBe(true);
    expect(startProductTrialSpy).toHaveBeenCalledWith("test-org", "seerUsers");
    expect(stderrOutput).toContain("Starting Seer trial...");
    expect(stderrOutput).toContain("Seer trial activated!");
  });

  test("prefers seerUsers over seerAutofix", async () => {
    getProductTrialsSpy.mockResolvedValue([
      { ...MOCK_SEER_TRIAL, category: "seerAutofix" },
      MOCK_SEER_TRIAL,
    ]);
    loggerPromptSpy.mockResolvedValue(true);
    startProductTrialSpy.mockResolvedValue(undefined);

    const result = await promptAndStartTrial(
      "test-org",
      "no_budget",
      mockStderr
    );

    expect(result).toBe(true);
    expect(startProductTrialSpy).toHaveBeenCalledWith("test-org", "seerUsers");
  });

  test("falls back to seerAutofix when seerUsers is not available", async () => {
    getProductTrialsSpy.mockResolvedValue([
      { ...MOCK_SEER_TRIAL, category: "seerAutofix" },
    ]);
    loggerPromptSpy.mockResolvedValue(true);
    startProductTrialSpy.mockResolvedValue(undefined);

    const result = await promptAndStartTrial(
      "test-org",
      "no_budget",
      mockStderr
    );

    expect(result).toBe(true);
    expect(startProductTrialSpy).toHaveBeenCalledWith(
      "test-org",
      "seerAutofix"
    );
  });

  test("returns false when trial start fails", async () => {
    getProductTrialsSpy.mockResolvedValue([MOCK_SEER_TRIAL]);
    loggerPromptSpy.mockResolvedValue(true);
    startProductTrialSpy.mockRejectedValue(new Error("API error"));

    const result = await promptAndStartTrial(
      "test-org",
      "no_budget",
      mockStderr
    );

    expect(result).toBe(false);
    expect(stderrOutput).toContain("Failed to start trial");
  });

  test("shows correct context message for not_enabled reason", async () => {
    getProductTrialsSpy.mockResolvedValue([MOCK_SEER_TRIAL]);
    loggerPromptSpy.mockResolvedValue(false);

    await promptAndStartTrial("test-org", "not_enabled", mockStderr);

    expect(stderrOutput).toContain("not enabled for your organization");
  });

  test("shows correct context message for no_budget reason", async () => {
    getProductTrialsSpy.mockResolvedValue([MOCK_SEER_TRIAL]);
    loggerPromptSpy.mockResolvedValue(false);

    await promptAndStartTrial("test-org", "no_budget", mockStderr);

    expect(stderrOutput).toContain("run out of Seer quota");
  });

  test("includes trial length in prompt message", async () => {
    getProductTrialsSpy.mockResolvedValue([MOCK_SEER_TRIAL]);
    loggerPromptSpy.mockResolvedValue(false);

    await promptAndStartTrial("test-org", "no_budget", mockStderr);

    expect(loggerPromptSpy).toHaveBeenCalled();
    const promptMessage = loggerPromptSpy.mock.calls[0]?.[0] as string;
    expect(promptMessage).toContain("14-day");
  });

  test("omits trial length when null", async () => {
    getProductTrialsSpy.mockResolvedValue([
      { ...MOCK_SEER_TRIAL, lengthDays: null },
    ]);
    loggerPromptSpy.mockResolvedValue(false);

    await promptAndStartTrial("test-org", "no_budget", mockStderr);

    expect(loggerPromptSpy).toHaveBeenCalled();
    const promptMessage = loggerPromptSpy.mock.calls[0]?.[0] as string;
    expect(promptMessage).not.toContain("day");
    expect(promptMessage).toContain("free Seer trial");
  });
});
