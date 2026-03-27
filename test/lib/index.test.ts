import { describe, expect, test } from "bun:test";
import createSentrySDK, { SentryError } from "../../src/index.js";

describe("createSentrySDK() library API", () => {
  test("sdk.run returns version string for --version", async () => {
    const sdk = createSentrySDK();
    const result = await sdk.run("--version");
    expect(typeof result).toBe("string");
    // Version output is a semver string like "0.0.0-dev" or "0.21.0"
    expect(result as string).toMatch(/\d+\.\d+\.\d+/);
  });

  test("sdk.run returns parsed object for help command in JSON mode", async () => {
    const sdk = createSentrySDK();
    const result = await sdk.run("help");
    // help --json returns a parsed object with routes
    expect(typeof result).toBe("object");
    expect(result).toHaveProperty("routes");
  });

  test("sdk.run throws when auth is required but missing", async () => {
    const sdk = createSentrySDK();
    try {
      // issue list requires auth — with no token and isolated config, it should fail
      await sdk.run("issue", "list");
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      // The error should have an exitCode (either SentryError or CliError subclass)
      expect((err as { exitCode?: number }).exitCode).toBeGreaterThan(0);
    }
  });

  test("process.env is unchanged after successful call", async () => {
    const sdk = createSentrySDK();
    const envBefore = { ...process.env };
    await sdk.run("--version");
    // Check that no new SENTRY_OUTPUT_FORMAT key leaked
    expect(process.env.SENTRY_OUTPUT_FORMAT).toBe(
      envBefore.SENTRY_OUTPUT_FORMAT
    );
    expect(process.env.SENTRY_AUTH_TOKEN).toBe(envBefore.SENTRY_AUTH_TOKEN);
  });

  test("process.env is unchanged after failed call", async () => {
    const sdk = createSentrySDK();
    const envBefore = { ...process.env };
    try {
      await sdk.run("issue", "list");
    } catch {
      // expected
    }
    expect(process.env.SENTRY_OUTPUT_FORMAT).toBe(
      envBefore.SENTRY_OUTPUT_FORMAT
    );
  });

  test("{ text: true } returns string for help command", async () => {
    const sdk = createSentrySDK({ text: true });
    const result = await sdk.run("help");
    expect(typeof result).toBe("string");
    expect(result as string).toContain("sentry");
  });

  test("accepts cwd option without error", async () => {
    const sdk = createSentrySDK({ cwd: "/tmp" });
    const result = await sdk.run("--version");
    expect(typeof result).toBe("string");
  });

  test("nested namespaces (dashboard.widget)", () => {
    const sdk = createSentrySDK();
    expect(sdk.dashboard.widget).toBeDefined();
    expect(typeof sdk.dashboard.widget.add).toBe("function");
  });

  test(
    "token option is plumbed through",
    async () => {
      const sdk = createSentrySDK({ token: "invalid-token" });
      try {
        await sdk.org.list();
        expect.unreachable("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(SentryError);
      }
    },
    { timeout: 15_000 }
  );

  test("sdk.run returns AsyncIterable for streaming flag --follow", () => {
    const sdk = createSentrySDK();
    const result = sdk.run("log", "list", "--follow");
    // Streaming flags return an AsyncIterable, not a Promise
    expect(Symbol.asyncIterator in (result as object)).toBe(true);
  });

  test("sdk.run returns AsyncIterable for streaming flag --refresh", () => {
    const sdk = createSentrySDK();
    const result = sdk.run("issue", "list", "--refresh");
    expect(Symbol.asyncIterator in (result as object)).toBe(true);
  });

  test("sdk.run returns AsyncIterable for streaming short flag -f", () => {
    const sdk = createSentrySDK();
    const result = sdk.run("log", "list", "-f");
    expect(Symbol.asyncIterator in (result as object)).toBe(true);
  });
});
