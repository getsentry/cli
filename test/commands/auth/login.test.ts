/**
 * Login Command Tests
 *
 * Unit tests for the --token and --force authentication paths in src/commands/auth/login.ts.
 * Uses spyOn to mock api-client, db/auth, db/user, and interactive-login
 * to cover all branches without real HTTP calls or database access.
 *
 * Status messages go through consola (→ stderr). Logger message content is NOT
 * asserted here because mock.module in login-reauth.test.ts can replace the
 * logger module globally. Tests verify behavior via spy assertions instead.
 *
 * Tests that require isatty(0) to return true (interactive TTY prompt tests)
 * live in test/isolated/login-reauth.test.ts to avoid mock.module pollution.
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
import { loginCommand } from "../../../src/commands/auth/login.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as apiClient from "../../../src/lib/api-client.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as dbAuth from "../../../src/lib/db/auth.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as dbUser from "../../../src/lib/db/user.js";
import { AuthError } from "../../../src/lib/errors.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as interactiveLogin from "../../../src/lib/interactive-login.js";

type LoginFlags = {
  readonly token?: string;
  readonly timeout: number;
  readonly force: boolean;
};

/** Command function type extracted from loader result */
type LoginFunc = (this: unknown, flags: LoginFlags) => Promise<void>;

const SAMPLE_USER = {
  id: "42",
  name: "Jane Doe",
  username: "janedoe",
  email: "jane@example.com",
};

/**
 * Create a mock Stricli context with stdout capture.
 *
 * `getStdout()` returns rendered command output (human formatter → context.stdout).
 *
 * Logger messages (early-exit diagnostics) are NOT captured here because
 * mock.module in login-reauth.test.ts can replace the logger module globally.
 * Tests for logger message content live in test/isolated/login-reauth.test.ts.
 */
function createContext() {
  const stdoutChunks: string[] = [];
  const context = {
    stdout: {
      write: mock((s: string) => {
        stdoutChunks.push(s);
      }),
    },
    stderr: {
      write: mock((_s: string) => {
        // unused — diagnostics go through logger
      }),
    },
    cwd: "/tmp",
  };
  const getStdout = () => stdoutChunks.join("");
  return { context, getStdout };
}

describe("loginCommand.func --token path", () => {
  let isAuthenticatedSpy: ReturnType<typeof spyOn>;
  let isEnvTokenActiveSpy: ReturnType<typeof spyOn>;
  let setAuthTokenSpy: ReturnType<typeof spyOn>;
  let getUserRegionsSpy: ReturnType<typeof spyOn>;
  let clearAuthSpy: ReturnType<typeof spyOn>;
  let getCurrentUserSpy: ReturnType<typeof spyOn>;
  let setUserInfoSpy: ReturnType<typeof spyOn>;
  let runInteractiveLoginSpy: ReturnType<typeof spyOn>;
  let hasStoredAuthCredentialsSpy: ReturnType<typeof spyOn>;
  let listOrgsUncachedSpy: ReturnType<typeof spyOn>;
  let func: LoginFunc;

  beforeEach(async () => {
    isAuthenticatedSpy = spyOn(dbAuth, "isAuthenticated");
    isEnvTokenActiveSpy = spyOn(dbAuth, "isEnvTokenActive");
    setAuthTokenSpy = spyOn(dbAuth, "setAuthToken");
    getUserRegionsSpy = spyOn(apiClient, "getUserRegions");
    clearAuthSpy = spyOn(dbAuth, "clearAuth");
    getCurrentUserSpy = spyOn(apiClient, "getCurrentUser");
    setUserInfoSpy = spyOn(dbUser, "setUserInfo");
    runInteractiveLoginSpy = spyOn(interactiveLogin, "runInteractiveLogin");
    hasStoredAuthCredentialsSpy = spyOn(dbAuth, "hasStoredAuthCredentials");
    // Prevent warmOrgCache() fire-and-forget from hitting real fetch.
    // After successful login, warmOrgCache() calls listOrganizationsUncached()
    // which triggers API calls that leak as "unexpected fetch" warnings.
    listOrgsUncachedSpy = spyOn(apiClient, "listOrganizationsUncached");
    listOrgsUncachedSpy.mockResolvedValue([]);
    isEnvTokenActiveSpy.mockReturnValue(false);
    hasStoredAuthCredentialsSpy.mockReturnValue(false);
    func = (await loginCommand.loader()) as unknown as LoginFunc;
  });

  afterEach(() => {
    isAuthenticatedSpy.mockRestore();
    isEnvTokenActiveSpy.mockRestore();
    setAuthTokenSpy.mockRestore();
    getUserRegionsSpy.mockRestore();
    clearAuthSpy.mockRestore();
    getCurrentUserSpy.mockRestore();
    setUserInfoSpy.mockRestore();
    runInteractiveLoginSpy.mockRestore();
    hasStoredAuthCredentialsSpy.mockRestore();
    listOrgsUncachedSpy.mockRestore();
  });

  test("already authenticated (non-TTY, no --force): prints re-auth message with --force hint", async () => {
    isAuthenticatedSpy.mockReturnValue(true);

    const { context } = createContext();
    await func.call(context, { force: false, timeout: 900 });

    expect(setAuthTokenSpy).not.toHaveBeenCalled();
    expect(getCurrentUserSpy).not.toHaveBeenCalled();
  });

  test("already authenticated (env token SENTRY_AUTH_TOKEN): warns and proceeds to OAuth login", async () => {
    isAuthenticatedSpy.mockReturnValue(true);
    isEnvTokenActiveSpy.mockReturnValue(true);
    hasStoredAuthCredentialsSpy.mockReturnValue(false);
    runInteractiveLoginSpy.mockResolvedValue({
      method: "oauth",
      configPath: "/fake",
    });

    const { context } = createContext();
    await func.call(context, { force: false, timeout: 900 });

    // With no stored OAuth, login proceeds directly (no clearAuth needed)
    expect(runInteractiveLoginSpy).toHaveBeenCalled();
  });

  test("already authenticated (env token SENTRY_TOKEN): warns and proceeds to OAuth login", async () => {
    isAuthenticatedSpy.mockReturnValue(true);
    isEnvTokenActiveSpy.mockReturnValue(true);
    hasStoredAuthCredentialsSpy.mockReturnValue(false);
    // Set env var directly — getActiveEnvVarName() reads env vars via getEnvToken()
    process.env.SENTRY_TOKEN = "sntrys_token_456";
    runInteractiveLoginSpy.mockResolvedValue({
      method: "oauth",
      configPath: "/fake",
    });

    try {
      const { context } = createContext();
      await func.call(context, { force: false, timeout: 900 });

      expect(runInteractiveLoginSpy).toHaveBeenCalled();
    } finally {
      delete process.env.SENTRY_TOKEN;
    }
  });

  test("--token: stores token, fetches user, writes success", async () => {
    isAuthenticatedSpy.mockReturnValue(false);
    setAuthTokenSpy.mockReturnValue(undefined);
    getUserRegionsSpy.mockResolvedValue([]);
    getCurrentUserSpy.mockResolvedValue(SAMPLE_USER);
    setUserInfoSpy.mockReturnValue(undefined);

    const { context, getStdout } = createContext();
    await func.call(context, {
      token: "my-token",
      force: false,
      timeout: 900,
    });

    expect(setAuthTokenSpy).toHaveBeenCalledWith("my-token");
    expect(getCurrentUserSpy).toHaveBeenCalled();
    expect(setUserInfoSpy).toHaveBeenCalledWith({
      userId: "42",
      name: "Jane Doe",
      username: "janedoe",
      email: "jane@example.com",
    });
    const out = getStdout();
    expect(out).toContain("Authenticated");
    expect(out).toContain("Jane Doe");
  });

  test("--token: null user.name is converted to undefined in setUserInfo", async () => {
    isAuthenticatedSpy.mockReturnValue(false);
    setAuthTokenSpy.mockReturnValue(undefined);
    getUserRegionsSpy.mockResolvedValue([]);
    getCurrentUserSpy.mockResolvedValue({
      id: "5",
      name: null,
      email: "x@y.com",
      username: "xuser",
    });
    setUserInfoSpy.mockReturnValue(undefined);

    const { context, getStdout } = createContext();
    await func.call(context, {
      token: "valid-token",
      force: false,
      timeout: 900,
    });

    expect(setUserInfoSpy).toHaveBeenCalledWith({
      userId: "5",
      email: "x@y.com",
      username: "xuser",
      name: undefined,
    });
    const out = getStdout();
    expect(out).toContain("Authenticated");
    // With null name, formatUserIdentity falls back to email
    expect(out).toContain("x@y.com");
  });

  test("--token: invalid token clears auth and throws AuthError", async () => {
    isAuthenticatedSpy.mockReturnValue(false);
    setAuthTokenSpy.mockReturnValue(undefined);
    getUserRegionsSpy.mockRejectedValue(new Error("401 Unauthorized"));
    clearAuthSpy.mockResolvedValue(undefined);

    const { context } = createContext();
    await expect(
      func.call(context, { token: "bad-token", force: false, timeout: 900 })
    ).rejects.toBeInstanceOf(AuthError);

    expect(clearAuthSpy).toHaveBeenCalled();
    expect(getCurrentUserSpy).not.toHaveBeenCalled();
  });

  test("--token: shows 'Logged in as' when user info fetch succeeds", async () => {
    isAuthenticatedSpy.mockReturnValue(false);
    setAuthTokenSpy.mockReturnValue(undefined);
    getUserRegionsSpy.mockResolvedValue([]);
    getCurrentUserSpy.mockResolvedValue({ id: "5", email: "only@email.com" });
    setUserInfoSpy.mockReturnValue(undefined);

    const { context, getStdout } = createContext();
    await func.call(context, {
      token: "valid-token",
      force: false,
      timeout: 900,
    });

    expect(getStdout()).toContain("Logged in as");
    expect(getStdout()).toContain("only@email.com");
  });

  test("--token: login succeeds even when getCurrentUser() fails transiently", async () => {
    isAuthenticatedSpy.mockReturnValue(false);
    setAuthTokenSpy.mockReturnValue(undefined);
    getUserRegionsSpy.mockResolvedValue([]);
    getCurrentUserSpy.mockRejectedValue(new Error("Network error"));

    const { context, getStdout } = createContext();
    // Must not throw — login should succeed with the stored token
    await func.call(context, {
      token: "valid-token",
      force: false,
      timeout: 900,
    });

    const out = getStdout();
    expect(out).toContain("Authenticated");
    // 'Logged in as' is omitted when user info is unavailable
    expect(out).not.toContain("Logged in as");
    // Token was stored and not cleared
    expect(clearAuthSpy).not.toHaveBeenCalled();
    expect(setUserInfoSpy).not.toHaveBeenCalled();
  });

  test("no token: falls through to interactive login", async () => {
    isAuthenticatedSpy.mockReturnValue(false);
    runInteractiveLoginSpy.mockResolvedValue({
      method: "oauth",
      configPath: "/tmp/db",
    });

    const { context } = createContext();
    await func.call(context, { force: false, timeout: 900 });

    expect(runInteractiveLoginSpy).toHaveBeenCalled();
    expect(setAuthTokenSpy).not.toHaveBeenCalled();
  });

  test("--force when authenticated: clears auth and proceeds to interactive login", async () => {
    isAuthenticatedSpy.mockReturnValue(true);
    clearAuthSpy.mockResolvedValue(undefined);
    runInteractiveLoginSpy.mockResolvedValue({
      method: "oauth",
      configPath: "/tmp/db",
    });

    const { context } = createContext();
    await func.call(context, { force: true, timeout: 900 });

    expect(clearAuthSpy).toHaveBeenCalled();
    expect(runInteractiveLoginSpy).toHaveBeenCalled();
  });

  test("--force --token when authenticated: clears auth and proceeds to token login", async () => {
    isAuthenticatedSpy.mockReturnValue(true);
    clearAuthSpy.mockResolvedValue(undefined);
    setAuthTokenSpy.mockReturnValue(undefined);
    getUserRegionsSpy.mockResolvedValue([]);
    getCurrentUserSpy.mockResolvedValue(SAMPLE_USER);
    setUserInfoSpy.mockReturnValue(undefined);

    const { context, getStdout } = createContext();
    await func.call(context, {
      token: "new-token",
      force: true,
      timeout: 900,
    });

    expect(clearAuthSpy).toHaveBeenCalled();
    expect(setAuthTokenSpy).toHaveBeenCalledWith("new-token");
    expect(getStdout()).toContain("Authenticated");
  });

  test("--force with env token: proceeds to OAuth login (no longer blocks)", async () => {
    isAuthenticatedSpy.mockReturnValue(true);
    isEnvTokenActiveSpy.mockReturnValue(true);
    hasStoredAuthCredentialsSpy.mockReturnValue(false);
    runInteractiveLoginSpy.mockResolvedValue({
      method: "oauth",
      configPath: "/fake",
    });

    const { context } = createContext();
    await func.call(context, { force: true, timeout: 900 });

    // Env token no longer blocks — login proceeds
    expect(runInteractiveLoginSpy).toHaveBeenCalled();
  });
});
