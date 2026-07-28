import { describe, expect, test } from "vitest";
import {
  OPENROUTER_BASE_URL,
  resolveEvalProvider,
} from "../eval-common/anthropic-client.js";

/**
 * Provider resolution drives which credential/base URL/model namespace the
 * eval frameworks use. These tests lock in the precedence (OpenRouter over
 * Anthropic), the `anthropic/` model prefixing, its idempotency, and the
 * null-when-unset skip contract.
 */
describe("resolveEvalProvider", () => {
  test("returns null when no credential is set", () => {
    expect(resolveEvalProvider({})).toBeNull();
  });

  test("treats blank/whitespace keys as unset", () => {
    expect(
      resolveEvalProvider({ OPENROUTER_API_KEY: "  ", ANTHROPIC_API_KEY: "" })
    ).toBeNull();
  });

  test("prefers OpenRouter when both keys are set", () => {
    const p = resolveEvalProvider({
      OPENROUTER_API_KEY: "or-key",
      ANTHROPIC_API_KEY: "an-key",
    });
    expect(p?.provider).toBe("openrouter");
    expect(p?.apiKey).toBe("or-key");
    expect(p?.baseURL).toBe(OPENROUTER_BASE_URL);
  });

  test("OpenRouter qualifies bare model IDs with anthropic/ prefix", () => {
    const p = resolveEvalProvider({ OPENROUTER_API_KEY: "or-key" });
    expect(p?.qualifyModel("claude-sonnet-4-6")).toBe(
      "anthropic/claude-sonnet-4-6"
    );
  });

  test("qualifyModel is idempotent (no double prefix)", () => {
    const p = resolveEvalProvider({ OPENROUTER_API_KEY: "or-key" });
    expect(p?.qualifyModel("anthropic/claude-opus-4-6")).toBe(
      "anthropic/claude-opus-4-6"
    );
  });

  test("falls back to Anthropic direct with bare model IDs", () => {
    const p = resolveEvalProvider({ ANTHROPIC_API_KEY: "an-key" });
    expect(p?.provider).toBe("anthropic");
    expect(p?.apiKey).toBe("an-key");
    expect(p?.baseURL).toBeUndefined();
    expect(p?.qualifyModel("claude-sonnet-4-6")).toBe("claude-sonnet-4-6");
  });

  test("honors explicit base URL overrides", () => {
    expect(
      resolveEvalProvider({
        OPENROUTER_API_KEY: "or-key",
        OPENROUTER_BASE_URL: "https://proxy.example/v1",
      })?.baseURL
    ).toBe("https://proxy.example/v1");
    expect(
      resolveEvalProvider({
        ANTHROPIC_API_KEY: "an-key",
        ANTHROPIC_BASE_URL: "https://proxy.example/anthropic",
      })?.baseURL
    ).toBe("https://proxy.example/anthropic");
  });

  test("EVAL_MODEL_PREFIX overrides the default prefix", () => {
    const p = resolveEvalProvider({
      OPENROUTER_API_KEY: "or-key",
      EVAL_MODEL_PREFIX: "custom/",
    });
    expect(p?.qualifyModel("claude-sonnet-4-6")).toBe(
      "custom/claude-sonnet-4-6"
    );
  });
});
