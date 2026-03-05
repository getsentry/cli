/**
 * Logout Command Tests
 *
 * Tests for the logoutCommand func() in src/commands/auth/logout.ts.
 * Covers the env-token-aware branches added for headless auth support.
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

type LogoutFunc = (
  this: unknown,
  flags: Record<string, never>
) => Promise<void>;

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

  test("not authenticated: prints message and returns", async () => {
    isAuthenticatedSpy.mockResolvedValue(false);

    const { context, getStdout } = createContext();
    await func.call(context, {});

    expect(getStdout()).toContain("Not currently authenticated");
    expect(clearAuthSpy).not.toHaveBeenCalled();
  });

  test("OAuth token: clears auth and shows success", async () => {
    isAuthenticatedSpy.mockResolvedValue(true);
    isEnvTokenActiveSpy.mockReturnValue(false);

    const { context, getStdout } = createContext();
    await func.call(context, {});

    expect(clearAuthSpy).toHaveBeenCalled();
    expect(getStdout()).toContain("Logged out successfully");
    expect(getStdout()).toContain("/fake/db/path");
  });

  test("env token (SENTRY_AUTH_TOKEN): does not clear auth, shows env var message", async () => {
    isAuthenticatedSpy.mockResolvedValue(true);
    isEnvTokenActiveSpy.mockReturnValue(true);
    getAuthConfigSpy.mockReturnValue({
      token: "sntrys_env_123",
      source: "env:SENTRY_AUTH_TOKEN",
    });

    const { context, getStdout } = createContext();
    await func.call(context, {});

    expect(clearAuthSpy).not.toHaveBeenCalled();
    expect(getStdout()).toContain("SENTRY_AUTH_TOKEN");
    expect(getStdout()).toContain("environment variable");
    expect(getStdout()).toContain("Unset");
  });

  test("env token (SENTRY_TOKEN): shows correct env var name", async () => {
    isAuthenticatedSpy.mockResolvedValue(true);
    isEnvTokenActiveSpy.mockReturnValue(true);
    getAuthConfigSpy.mockReturnValue({
      token: "sntrys_token_456",
      source: "env:SENTRY_TOKEN",
    });

    const { context, getStdout } = createContext();
    await func.call(context, {});

    expect(clearAuthSpy).not.toHaveBeenCalled();
    expect(getStdout()).toContain("SENTRY_TOKEN");
    expect(getStdout()).not.toContain("SENTRY_AUTH_TOKEN");
  });

  test("env token: falls back to SENTRY_AUTH_TOKEN if source is unexpected", async () => {
    isAuthenticatedSpy.mockResolvedValue(true);
    isEnvTokenActiveSpy.mockReturnValue(true);
    // Simulate edge case: source doesn't start with "env:" prefix
    getAuthConfigSpy.mockReturnValue({
      token: "sntrys_token",
      source: "oauth",
    });

    const { context, getStdout } = createContext();
    await func.call(context, {});

    // Falls back to "SENTRY_AUTH_TOKEN" as default
    expect(getStdout()).toContain("SENTRY_AUTH_TOKEN");
  });
});
