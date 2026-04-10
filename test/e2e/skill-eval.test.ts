/**
 * SKILL.md Effectiveness Evaluation (E2E)
 *
 * Tests whether SKILL.md effectively guides LLMs to plan correct CLI commands.
 * Uses the real CLI binary (via SENTRY_CLI_BINARY or dev mode) to verify
 * that planned commands actually exist.
 *
 * Skips automatically when ANTHROPIC_API_KEY is not set.
 * In CI, the key is only passed when skill-related files change.
 */

import { describe, expect, test } from "bun:test";
import cases from "../skill-eval/cases.json";
import { judgePlan } from "../skill-eval/helpers/judge.js";
import { createClient } from "../skill-eval/helpers/llm-client.js";
import { generatePlan } from "../skill-eval/helpers/planner.js";
import type { CaseResult, TestCase } from "../skill-eval/helpers/types.js";

const SKILL_PATH = "plugins/sentry-cli/skills/sentry-cli/SKILL.md";
const DEFAULT_THRESHOLD = 0.75;

const apiKey = process.env.ANTHROPIC_API_KEY;

describe.skipIf(!apiKey)("skill eval", () => {
  const testCases = cases as unknown as TestCase[];
  const threshold = process.env.EVAL_THRESHOLD
    ? Number.parseFloat(process.env.EVAL_THRESHOLD)
    : DEFAULT_THRESHOLD;

  /**
   * Run the full eval for a single model and assert it meets the threshold.
   * Each model gets its own test so failures are attributed clearly.
   */
  async function runEvalForModel(model: string): Promise<void> {
    const client = await createClient(apiKey as string);
    const skillContent = await Bun.file(SKILL_PATH).text();

    const results: CaseResult[] = [];
    for (const testCase of testCases) {
      const plan = await generatePlan(
        client,
        model,
        skillContent,
        testCase.prompt
      );
      const result = await judgePlan(client, testCase, plan);
      results.push(result);
    }

    const passed = results.filter((r) => r.passed).length;
    const score = passed / testCases.length;
    // biome-ignore lint/suspicious/noMisplacedAssertion: called from test() via helper
    expect(score).toBeGreaterThanOrEqual(threshold);
  }

  test(
    "claude-sonnet-4-6 meets threshold",
    () => runEvalForModel("claude-sonnet-4-6"),
    { timeout: 120_000 }
  );

  test(
    "claude-opus-4-6 meets threshold",
    () => runEvalForModel("claude-opus-4-6"),
    { timeout: 120_000 }
  );
});
