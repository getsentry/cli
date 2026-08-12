/**
 * Tip-hint suppression tests (getsentry/cli#1412).
 *
 * Covers the `--no-tips` flag and `SENTRY_DISABLE_TIPS` env var precedence.
 */

import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { setEnv } from "../../src/lib/env.js";
import { tipsSuppressed } from "../../src/lib/tips.js";

describe("tipsSuppressed", () => {
  beforeEach(() => {
    setEnv({});
  });

  afterEach(() => {
    setEnv(process.env);
  });

  test("shows tips by default", () => {
    expect(tipsSuppressed(true)).toBe(false);
    expect(tipsSuppressed(undefined)).toBe(false);
  });

  test("suppresses tips when --no-tips passed (flag false)", () => {
    expect(tipsSuppressed(false)).toBe(true);
  });

  test("--no-tips wins even if env would enable tips", () => {
    setEnv({ SENTRY_DISABLE_TIPS: "0" });
    expect(tipsSuppressed(false)).toBe(true);
  });

  test("suppresses tips when SENTRY_DISABLE_TIPS is truthy", () => {
    for (const val of ["1", "true", "yes"]) {
      setEnv({ SENTRY_DISABLE_TIPS: val });
      expect(tipsSuppressed(true)).toBe(true);
    }
  });

  test("does not suppress when SENTRY_DISABLE_TIPS is falsy", () => {
    for (const val of ["0", "false", ""]) {
      setEnv({ SENTRY_DISABLE_TIPS: val });
      expect(tipsSuppressed(true)).toBe(false);
    }
  });
});
