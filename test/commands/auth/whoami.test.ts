/**
 * Whoami Command Tests
 *
 * Tests for the whoamiCommand func() in src/commands/auth/whoami.ts.
 * Uses spyOn to mock api-client, db/auth, and db/user to cover all
 * branches without real HTTP calls or database access.
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
import { whoamiCommand } from "../../../src/commands/auth/whoami.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as apiClient from "../../../src/lib/api-client.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as dbAuth from "../../../src/lib/db/auth.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as dbUser from "../../../src/lib/db/user.js";
import { AuthError } from "../../../src/lib/errors.js";

type WhoamiFlags = { readonly json: boolean };

/** Command function type extracted from loader result */
type WhoamiFunc = (this: unknown, flags: WhoamiFlags) => Promise<void>;

const FULL_USER = {
  id: "42",
  name: "Jane Doe",
  username: "janedoe",
  email: "jane@example.com",
};

const EMAIL_ONLY_USER = {
  id: "99",
  email: "anon@example.com",
};

const ID_ONLY_USER = {
  id: "7",
};

function createContext() {
  const output: string[] = [];
  const context = {
    stdout: {
      write: mock((s: string) => {
        output.push(s);
      }),
    },
    stderr: {
      write: mock((_s: string) => {
        /* no-op */
      }),
    },
    cwd: "/tmp",
    setContext: mock((_key: string, _val: unknown) => {
      /* no-op */
    }),
  };
  const getOutput = () => output.join("");
  return { context, getOutput };
}

describe("whoamiCommand.func", () => {
  let isAuthenticatedSpy: ReturnType<typeof spyOn>;
  let getCurrentUserSpy: ReturnType<typeof spyOn>;
  let setUserInfoSpy: ReturnType<typeof spyOn>;
  let func: WhoamiFunc;

  beforeEach(async () => {
    isAuthenticatedSpy = spyOn(dbAuth, "isAuthenticated");
    getCurrentUserSpy = spyOn(apiClient, "getCurrentUser");
    setUserInfoSpy = spyOn(dbUser, "setUserInfo");
    func = (await whoamiCommand.loader()) as unknown as WhoamiFunc;
  });

  afterEach(() => {
    isAuthenticatedSpy.mockRestore();
    getCurrentUserSpy.mockRestore();
    setUserInfoSpy.mockRestore();
  });

  describe("unauthenticated", () => {
    test("throws AuthError(not_authenticated) when no token stored", async () => {
      isAuthenticatedSpy.mockResolvedValue(false);

      const { context } = createContext();

      await expect(func.call(context, { json: false })).rejects.toBeInstanceOf(
        AuthError
      );

      expect(getCurrentUserSpy).not.toHaveBeenCalled();
    });

    test("does not call setUserInfo when not authenticated", async () => {
      isAuthenticatedSpy.mockResolvedValue(false);

      const { context } = createContext();

      try {
        await func.call(context, { json: false });
      } catch {
        // AuthError is expected
      }

      expect(setUserInfoSpy).not.toHaveBeenCalled();
    });
  });

  describe("human output", () => {
    test("displays name and email for full user", async () => {
      isAuthenticatedSpy.mockResolvedValue(true);
      getCurrentUserSpy.mockResolvedValue(FULL_USER);
      setUserInfoSpy.mockReturnValue(undefined);

      const { context, getOutput } = createContext();
      await func.call(context, { json: false });

      const out = getOutput();
      expect(out).toContain("Jane Doe");
      expect(out).toContain("jane@example.com");
    });

    test("falls back to email when no name", async () => {
      isAuthenticatedSpy.mockResolvedValue(true);
      getCurrentUserSpy.mockResolvedValue(EMAIL_ONLY_USER);
      setUserInfoSpy.mockReturnValue(undefined);

      const { context, getOutput } = createContext();
      await func.call(context, { json: false });

      expect(getOutput()).toContain("anon@example.com");
    });

    test("falls back to user ID when no name or email", async () => {
      isAuthenticatedSpy.mockResolvedValue(true);
      getCurrentUserSpy.mockResolvedValue(ID_ONLY_USER);
      setUserInfoSpy.mockReturnValue(undefined);

      const { context, getOutput } = createContext();
      await func.call(context, { json: false });

      expect(getOutput()).toContain("7");
    });

    test("updates DB cache with fetched user info", async () => {
      isAuthenticatedSpy.mockResolvedValue(true);
      getCurrentUserSpy.mockResolvedValue(FULL_USER);
      setUserInfoSpy.mockReturnValue(undefined);

      const { context } = createContext();
      await func.call(context, { json: false });

      expect(setUserInfoSpy).toHaveBeenCalledWith({
        userId: "42",
        name: "Jane Doe",
        username: "janedoe",
        email: "jane@example.com",
      });
    });

    test("still displays identity when DB cache write fails", async () => {
      isAuthenticatedSpy.mockResolvedValue(true);
      getCurrentUserSpy.mockResolvedValue(FULL_USER);
      setUserInfoSpy.mockImplementation(() => {
        throw new Error("read-only filesystem");
      });

      const { context, getOutput } = createContext();
      // Must not throw — output must still be shown
      await func.call(context, { json: false });

      expect(getOutput()).toContain("Jane Doe");
    });
  });

  describe("--json output", () => {
    test("outputs valid JSON with all fields", async () => {
      isAuthenticatedSpy.mockResolvedValue(true);
      getCurrentUserSpy.mockResolvedValue(FULL_USER);
      setUserInfoSpy.mockReturnValue(undefined);

      const { context, getOutput } = createContext();
      await func.call(context, { json: true });

      const parsed = JSON.parse(getOutput());
      expect(parsed.id).toBe("42");
      expect(parsed.name).toBe("Jane Doe");
      expect(parsed.username).toBe("janedoe");
      expect(parsed.email).toBe("jane@example.com");
    });

    test("outputs null for missing optional fields", async () => {
      isAuthenticatedSpy.mockResolvedValue(true);
      getCurrentUserSpy.mockResolvedValue(ID_ONLY_USER);
      setUserInfoSpy.mockReturnValue(undefined);

      const { context, getOutput } = createContext();
      await func.call(context, { json: true });

      const parsed = JSON.parse(getOutput());
      expect(parsed.id).toBe("7");
      expect(parsed.name).toBeNull();
      expect(parsed.username).toBeNull();
      expect(parsed.email).toBeNull();
    });

    test("still updates DB cache when --json is used", async () => {
      isAuthenticatedSpy.mockResolvedValue(true);
      getCurrentUserSpy.mockResolvedValue(FULL_USER);
      setUserInfoSpy.mockReturnValue(undefined);

      const { context } = createContext();
      await func.call(context, { json: true });

      expect(setUserInfoSpy).toHaveBeenCalledWith({
        userId: "42",
        name: "Jane Doe",
        username: "janedoe",
        email: "jane@example.com",
      });
    });
  });
});
