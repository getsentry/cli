/**
 * Logout Command Tests
 *
 * Tests for the logoutCommand func() in src/commands/auth/logout.ts.
 * Covers the env-token-aware branches added for headless auth support.
 *
 * Status messages go through consola (→ process.stderr). Tests capture stderr
 * via a spy on process.stderr.write and assert on the collected output.
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

/**
 * Create a mock Stricli context and a stderr capture for consola output.
 */
function createContext() {
  const stderrChunks: string[] = [];
  const origWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk: string | Uint8Array) => {
    stderrChunks.push(String(chunk));
    return true;
  }) as typeof process.stderr.write;

  const context = {
    stdout: {
      write: mock((_s: string) => {
        /* unused — status output goes through consola */
      }),
    },
    stderr: {
      write: mock((_s: string) => {
        /* unused — status output goes through consola */
      }),
    },
    cwd: "/tmp",
    setContext: mock((_k: string, _v: unknown) => {
      /* no-op */
    }),
  };
  const getOutput = () => stderrChunks.join("");
  const restore = () => {
    process.stderr.write = origWrite;
  };
  return { context, getOutput, restore };
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

    const { context, getOutput, restore } = createContext();
    try {
      await func.call(context, {});

      expect(getOutput()).toContain("Not currently authenticated");
      expect(clearAuthSpy).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  test("OAuth token: clears auth and shows success", async () => {
    isAuthenticatedSpy.mockResolvedValue(true);
    isEnvTokenActiveSpy.mockReturnValue(false);

    const { context, getOutput, restore } = createContext();
    try {
      await func.call(context, {});

      expect(clearAuthSpy).toHaveBeenCalled();
      expect(getOutput()).toContain("Logged out successfully");
      expect(getOutput()).toContain("/fake/db/path");
    } finally {
      restore();
    }
  });

  test("env token (SENTRY_AUTH_TOKEN): does not clear auth, shows env var message", async () => {
    isAuthenticatedSpy.mockResolvedValue(true);
    isEnvTokenActiveSpy.mockReturnValue(true);
    getAuthConfigSpy.mockReturnValue({
      token: "sntrys_env_123",
      source: "env:SENTRY_AUTH_TOKEN",
    });

    const { context, getOutput, restore } = createContext();
    try {
      await func.call(context, {});

      expect(clearAuthSpy).not.toHaveBeenCalled();
      expect(getOutput()).toContain("SENTRY_AUTH_TOKEN");
      expect(getOutput()).toContain("environment variable");
      expect(getOutput()).toContain("Unset");
    } finally {
      restore();
    }
  });

  test("env token (SENTRY_TOKEN): shows correct env var name", async () => {
    isAuthenticatedSpy.mockResolvedValue(true);
    isEnvTokenActiveSpy.mockReturnValue(true);
    // Set env var directly — getActiveEnvVarName() reads env vars via getEnvToken()
    process.env.SENTRY_TOKEN = "sntrys_token_456";

    const { context, getOutput, restore } = createContext();
    try {
      await func.call(context, {});
      expect(clearAuthSpy).not.toHaveBeenCalled();
      expect(getOutput()).toContain("SENTRY_TOKEN");
      expect(getOutput()).not.toContain("SENTRY_AUTH_TOKEN");
    } finally {
      restore();
      delete process.env.SENTRY_TOKEN;
    }
  });

  test("env token: falls back to SENTRY_AUTH_TOKEN if source is unexpected", async () => {
    isAuthenticatedSpy.mockResolvedValue(true);
    isEnvTokenActiveSpy.mockReturnValue(true);
    // Simulate edge case: source doesn't start with "env:" prefix
    getAuthConfigSpy.mockReturnValue({
      token: "sntrys_token",
      source: "oauth",
    });

    const { context, getOutput, restore } = createContext();
    try {
      await func.call(context, {});

      // Falls back to "SENTRY_AUTH_TOKEN" as default
      expect(getOutput()).toContain("SENTRY_AUTH_TOKEN");
    } finally {
      restore();
    }
  });
});
