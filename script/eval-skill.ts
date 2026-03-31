#!/usr/bin/env bun
/**
 * Evaluate SKILL.md effectiveness by testing LLM command planning.
 *
 * Sends test prompts to agent models (Opus 4.6 + Sonnet 4.6) with SKILL.md
 * as context, then grades the planned commands on efficiency criteria.
 *
 * Requires ANTHROPIC_API_KEY env var for Anthropic API access.
 * In CI, the key is stored in the "skill-eval" environment (protected).
 *
 * Usage:
 *   bun run eval:skill
 *   EVAL_AGENT_MODELS=claude-sonnet-4-6-20250627 bun run eval:skill
 *
 * Environment variables:
 *   ANTHROPIC_API_KEY   - Anthropic API key (required)
 *   EVAL_AGENT_MODELS   - Comma-separated model IDs (default: sonnet-4-6, opus-4-6)
 *   EVAL_JUDGE_MODEL    - Judge model ID (default: haiku-4-5)
 *   EVAL_THRESHOLD      - Minimum pass rate 0-1 (default: 0.75)
 */

import cases from "../test/skill-eval/cases.json";
import { judgePlan } from "../test/skill-eval/helpers/judge.js";
import { createClient } from "../test/skill-eval/helpers/llm-client.js";
import { generatePlan } from "../test/skill-eval/helpers/planner.js";
import {
  getExitCode,
  printReport,
  writeJsonReport,
} from "../test/skill-eval/helpers/report.js";
import type {
  CaseResult,
  EvalReport,
  ModelResult,
  TestCase,
} from "../test/skill-eval/helpers/types.js";

const SKILL_PATH = "plugins/sentry-cli/skills/sentry-cli/SKILL.md";
const RESULTS_PATH = "test/skill-eval/results.json";
const VERSION_RE = /^version:\s*(.+)$/m;

/**
 * Default pass threshold — set from baseline run (2026-03-30).
 * Baseline: openai/gpt-4.1 scored 100% (8/8 cases).
 * Set to 75% to allow for LLM non-determinism while catching regressions.
 */
const DEFAULT_THRESHOLD = 0.75;

/** Run all eval cases against a single model */
async function evalModel(
  client: Awaited<ReturnType<typeof createClient>>,
  model: string,
  skillContent: string,
  testCases: TestCase[]
): Promise<ModelResult> {
  console.log(`\nEvaluating: ${model}`);
  console.log("─".repeat(40));

  const results: CaseResult[] = [];

  for (const testCase of testCases) {
    process.stdout.write(`  ${testCase.id}... `);

    const plan = await generatePlan(
      client,
      model,
      skillContent,
      testCase.prompt
    );
    const result = await judgePlan(client, testCase, plan);
    results.push(result);

    const icon = result.passed ? "✓" : "✗";
    console.log(`${icon} (${(result.score * 100).toFixed(0)}%)`);
  }

  const totalPassed = results.filter((r) => r.passed).length;
  const score = results.length > 0 ? totalPassed / results.length : 0;

  return {
    model,
    cases: results,
    totalPassed,
    totalCases: results.length,
    score,
  };
}

async function main(): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("Error: ANTHROPIC_API_KEY is required for the skill eval.");
    console.error("Set it via: export ANTHROPIC_API_KEY=<your-key>");
    process.exit(1);
  }

  const client = await createClient(apiKey);
  const skillContent = await Bun.file(SKILL_PATH).text();
  const testCases = cases as unknown as TestCase[];
  const threshold = process.env.EVAL_THRESHOLD
    ? Number.parseFloat(process.env.EVAL_THRESHOLD)
    : DEFAULT_THRESHOLD;

  console.log(
    `Skill eval: ${testCases.length} cases × ${client.agentModels.length} models`
  );
  console.log(`Agent models: ${client.agentModels.join(", ")}`);
  console.log(`Judge model: ${client.judgeModel}`);
  console.log(`Threshold: ${(threshold * 100).toFixed(0)}%`);

  // Extract skill version from YAML frontmatter
  const versionMatch = skillContent.match(VERSION_RE);
  const skillVersion = versionMatch?.[1]?.trim() ?? "unknown";

  const models: ModelResult[] = [];
  for (const model of client.agentModels) {
    const result = await evalModel(client, model, skillContent, testCases);
    models.push(result);
  }

  const report: EvalReport = {
    timestamp: new Date().toISOString(),
    skillVersion,
    threshold,
    models,
  };

  printReport(report);
  await writeJsonReport(report, RESULTS_PATH);

  process.exit(getExitCode(report));
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
