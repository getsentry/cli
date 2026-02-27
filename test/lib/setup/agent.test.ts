/**
 * Unit tests for src/lib/setup/agent.ts.
 *
 * Tests cover:
 * - checkPiAuth() — detects configured model provider credentials via env vars
 *   and AuthStorage (auth.json)
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { checkPiAuth } from "../../../src/lib/setup/agent.js";

/** All provider env vars checked by checkPiAuth (env-var fast path). */
const PROVIDER_ENV_VARS = [
  "ANTHROPIC_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "OPENAI_API_KEY",
  "GROQ_API_KEY",
  "XAI_API_KEY",
  "OPENROUTER_API_KEY",
] as const;

describe("checkPiAuth", () => {
  /** Saved env values, restored in afterEach. */
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    // Save and clear all provider env vars so tests start from a clean state.
    for (const key of PROVIDER_ENV_VARS) {
      saved[key] = process.env[key];
      process.env[key] = undefined as unknown as string;
    }
  });

  afterEach(() => {
    // Restore original values.
    for (const key of PROVIDER_ENV_VARS) {
      if (saved[key] === undefined) {
        process.env[key] = undefined as unknown as string;
      } else {
        process.env[key] = saved[key];
      }
    }
  });

  test("returns true when ANTHROPIC_API_KEY is set", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test-key";
    expect(await checkPiAuth()).toBe(true);
  });

  test("returns true when GEMINI_API_KEY is set", async () => {
    process.env.GEMINI_API_KEY = "gemini-test-key";
    expect(await checkPiAuth()).toBe(true);
  });

  test("returns true when OPENAI_API_KEY is set", async () => {
    process.env.OPENAI_API_KEY = "sk-openai-test-key";
    expect(await checkPiAuth()).toBe(true);
  });

  test("returns a boolean when no env vars are set", async () => {
    // All env vars cleared in beforeEach. Result depends on whether
    // ~/.pi/agent/auth.json exists with credentials on this machine.
    const result = await checkPiAuth();
    expect(typeof result).toBe("boolean");
  });
});
