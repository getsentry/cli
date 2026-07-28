/**
 * LLM client for the skill eval framework.
 *
 * Uses the Anthropic Messages API via @anthropic-ai/sdk (already in
 * devDependencies). Works against either Anthropic direct or OpenRouter,
 * resolved from the environment via {@link resolveEvalProvider}.
 */

import type { EvalProvider } from "../../eval-common/anthropic-client.js";

/** Default agent models — the target models for the skill */
export const DEFAULT_AGENT_MODELS = ["claude-sonnet-4-6", "claude-opus-4-6"];

/** Default judge model — cheap and fast, just needs to grade command plans */
export const DEFAULT_JUDGE_MODEL = "claude-haiku-4-5-20251001";

export type LLMClient = {
  client: InstanceType<typeof import("@anthropic-ai/sdk").default>;
  agentModels: string[];
  judgeModel: string;
};

/**
 * Create an LLM client for the eval framework.
 *
 * Model IDs are qualified for the active provider (e.g. `anthropic/` prefix on
 * OpenRouter). Agent models and judge model can be overridden via env vars:
 * - EVAL_AGENT_MODELS: comma-separated list of model IDs
 * - EVAL_JUDGE_MODEL: single model ID
 *
 * @param provider - Resolved provider config (key, base URL, model qualifier)
 */
export async function createClient(provider: EvalProvider): Promise<LLMClient> {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");

  const client = new Anthropic({
    apiKey: provider.apiKey,
    baseURL: provider.baseURL,
  });

  const baseAgentModels = process.env.EVAL_AGENT_MODELS
    ? process.env.EVAL_AGENT_MODELS.split(",").map((m) => m.trim())
    : DEFAULT_AGENT_MODELS;
  const agentModels = baseAgentModels.map(provider.qualifyModel);

  const judgeModel = provider.qualifyModel(
    process.env.EVAL_JUDGE_MODEL ?? DEFAULT_JUDGE_MODEL
  );

  return { client, agentModels, judgeModel };
}

/** Send a message and return the text response */
export async function chatCompletion(
  llm: LLMClient,
  model: string,
  messages: { role: "system" | "user"; content: string }[],
  maxTokens = 2048
): Promise<string> {
  // Separate system prompt from user messages (Anthropic API style)
  const systemMsg = messages.find((m) => m.role === "system");
  const userMsgs = messages
    .filter((m) => m.role === "user")
    .map((m) => ({ role: "user" as const, content: m.content }));

  const response = await llm.client.messages.create({
    model,
    max_tokens: maxTokens,
    system: systemMsg?.content,
    messages: userMsgs,
  });

  // Extract text from content blocks
  const textBlock = response.content.find((b) => b.type === "text");
  return textBlock?.text ?? "";
}
