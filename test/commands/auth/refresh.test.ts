/**
 * Refresh Command Tests
 *
 * Tests for the refreshCommand func() in src/commands/auth/refresh.ts.
 * Covers the env-token guard and the main refresh flow.
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from "bun:test";
import { refreshCommand } from "../../../src/commands/auth/refresh.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as dbAuth from "../../../src/lib/db/auth.js";
import { AuthError } from "../../../src/lib/errors.js";

type RefreshFlags = { readonly json: boolean; readonly force: boolean };
type RefreshFunc = (this: unknown, flags: RefreshFlags) => Promise<void>;

function createContext() {
  const stdoutLines: string[] = [];
  const context = {
    stdout: {
      write: mock((s: string) => {
        stdoutLines.push(s);
      }),
    },
    stderr: {
      write: mock((_s: string) => {
        /* no-op */
      }),
    },
    cwd: "/tmp",
    setContext: mock((_k: string, _v: unknown) => {
      /* no-op */
    }),
  };
  return { context, getStdout: () => stdoutLines.join("") };
}

describe("refreshCommand.func", () => {
  let isEnvTokenActiveSpy: ReturnType<typeof spyOn>;
  let getAuthConfigSpy: ReturnType<typeof spyOn>;
  let refreshTokenSpy: ReturnType<typeof spyOn>;
  let func: RefreshFunc;

  beforeEach(async () => {
    isEnvTokenActiveSpy = spyOn(dbAuth, "isEnvTokenActive");
    getAuthConfigSpy = spyOn(dbAuth, "getAuthConfig");
    refreshTokenSpy = spyOn(dbAuth, "refreshToken");
    func = (await refreshCommand.loader()) as unknown as RefreshFunc;
  });

  afterEach(() => {
    isEnvTokenActiveSpy.mockRestore();
    getAuthConfigSpy.mockRestore();
    refreshTokenSpy.mockRestore();
  });

  test("env token (SENTRY_AUTH_TOKEN): throws AuthError with specific env var name", async () => {
    isEnvTokenActiveSpy.mockReturnValue(true);
    getAuthConfigSpy.mockReturnValue({
      token: "sntrys_env_123",
      source: "env:SENTRY_AUTH_TOKEN",
    });

    const { context } = createContext();

    try {
      await func.call(context, { json: false, force: false });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(AuthError);
      expect((err as AuthError).message).toContain(
        "Cannot refresh an environment variable token"
      );
      expect((err as AuthError).message).toContain("Update SENTRY_AUTH_TOKEN");
    }

    expect(refreshTokenSpy).not.toHaveBeenCalled();
  });

  test("env token (SENTRY_TOKEN): throws AuthError with SENTRY_TOKEN in message", async () => {
    isEnvTokenActiveSpy.mockReturnValue(true);
    // Set env var directly — getActiveEnvVarName() reads env vars via getEnvToken()
    process.env.SENTRY_TOKEN = "sntrys_token_456";

    const { context } = createContext();

    try {
      await func.call(context, { json: false, force: false });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(AuthError);
      expect((err as AuthError).message).toContain("Update SENTRY_TOKEN");
      // Should NOT say SENTRY_AUTH_TOKEN
      expect((err as AuthError).message).not.toContain("SENTRY_AUTH_TOKEN");
    } finally {
      delete process.env.SENTRY_TOKEN;
    }

    expect(refreshTokenSpy).not.toHaveBeenCalled();
  });

  test("no refresh token: throws AuthError about missing refresh token", async () => {
    isEnvTokenActiveSpy.mockReturnValue(false);
    getAuthConfigSpy.mockReturnValue({
      token: "manual_token",
      source: "oauth",
    });

    const { context } = createContext();

    try {
      await func.call(context, { json: false, force: false });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(AuthError);
      expect((err as AuthError).message).toContain("No refresh token");
    }
  });

  test("successful refresh: shows success message", async () => {
    isEnvTokenActiveSpy.mockReturnValue(false);
    getAuthConfigSpy.mockReturnValue({
      token: "old_token",
      source: "oauth",
      refreshToken: "refresh_abc",
    });
    refreshTokenSpy.mockResolvedValue({
      token: "new_token",
      refreshed: true,
      expiresIn: 3600,
      expiresAt: Date.now() + 3_600_000,
    });

    const { context, getStdout } = createContext();
    await func.call(context, { json: false, force: false });

    expect(getStdout()).toContain("Token refreshed successfully");
    expect(getStdout()).toContain("1 hour");
  });

  test("token still valid: shows still-valid message", async () => {
    isEnvTokenActiveSpy.mockReturnValue(false);
    getAuthConfigSpy.mockReturnValue({
      token: "current_token",
      source: "oauth",
      refreshToken: "refresh_abc",
    });
    refreshTokenSpy.mockResolvedValue({
      token: "current_token",
      refreshed: false,
      expiresIn: 1800,
    });

    const { context, getStdout } = createContext();
    await func.call(context, { json: false, force: false });

    expect(getStdout()).toContain("Token still valid");
    expect(getStdout()).toContain("--force");
  });

  test("--json: outputs JSON for successful refresh", async () => {
    isEnvTokenActiveSpy.mockReturnValue(false);
    getAuthConfigSpy.mockReturnValue({
      token: "old_token",
      source: "oauth",
      refreshToken: "refresh_abc",
    });
    refreshTokenSpy.mockResolvedValue({
      token: "new_token",
      refreshed: true,
      expiresIn: 3600,
      expiresAt: Date.now() + 3_600_000,
    });

    const { context, getStdout } = createContext();
    await func.call(context, { json: true, force: false });

    const parsed = JSON.parse(getStdout());
    expect(parsed.success).toBe(true);
    expect(parsed.refreshed).toBe(true);
    expect(parsed.expiresIn).toBe(3600);
  });
});
