/**
 * Shared Anthropic/OpenRouter client resolution for the eval frameworks.
 *
 * Both the skill-eval and init-eval suites talk to Claude models via the
 * `@anthropic-ai/sdk`. OpenRouter is Anthropic-Messages-API-compatible, so the
 * same SDK works against it by overriding the base URL and namespacing model
 * IDs (`anthropic/claude-...`).
 *
 * Provider selection is credential-driven:
 * - `OPENROUTER_API_KEY` set  → OpenRouter (base URL + `anthropic/` model prefix)
 * - else `ANTHROPIC_API_KEY`  → Anthropic direct (bare model IDs)
 * - neither                   → `null` (callers skip the eval)
 *
 * The base URL and model prefix can be overridden explicitly for either
 * provider via `OPENROUTER_BASE_URL` / `ANTHROPIC_BASE_URL` and
 * `EVAL_MODEL_PREFIX`.
 */

/** Default OpenRouter base URL for the Anthropic-compatible SDK. */
export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

/** Model-ID namespace OpenRouter requires for Anthropic models. */
export const OPENROUTER_MODEL_PREFIX = "anthropic/";

/**
 * Resolved provider configuration for an eval run.
 *
 * `qualifyModel` maps a bare Claude model ID (e.g. `claude-sonnet-4-6`) to the
 * form the active provider expects. It is idempotent — a model ID that already
 * carries the prefix is returned unchanged, so callers may pass fully-qualified
 * IDs through `EVAL_AGENT_MODELS` without double-prefixing.
 */
export type EvalProvider = {
  /** API key passed to the Anthropic SDK. */
  apiKey: string;
  /** Base URL override, or `undefined` for the SDK default (Anthropic direct). */
  baseURL: string | undefined;
  /** Which provider was selected — for logging/diagnostics. */
  provider: "openrouter" | "anthropic";
  /** Map a bare model ID to the provider-qualified form (idempotent). */
  qualifyModel: (model: string) => string;
};

/**
 * Resolve the eval provider from the environment.
 *
 * @returns provider config, or `null` when no API key is available so the
 *   caller can skip (matching the historical `!apiKey` skip behavior).
 */
export function resolveEvalProvider(
  env: NodeJS.ProcessEnv = process.env
): EvalProvider | null {
  const openRouterKey = env.OPENROUTER_API_KEY?.trim();
  const anthropicKey = env.ANTHROPIC_API_KEY?.trim();
  const prefixOverride = env.EVAL_MODEL_PREFIX;

  if (openRouterKey) {
    const prefix = prefixOverride ?? OPENROUTER_MODEL_PREFIX;
    return {
      apiKey: openRouterKey,
      baseURL: env.OPENROUTER_BASE_URL?.trim() || OPENROUTER_BASE_URL,
      provider: "openrouter",
      qualifyModel: (model) => qualifyModel(model, prefix),
    };
  }

  if (anthropicKey) {
    const prefix = prefixOverride ?? "";
    return {
      apiKey: anthropicKey,
      baseURL: env.ANTHROPIC_BASE_URL?.trim() || undefined,
      provider: "anthropic",
      qualifyModel: (model) => qualifyModel(model, prefix),
    };
  }

  return null;
}

/**
 * Prefix a model ID with the provider namespace, unless it already carries it
 * or the prefix is empty. Idempotent.
 */
function qualifyModel(model: string, prefix: string): string {
  if (prefix.length === 0 || model.startsWith(prefix)) {
    return model;
  }
  return `${prefix}${model}`;
}
