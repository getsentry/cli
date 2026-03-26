import { describe, expect, test } from "bun:test";
import { createSentrySDK, SentryError } from "../../src/index.js";

describe("createSentrySDK", () => {
  test("returns an object with namespace methods", () => {
    const sdk = createSentrySDK();
    expect(sdk.organizations).toBeDefined();
    expect(sdk.projects).toBeDefined();
    expect(sdk.issues).toBeDefined();
    expect(sdk.events).toBeDefined();
    expect(sdk.traces).toBeDefined();
    expect(sdk.spans).toBeDefined();
    expect(sdk.teams).toBeDefined();

    // Methods exist
    expect(typeof sdk.organizations.list).toBe("function");
    expect(typeof sdk.organizations.get).toBe("function");
    expect(typeof sdk.issues.list).toBe("function");
    expect(typeof sdk.issues.get).toBe("function");
  });

  test("organizations.list throws SentryError without auth", async () => {
    const sdk = createSentrySDK();
    try {
      await sdk.organizations.list();
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(SentryError);
    }
  });

  test("issues.list throws SentryError without auth", async () => {
    const sdk = createSentrySDK();
    try {
      await sdk.issues.list({ org: "test-org", project: "test-project" });
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(SentryError);
    }
  });

  test(
    "token option is plumbed through to env",
    async () => {
      const sdk = createSentrySDK({ token: "invalid-token" });
      try {
        await sdk.organizations.list();
        expect.unreachable("Should have thrown");
      } catch (err) {
        // Should fail with auth or API error, not a crash
        expect(err).toBeInstanceOf(SentryError);
      }
    },
    { timeout: 15_000 }
  );

  test("process.env is unchanged after SDK call", async () => {
    const envBefore = { ...process.env };
    const sdk = createSentrySDK();
    try {
      await sdk.organizations.list();
    } catch {
      // expected
    }
    expect(process.env.SENTRY_OUTPUT_FORMAT).toBe(
      envBefore.SENTRY_OUTPUT_FORMAT
    );
    expect(process.env.SENTRY_AUTH_TOKEN).toBe(envBefore.SENTRY_AUTH_TOKEN);
  });
});
