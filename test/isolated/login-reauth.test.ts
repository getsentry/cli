/**
 * Isolated test for login re-authentication interactive prompt path.
 *
 * Uses mock.module() to override node:tty so isatty(0) returns true,
 * and mocks the logger module to control the prompt response.
 *
 * Run with: bun test test/isolated/login-reauth.test.ts
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

// Mock isatty to simulate interactive terminal.
// Bun's ESM wrapper for CJS built-ins exposes a `default` re-export plus
// `ReadStream` / `WriteStream` — all must be present or Bun throws
// "Missing 'default' export in module 'node:tty'".
const mockIsatty = mock(() => true);

class FakeReadStream {}
class FakeWriteStream {}

const ttyExports = {
  isatty: mockIsatty,
  ReadStream: FakeReadStream,
  WriteStream: FakeWriteStream,
};
mock.module("node:tty", () => ({
  ...ttyExports,
  default: ttyExports,
}));

// Mock prompt on the logger module — we need to intercept the .prompt()
// call made by the module-scoped `log = logger.withTag("auth.login")` in login.ts.
// The approach: mock the entire logger so .withTag() returns a consola-like
// object whose .prompt() we control.
const mockPrompt = mock(() => Promise.resolve(true));

/** Fake scoped logger returned by withTag() */
const fakeLog = {
  prompt: mockPrompt,
  // biome-ignore lint/suspicious/noEmptyBlockStatements: no-op mock
  info: mock(() => {}),
  // biome-ignore lint/suspicious/noEmptyBlockStatements: no-op mock
  warn: mock(() => {}),
  // biome-ignore lint/suspicious/noEmptyBlockStatements: no-op mock
  error: mock(() => {}),
  // biome-ignore lint/suspicious/noEmptyBlockStatements: no-op mock
  debug: mock(() => {}),
  // biome-ignore lint/suspicious/noEmptyBlockStatements: no-op mock
  success: mock(() => {}),
  withTag: () => fakeLog,
};

/** Fake root logger */
const fakeLogger = {
  ...fakeLog,
  withTag: () => fakeLog,
};

mock.module("../../src/lib/logger.js", () => ({
  logger: fakeLogger,
  // biome-ignore lint/suspicious/noEmptyBlockStatements: no-op mock
  setLogLevel: mock(() => {}),
  // biome-ignore lint/suspicious/noEmptyBlockStatements: no-op mock
  attachSentryReporter: mock(() => {}),
  // These exports are required by command.ts (in the login.ts import chain)
  LOG_LEVEL_NAMES: ["error", "warn", "log", "info", "debug", "trace"],
  LOG_LEVEL_ENV_VAR: "SENTRY_LOG_LEVEL",
  parseLogLevel: (name: string) => {
    const levels = ["error", "warn", "log", "info", "debug", "trace"];
    const idx = levels.indexOf(name.toLowerCase().trim());
    return idx === -1 ? 3 : idx;
  },
  getEnvLogLevel: () => null,
}));

// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as apiClient from "../../src/lib/api-client.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as dbAuth from "../../src/lib/db/auth.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as dbUser from "../../src/lib/db/user.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as interactiveLogin from "../../src/lib/interactive-login.js";

const { loginCommand } = await import("../../src/commands/auth/login.js");

type LoginFlags = {
  readonly token?: string;
  readonly timeout: number;
  readonly force: boolean;
};

type LoginFunc = (this: unknown, flags: LoginFlags) => Promise<void>;

function createMockContext() {
  return {
    stdout: { write: mock(() => true) },
    stderr: { write: mock(() => true) },
    cwd: "/tmp",
  };
}

describe("login re-authentication interactive prompt", () => {
  let isAuthenticatedSpy: ReturnType<typeof spyOn>;
  let isEnvTokenActiveSpy: ReturnType<typeof spyOn>;
  let clearAuthSpy: ReturnType<typeof spyOn>;
  let runInteractiveLoginSpy: ReturnType<typeof spyOn>;
  let getUserInfoSpy: ReturnType<typeof spyOn>;
  let func: LoginFunc;

  beforeEach(async () => {
    isAuthenticatedSpy = spyOn(dbAuth, "isAuthenticated");
    isEnvTokenActiveSpy = spyOn(dbAuth, "isEnvTokenActive");
    clearAuthSpy = spyOn(dbAuth, "clearAuth");
    runInteractiveLoginSpy = spyOn(interactiveLogin, "runInteractiveLogin");
    getUserInfoSpy = spyOn(dbUser, "getUserInfo");

    // Defaults
    isEnvTokenActiveSpy.mockReturnValue(false);
    clearAuthSpy.mockResolvedValue(undefined);
    runInteractiveLoginSpy.mockResolvedValue(true);
    mockIsatty.mockReturnValue(true);
    mockPrompt.mockClear();

    func = (await loginCommand.loader()) as unknown as LoginFunc;
  });

  afterEach(() => {
    isAuthenticatedSpy.mockRestore();
    isEnvTokenActiveSpy.mockRestore();
    clearAuthSpy.mockRestore();
    runInteractiveLoginSpy.mockRestore();
    getUserInfoSpy.mockRestore();
  });

  test("shows prompt with user identity when authenticated on TTY", async () => {
    isAuthenticatedSpy.mockReturnValue(true);
    getUserInfoSpy.mockReturnValue({
      userId: "42",
      name: "Jane Doe",
      email: "jane@example.com",
    });
    mockPrompt.mockResolvedValue(true);

    const context = createMockContext();
    await func.call(context, { force: false, timeout: 900 });

    expect(mockPrompt).toHaveBeenCalledTimes(1);
    const promptMessage = (mockPrompt.mock.calls[0] as unknown as string[])[0];
    expect(promptMessage).toContain("Jane Doe");
    expect(promptMessage).toContain("jane@example.com");
    expect(promptMessage).toContain("Re-authenticate?");
  });

  test("shows 'current user' fallback when no cached user info", async () => {
    isAuthenticatedSpy.mockReturnValue(true);
    getUserInfoSpy.mockReturnValue(undefined);
    mockPrompt.mockResolvedValue(true);

    const context = createMockContext();
    await func.call(context, { force: false, timeout: 900 });

    expect(mockPrompt).toHaveBeenCalledTimes(1);
    const promptMessage = (mockPrompt.mock.calls[0] as unknown as string[])[0];
    expect(promptMessage).toContain("current user");
  });

  test("confirm: clears auth and proceeds to login", async () => {
    isAuthenticatedSpy.mockReturnValue(true);
    getUserInfoSpy.mockReturnValue(undefined);
    mockPrompt.mockResolvedValue(true);

    const context = createMockContext();
    await func.call(context, { force: false, timeout: 900 });

    expect(clearAuthSpy).toHaveBeenCalled();
    expect(runInteractiveLoginSpy).toHaveBeenCalled();
  });

  test("decline: returns without re-auth", async () => {
    isAuthenticatedSpy.mockReturnValue(true);
    getUserInfoSpy.mockReturnValue(undefined);
    mockPrompt.mockResolvedValue(false);

    const context = createMockContext();
    await func.call(context, { force: false, timeout: 900 });

    expect(mockPrompt).toHaveBeenCalled();
    expect(clearAuthSpy).not.toHaveBeenCalled();
    expect(runInteractiveLoginSpy).not.toHaveBeenCalled();
  });

  test("cancel (Ctrl+C): returns without re-auth", async () => {
    isAuthenticatedSpy.mockReturnValue(true);
    getUserInfoSpy.mockReturnValue(undefined);
    // consola returns Symbol(clack:cancel) on Ctrl+C — truthy but not `true`.
    mockPrompt.mockResolvedValue(Symbol("clack:cancel") as unknown as boolean);

    const context = createMockContext();
    await func.call(context, { force: false, timeout: 900 });

    expect(mockPrompt).toHaveBeenCalled();
    expect(clearAuthSpy).not.toHaveBeenCalled();
    expect(runInteractiveLoginSpy).not.toHaveBeenCalled();
  });

  test("--force skips prompt even on TTY", async () => {
    isAuthenticatedSpy.mockReturnValue(true);
    getUserInfoSpy.mockReturnValue(undefined);

    const context = createMockContext();
    await func.call(context, { force: true, timeout: 900 });

    expect(mockPrompt).not.toHaveBeenCalled();
    expect(clearAuthSpy).toHaveBeenCalled();
    expect(runInteractiveLoginSpy).toHaveBeenCalled();
  });

  test("confirm + --token: clears auth and re-authenticates with token", async () => {
    isAuthenticatedSpy.mockReturnValue(true);
    getUserInfoSpy.mockReturnValue(undefined);
    mockPrompt.mockResolvedValue(true);

    const setAuthTokenSpy = spyOn(dbAuth, "setAuthToken");
    setAuthTokenSpy.mockImplementation(() => {
      // no-op — token storage mocked
    });
    const getUserRegionsSpy = spyOn(apiClient, "getUserRegions");
    getUserRegionsSpy.mockResolvedValue([]);
    const getCurrentUserSpy = spyOn(apiClient, "getCurrentUser");
    getCurrentUserSpy.mockResolvedValue({
      id: "42",
      name: "Jane",
      username: "jane",
      email: "jane@example.com",
    });
    const setUserInfoSpy = spyOn(dbUser, "setUserInfo");
    setUserInfoSpy.mockReturnValue(undefined);

    const context = createMockContext();
    try {
      await func.call(context, {
        token: "new-token",
        force: false,
        timeout: 900,
      });

      expect(clearAuthSpy).toHaveBeenCalled();
      expect(setAuthTokenSpy).toHaveBeenCalledWith("new-token");
    } finally {
      setAuthTokenSpy.mockRestore();
      getUserRegionsSpy.mockRestore();
      getCurrentUserSpy.mockRestore();
      setUserInfoSpy.mockRestore();
    }
  });
});
