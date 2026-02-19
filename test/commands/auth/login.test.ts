/**
 * Login Command Tests
 *
 * Unit tests for the --token authentication path in src/commands/auth/login.ts.
 * Uses spyOn to mock api-client, db/auth, db/user, and interactive-login
 * to cover all branches without real HTTP calls or database access.
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

type LoginFlags = { readonly token?: string; readonly timeout: number };

/** Command function type extracted from loader result */
type LoginFunc = (this: unknown, flags: LoginFlags) => Promise<void>;

const SAMPLE_USER = {
  id: "42",
  name: "Jane Doe",
  username: "janedoe",
  email: "jane@example.com",
};

function createContext() {
  const stdoutLines: string[] = [];
  const stderrLines: string[] = [];
  const context = {
    stdout: {
      write: mock((s: string) => {
        stdoutLines.push(s);
      }),
    },
    stderr: {
      write: mock((s: string) => {
        stderrLines.push(s);
      }),
    },
    cwd: "/tmp",
    setContext: mock((_k: string, _v: unknown) => {
      /* no-op */
    }),
  };
  const getStdout = () => stdoutLines.join("");
  return { context, getStdout };
}

describe("loginCommand.func --token path", () => {
  let isAuthenticatedSpy: ReturnType<typeof spyOn>;
  let setAuthTokenSpy: ReturnType<typeof spyOn>;
  let getUserRegionsSpy: ReturnType<typeof spyOn>;
  let clearAuthSpy: ReturnType<typeof spyOn>;
  let getCurrentUserSpy: ReturnType<typeof spyOn>;
  let setUserInfoSpy: ReturnType<typeof spyOn>;
  let runInteractiveLoginSpy: ReturnType<typeof spyOn>;
  let func: LoginFunc;

  beforeEach(async () => {
    isAuthenticatedSpy = spyOn(dbAuth, "isAuthenticated");
    setAuthTokenSpy = spyOn(dbAuth, "setAuthToken");
    getUserRegionsSpy = spyOn(apiClient, "getUserRegions");
    clearAuthSpy = spyOn(dbAuth, "clearAuth");
    getCurrentUserSpy = spyOn(apiClient, "getCurrentUser");
    setUserInfoSpy = spyOn(dbUser, "setUserInfo");
    runInteractiveLoginSpy = spyOn(interactiveLogin, "runInteractiveLogin");
    func = (await loginCommand.loader()) as unknown as LoginFunc;
  });

  afterEach(() => {
    isAuthenticatedSpy.mockRestore();
    setAuthTokenSpy.mockRestore();
    getUserRegionsSpy.mockRestore();
    clearAuthSpy.mockRestore();
    getCurrentUserSpy.mockRestore();
    setUserInfoSpy.mockRestore();
    runInteractiveLoginSpy.mockRestore();
  });

  test("already authenticated: prints message and returns early", async () => {
    isAuthenticatedSpy.mockResolvedValue(true);

    const { context, getStdout } = createContext();
    await func.call(context, { timeout: 900 });

    expect(getStdout()).toContain("already authenticated");
    expect(setAuthTokenSpy).not.toHaveBeenCalled();
    expect(getCurrentUserSpy).not.toHaveBeenCalled();
  });

  test("--token: stores token, fetches user, writes success", async () => {
    isAuthenticatedSpy.mockResolvedValue(false);
    setAuthTokenSpy.mockResolvedValue(undefined);
    getUserRegionsSpy.mockResolvedValue([]);
    getCurrentUserSpy.mockResolvedValue(SAMPLE_USER);
    setUserInfoSpy.mockReturnValue(undefined);

    const { context, getStdout } = createContext();
    await func.call(context, { token: "my-token", timeout: 900 });

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

  test("--token: invalid token clears auth and throws AuthError", async () => {
    isAuthenticatedSpy.mockResolvedValue(false);
    setAuthTokenSpy.mockResolvedValue(undefined);
    getUserRegionsSpy.mockRejectedValue(new Error("401 Unauthorized"));
    clearAuthSpy.mockResolvedValue(undefined);

    const { context } = createContext();

    await expect(
      func.call(context, { token: "bad-token", timeout: 900 })
    ).rejects.toBeInstanceOf(AuthError);

    expect(clearAuthSpy).toHaveBeenCalled();
    expect(getCurrentUserSpy).not.toHaveBeenCalled();
  });

  test("--token: always shows 'Logged in as' with user identity", async () => {
    isAuthenticatedSpy.mockResolvedValue(false);
    setAuthTokenSpy.mockResolvedValue(undefined);
    getUserRegionsSpy.mockResolvedValue([]);
    getCurrentUserSpy.mockResolvedValue({ id: "5", email: "only@email.com" });
    setUserInfoSpy.mockReturnValue(undefined);

    const { context, getStdout } = createContext();
    await func.call(context, { token: "valid-token", timeout: 900 });

    expect(getStdout()).toContain("Logged in as");
    expect(getStdout()).toContain("only@email.com");
  });

  test("no token: falls through to interactive login", async () => {
    isAuthenticatedSpy.mockResolvedValue(false);
    runInteractiveLoginSpy.mockResolvedValue(true);

    const { context } = createContext();
    await func.call(context, { timeout: 900 });

    expect(runInteractiveLoginSpy).toHaveBeenCalled();
    expect(setAuthTokenSpy).not.toHaveBeenCalled();
  });
});
