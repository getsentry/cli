/**
 * Phase 2: Grade the agent's plan against test case criteria.
 *
 * Two passes:
 * 1. Deterministic — string matching for anti-patterns, expected-patterns, max-commands
 * 2. LLM judge — coherence/quality check using a cheap model (Haiku 4.6)
 */

import type { LLMClient } from "./llm-client.js";
import { chatCompletion } from "./llm-client.js";
import type {
  AgentPlan,
  CaseResult,
  CriterionDef,
  CriterionResult,
  TestCase,
} from "./types.js";

/**
 * Evaluate a single deterministic criterion against the plan's commands.
 * Returns a pass/fail result with a human-readable reason.
 */
function evaluateDeterministic(
  name: string,
  def: CriterionDef,
  plan: AgentPlan
): CriterionResult {
  const allCommands = plan.commands.map((c) => c.command.toLowerCase());

  // Check anti-patterns: none of these strings should appear in any command
  if (def["anti-patterns"]) {
    for (const pattern of def["anti-patterns"]) {
      const found = allCommands.find((cmd) =>
        cmd.includes(pattern.toLowerCase())
      );
      if (found) {
        return {
          name,
          pass: false,
          reason: `Found anti-pattern '${pattern}' in: ${found}`,
        };
      }
    }
  }

  // Check expected patterns: at least one command must contain each pattern
  if (def["expected-patterns"]) {
    for (const pattern of def["expected-patterns"]) {
      const lowerPattern = pattern.toLowerCase();
      if (!allCommands.some((cmd) => cmd.includes(lowerPattern))) {
        return {
          name,
          pass: false,
          reason: `Expected pattern '${pattern}' not found in any command`,
        };
      }
    }
  }

  // Check max commands
  if (
    def["max-commands"] !== undefined &&
    plan.commands.length > def["max-commands"]
  ) {
    return {
      name,
      pass: false,
      reason: `Too many commands: ${plan.commands.length} (max: ${def["max-commands"]})`,
    };
  }

  return { name, pass: true, reason: def.brief };
}

/**
 * Use the LLM judge to evaluate overall plan quality.
 * The command reference (extracted from SKILL.md) grounds the judge so it
 * doesn't hallucinate that valid `sentry` commands don't exist.
 */
async function evaluateWithLLMJudge(
  client: LLMClient,
  prompt: string,
  plan: AgentPlan,
  commandReference: string
): Promise<CriterionResult> {
  const commandList = plan.commands
    .map((c, i) => `${i + 1}. \`${c.command}\` — ${c.purpose}`)
    .join("\n");

  const judgePrompt = `You are evaluating whether an AI agent's CLI command plan is good.

The agent was given a skill guide for the \`sentry\` CLI (not the legacy \`sentry-cli\`).
Here are the valid commands from that guide:

${commandReference}

Important context about how this CLI works:
- Positional args like \`<org/project>\` are OPTIONAL — the CLI auto-detects org and project from the local directory context (DSN detection). Omitting them is correct and expected.
- Each command supports additional flags (e.g., --json, --query, --limit, --period, --fields) documented in separate reference files. The compact listing above only shows command signatures, not all flags.
- --json is a global flag available on all list/view commands.

The user asked: "${prompt}"

The agent's plan:
Thinking: ${plan.thinking}
Commands:
${commandList}
Notes: ${plan.notes}

Evaluate the plan on overall quality. A good plan:
- Uses commands that exist in the reference above
- Would actually work if executed
- Is efficient (no unnecessary commands)
- Directly addresses what the user asked for

Do NOT penalize:
- Commands that appear in the reference above — this is a real CLI tool
- Omitting org/project args — auto-detection is a core feature
- Using flags like --json, --query, --limit, --fields, --period — they are real flags

Return ONLY valid JSON:
{"pass": true, "reason": "Brief explanation"}

or

{"pass": false, "reason": "Brief explanation of what's wrong"}`;

  try {
    const text = await chatCompletion(
      client,
      client.judgeModel,
      [{ role: "user", content: judgePrompt }],
      512
    );

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return {
        name: "overall-quality",
        pass: false,
        reason: "Judge failed to return valid JSON",
      };
    }

    const parsed = JSON.parse(jsonMatch[0]) as {
      pass: boolean;
      reason: string;
    };
    return {
      name: "overall-quality",
      pass: parsed.pass === true,
      reason: parsed.reason,
    };
  } catch (err) {
    return {
      name: "overall-quality",
      pass: false,
      reason: `Judge error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Evaluate a test case's plan against all its criteria.
 * Runs deterministic checks first, then the LLM judge for overall quality.
 *
 * @param commandReference - The Command Reference section from SKILL.md,
 *   injected into the judge prompt so it can verify commands exist.
 */
export async function judgePlan(
  client: LLMClient,
  testCase: TestCase,
  plan: AgentPlan | null,
  commandReference: string
): Promise<CaseResult> {
  // If the planner failed to produce a plan, fail all criteria
  if (!plan) {
    const criteria = Object.keys(testCase.criteria).map((name) => ({
      name,
      pass: false,
      reason: "No plan generated — planner failed",
    }));
    criteria.push({
      name: "overall-quality",
      pass: false,
      reason: "No plan generated — planner failed",
    });
    return {
      caseId: testCase.id,
      prompt: testCase.prompt,
      plan: null,
      criteria,
      score: 0,
      passed: false,
    };
  }

  // Run deterministic checks
  const criteria: CriterionResult[] = [];
  for (const [name, def] of Object.entries(testCase.criteria)) {
    criteria.push(evaluateDeterministic(name, def, plan));
  }

  // Run LLM judge for overall quality
  const llmVerdict = await evaluateWithLLMJudge(
    client,
    testCase.prompt,
    plan,
    commandReference
  );
  criteria.push(llmVerdict);

  // Compute score: fraction of criteria that passed
  const passing = criteria.filter((c) => c.pass).length;
  const score = criteria.length > 0 ? passing / criteria.length : 0;

  return {
    caseId: testCase.id,
    prompt: testCase.prompt,
    plan,
    criteria,
    score,
    passed: criteria.every((c) => c.pass),
  };
}
