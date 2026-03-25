import { describe, expect, test } from "bun:test";
import sentry from "../../src/index.js";

describe("sentry() library function", () => {
  test("returns version string for --version", async () => {
    const result = await sentry("--version");
    expect(typeof result).toBe("string");
    // Version output is a semver string like "0.0.0-dev" or "0.21.0"
    expect(result as string).toMatch(/\d+\.\d+\.\d+/);
  });

  test("returns parsed object for help command in JSON mode", async () => {
    const result = await sentry("help");
    // help --json returns a parsed object with routes
    expect(typeof result).toBe("object");
    expect(result).toHaveProperty("routes");
  });

  test("throws when auth is required but missing", async () => {
    try {
      // issue list requires auth — with no token and isolated config, it should fail
      await sentry("issue", "list");
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      // The error should have an exitCode (either SentryError or CliError subclass)
      expect((err as { exitCode?: number }).exitCode).toBeGreaterThan(0);
    }
  });

  test("process.env is unchanged after successful call", async () => {
    const envBefore = { ...process.env };
    await sentry("--version");
    // Check that no new SENTRY_OUTPUT_FORMAT key leaked
    expect(process.env.SENTRY_OUTPUT_FORMAT).toBe(
      envBefore.SENTRY_OUTPUT_FORMAT
    );
    expect(process.env.SENTRY_AUTH_TOKEN).toBe(envBefore.SENTRY_AUTH_TOKEN);
  });

  test("process.env is unchanged after failed call", async () => {
    const envBefore = { ...process.env };
    try {
      await sentry("issue", "list");
    } catch {
      // expected
    }
    expect(process.env.SENTRY_OUTPUT_FORMAT).toBe(
      envBefore.SENTRY_OUTPUT_FORMAT
    );
  });

  test("{ text: true } returns string for help command", async () => {
    const result = await sentry("help", { text: true });
    expect(typeof result).toBe("string");
    expect(result as string).toContain("sentry");
  });

  test("accepts cwd option without error", async () => {
    const result = await sentry("--version", { cwd: "/tmp" });
    expect(typeof result).toBe("string");
  });
});
