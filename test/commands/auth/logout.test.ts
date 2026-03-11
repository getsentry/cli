/**
 * Logout Command Tests
 *
 * Tests for the logoutCommand func() in src/commands/auth/logout.ts.
 * Covers the env-token-aware branches added for headless auth support.
 *
 * Now that logout uses CommandOutput, success output goes to stdout via the
 * rendering pipeline, and error cases throw typed errors (AuthError).
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
import { logoutCommand } from "../../../src/commands/auth/logout.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as dbAuth from "../../../src/lib/db/auth.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as dbIndex from "../../../src/lib/db/index.js";
import { AuthError } from "../../../src/lib/errors.js";

type LogoutFunc = (
  this: unknown,
  flags: Record<string, never>
) => Promise<void>;

function createContext() {
  const stdoutChunks: string[] = [];
  return {
    context: {
      stdout: {
        write: mock((s: string) => {
          stdoutChunks.push(s);
        }),
      },
      stderr: {
        write: mock((_s: string) => {
          /* captured by mock */
        }),
      },
      cwd: "/tmp",
      setContext: mock((_k: string, _v: unknown) => {
        /* no-op */
      }),
    },
    getOutput: () => stdoutChunks.join(""),
  };
}

describe("logoutCommand.func", () => {
  let isAuthenticatedSpy: ReturnType<typeof spyOn>;
  let isEnvTokenActiveSpy: ReturnType<typeof spyOn>;
  let getAuthConfigSpy: ReturnType<typeof spyOn>;
  let clearAuthSpy: ReturnType<typeof spyOn>;
  let getDbPathSpy: ReturnType<typeof spyOn>;
  let func: LogoutFunc;

  beforeEach(async () => {
    isAuthenticatedSpy = spyOn(dbAuth, "isAuthenticated");
    isEnvTokenActiveSpy = spyOn(dbAuth, "isEnvTokenActive");
    getAuthConfigSpy = spyOn(dbAuth, "getAuthConfig");
    clearAuthSpy = spyOn(dbAuth, "clearAuth");
    getDbPathSpy = spyOn(dbIndex, "getDbPath");

    clearAuthSpy.mockResolvedValue(undefined);
    getDbPathSpy.mockReturnValue("/fake/db/path");

    func = (await logoutCommand.loader()) as unknown as LogoutFunc;
  });

  afterEach(() => {
    isAuthenticatedSpy.mockRestore();
    isEnvTokenActiveSpy.mockRestore();
    getAuthConfigSpy.mockRestore();
    clearAuthSpy.mockRestore();
    getDbPathSpy.mockRestore();
  });

  test("not authenticated: throws AuthError", async () => {
    isAuthenticatedSpy.mockResolvedValue(false);
    const { context } = createContext();

    await expect(func.call(context, {})).rejects.toThrow(AuthError);
    expect(clearAuthSpy).not.toHaveBeenCalled();
  });

  test("not authenticated: error has skipAutoAuth", async () => {
    isAuthenticatedSpy.mockResolvedValue(false);
    const { context } = createContext();

    try {
      await func.call(context, {});
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(AuthError);
      expect((err as AuthError).skipAutoAuth).toBe(true);
    }
  });

  test("OAuth token: clears auth and writes success to stdout", async () => {
    isAuthenticatedSpy.mockResolvedValue(true);
    isEnvTokenActiveSpy.mockReturnValue(false);
    const { context, getOutput } = createContext();

    await func.call(context, {});

    expect(clearAuthSpy).toHaveBeenCalled();
    expect(getOutput()).toContain("Logged out successfully");
    expect(getOutput()).toContain("/fake/db/path");
  });

  test("env token (SENTRY_AUTH_TOKEN): throws AuthError with env var message", async () => {
    isAuthenticatedSpy.mockResolvedValue(true);
    isEnvTokenActiveSpy.mockReturnValue(true);
    getAuthConfigSpy.mockReturnValue({
      token: "sntrys_env_123",
      source: "env:SENTRY_AUTH_TOKEN",
    });
    const { context } = createContext();

    try {
      await func.call(context, {});
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(AuthError);
      const msg = (err as AuthError).message;
      expect(msg).toContain("SENTRY_AUTH_TOKEN");
      expect(msg).toContain("environment variable");
      expect(msg).toContain("Unset");
    }
    expect(clearAuthSpy).not.toHaveBeenCalled();
  });

  test("env token (SENTRY_TOKEN): shows correct env var name in error", async () => {
    isAuthenticatedSpy.mockResolvedValue(true);
    isEnvTokenActiveSpy.mockReturnValue(true);
    // Set env var directly — getActiveEnvVarName() reads env vars via getEnvToken()
    process.env.SENTRY_TOKEN = "sntrys_token_456";
    const { context } = createContext();

    try {
      await func.call(context, {});
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(AuthError);
      const msg = (err as AuthError).message;
      expect(msg).toContain("SENTRY_TOKEN");
    } finally {
      delete process.env.SENTRY_TOKEN;
    }
    expect(clearAuthSpy).not.toHaveBeenCalled();
  });

  test("env token: error message includes env var from getActiveEnvVarName", async () => {
    isAuthenticatedSpy.mockResolvedValue(true);
    isEnvTokenActiveSpy.mockReturnValue(true);
    // Simulate edge case: source doesn't start with "env:" prefix
    getAuthConfigSpy.mockReturnValue({
      token: "sntrys_token",
      source: "oauth",
    });
    const { context } = createContext();

    try {
      await func.call(context, {});
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(AuthError);
      // Falls back to "SENTRY_AUTH_TOKEN" as default env var name
      expect((err as AuthError).message).toContain("SENTRY_AUTH_TOKEN");
    }
  });
});
