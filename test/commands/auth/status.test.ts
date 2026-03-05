/**
 * Status Command Tests
 *
 * Tests for the statusCommand func() in src/commands/auth/status.ts.
 * Focuses on the env-token-aware branches added for headless auth support.
 * Uses spyOn to mock db/auth, db/defaults, db/user, and api-client.
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
import { statusCommand } from "../../../src/commands/auth/status.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as apiClient from "../../../src/lib/api-client.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as dbAuth from "../../../src/lib/db/auth.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as dbDefaults from "../../../src/lib/db/defaults.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as dbIndex from "../../../src/lib/db/index.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as dbUser from "../../../src/lib/db/user.js";
import { AuthError } from "../../../src/lib/errors.js";

type StatusFlags = { readonly "show-token": boolean };
type StatusFunc = (this: unknown, flags: StatusFlags) => Promise<void>;

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
  return {
    context,
    getStdout: () => stdoutLines.join(""),
    getStderr: () => stderrLines.join(""),
  };
}

describe("statusCommand.func", () => {
  let getAuthConfigSpy: ReturnType<typeof spyOn>;
  let isAuthenticatedSpy: ReturnType<typeof spyOn>;
  let getUserInfoSpy: ReturnType<typeof spyOn>;
  let getDefaultOrgSpy: ReturnType<typeof spyOn>;
  let getDefaultProjectSpy: ReturnType<typeof spyOn>;
  let getDbPathSpy: ReturnType<typeof spyOn>;
  let listOrgsSpy: ReturnType<typeof spyOn>;
  let func: StatusFunc;

  beforeEach(async () => {
    getAuthConfigSpy = spyOn(dbAuth, "getAuthConfig");
    isAuthenticatedSpy = spyOn(dbAuth, "isAuthenticated");
    getUserInfoSpy = spyOn(dbUser, "getUserInfo");
    getDefaultOrgSpy = spyOn(dbDefaults, "getDefaultOrganization");
    getDefaultProjectSpy = spyOn(dbDefaults, "getDefaultProject");
    getDbPathSpy = spyOn(dbIndex, "getDbPath");
    listOrgsSpy = spyOn(apiClient, "listOrganizations");

    // Defaults that most tests override
    getUserInfoSpy.mockReturnValue(null);
    getDefaultOrgSpy.mockResolvedValue(null);
    getDefaultProjectSpy.mockResolvedValue(null);
    getDbPathSpy.mockReturnValue("/fake/db/path");
    listOrgsSpy.mockResolvedValue([]);

    func = (await statusCommand.loader()) as unknown as StatusFunc;
  });

  afterEach(() => {
    getAuthConfigSpy.mockRestore();
    isAuthenticatedSpy.mockRestore();
    getUserInfoSpy.mockRestore();
    getDefaultOrgSpy.mockRestore();
    getDefaultProjectSpy.mockRestore();
    getDbPathSpy.mockRestore();
    listOrgsSpy.mockRestore();
  });

  describe("not authenticated", () => {
    test("throws AuthError with skipAutoAuth when not authenticated", async () => {
      getAuthConfigSpy.mockReturnValue(undefined);
      isAuthenticatedSpy.mockResolvedValue(false);

      const { context } = createContext();

      try {
        await func.call(context, { "show-token": false });
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(AuthError);
        expect((err as AuthError).skipAutoAuth).toBe(true);
      }
    });
  });

  describe("OAuth token", () => {
    test("shows config path for OAuth tokens", async () => {
      getAuthConfigSpy.mockReturnValue({
        token: "sntrys_abc123def456",
        source: "oauth",
        expiresAt: Date.now() + 3_600_000,
        refreshToken: "refresh_xyz",
      });
      isAuthenticatedSpy.mockResolvedValue(true);

      const { context, getStdout } = createContext();
      await func.call(context, { "show-token": false });

      expect(getStdout()).toContain("Config:");
      expect(getStdout()).toContain("/fake/db/path");
    });

    test("shows 'Authenticated' without env var mention for OAuth", async () => {
      getAuthConfigSpy.mockReturnValue({
        token: "sntrys_abc123def456",
        source: "oauth",
      });
      isAuthenticatedSpy.mockResolvedValue(true);

      const { context, getStdout } = createContext();
      await func.call(context, { "show-token": false });

      expect(getStdout()).toContain("Authenticated");
      expect(getStdout()).not.toContain("environment variable");
    });

    test("shows expiration for OAuth token with expiresAt", async () => {
      getAuthConfigSpy.mockReturnValue({
        token: "sntrys_abc123def456",
        source: "oauth",
        expiresAt: Date.now() + 3_600_000,
      });
      isAuthenticatedSpy.mockResolvedValue(true);

      const { context, getStdout } = createContext();
      await func.call(context, { "show-token": false });

      expect(getStdout()).toContain("Expires:");
    });

    test("shows auto-refresh enabled with refresh token", async () => {
      getAuthConfigSpy.mockReturnValue({
        token: "sntrys_abc123def456",
        source: "oauth",
        refreshToken: "refresh_xyz",
      });
      isAuthenticatedSpy.mockResolvedValue(true);

      const { context, getStdout } = createContext();
      await func.call(context, { "show-token": false });

      expect(getStdout()).toContain("Auto-refresh:");
      expect(getStdout()).toContain("enabled");
    });

    test("shows auto-refresh disabled without refresh token", async () => {
      getAuthConfigSpy.mockReturnValue({
        token: "sntrys_abc123def456",
        source: "oauth",
      });
      isAuthenticatedSpy.mockResolvedValue(true);

      const { context, getStdout } = createContext();
      await func.call(context, { "show-token": false });

      expect(getStdout()).toContain("Auto-refresh: disabled");
    });
  });

  describe("env var token (SENTRY_AUTH_TOKEN)", () => {
    test("hides config path for env var tokens", async () => {
      getAuthConfigSpy.mockReturnValue({
        token: "sntrys_env_token_123",
        source: "env:SENTRY_AUTH_TOKEN",
      });
      isAuthenticatedSpy.mockResolvedValue(true);

      const { context, getStdout } = createContext();
      await func.call(context, { "show-token": false });

      expect(getStdout()).not.toContain("Config:");
      expect(getStdout()).not.toContain("/fake/db/path");
    });

    test("shows 'Authenticated via SENTRY_AUTH_TOKEN environment variable'", async () => {
      getAuthConfigSpy.mockReturnValue({
        token: "sntrys_env_token_123",
        source: "env:SENTRY_AUTH_TOKEN",
      });
      isAuthenticatedSpy.mockResolvedValue(true);

      const { context, getStdout } = createContext();
      await func.call(context, { "show-token": false });

      expect(getStdout()).toContain("SENTRY_AUTH_TOKEN");
      expect(getStdout()).toContain("environment variable");
    });

    test("does not show expiration or auto-refresh for env tokens", async () => {
      getAuthConfigSpy.mockReturnValue({
        token: "sntrys_env_token_123",
        source: "env:SENTRY_AUTH_TOKEN",
      });
      isAuthenticatedSpy.mockResolvedValue(true);

      const { context, getStdout } = createContext();
      await func.call(context, { "show-token": false });

      expect(getStdout()).not.toContain("Expires:");
      expect(getStdout()).not.toContain("Auto-refresh");
    });

    test("masks token by default for env tokens", async () => {
      getAuthConfigSpy.mockReturnValue({
        token: "sntrys_env_token_123_long_enough",
        source: "env:SENTRY_AUTH_TOKEN",
      });
      isAuthenticatedSpy.mockResolvedValue(true);

      const { context, getStdout } = createContext();
      await func.call(context, { "show-token": false });

      expect(getStdout()).toContain("Token:");
      expect(getStdout()).not.toContain("sntrys_env_token_123_long_enough");
    });

    test("shows full token with --show-token for env tokens", async () => {
      getAuthConfigSpy.mockReturnValue({
        token: "sntrys_env_token_123_long_enough",
        source: "env:SENTRY_AUTH_TOKEN",
      });
      isAuthenticatedSpy.mockResolvedValue(true);

      const { context, getStdout } = createContext();
      await func.call(context, { "show-token": true });

      expect(getStdout()).toContain("sntrys_env_token_123_long_enough");
    });
  });

  describe("env var token (SENTRY_TOKEN)", () => {
    test("shows 'Authenticated via SENTRY_TOKEN environment variable'", async () => {
      getAuthConfigSpy.mockReturnValue({
        token: "sntrys_token_456",
        source: "env:SENTRY_TOKEN",
      });
      isAuthenticatedSpy.mockResolvedValue(true);

      const { context, getStdout } = createContext();
      await func.call(context, { "show-token": false });

      expect(getStdout()).toContain("SENTRY_TOKEN");
      expect(getStdout()).toContain("environment variable");
      // Should NOT say SENTRY_AUTH_TOKEN
      expect(getStdout()).not.toContain("SENTRY_AUTH_TOKEN");
    });
  });

  describe("credential verification", () => {
    test("shows error when verification fails", async () => {
      getAuthConfigSpy.mockReturnValue({
        token: "sntrys_abc",
        source: "oauth",
      });
      isAuthenticatedSpy.mockResolvedValue(true);
      listOrgsSpy.mockRejectedValue(new Error("Network error"));

      const { context, getStderr } = createContext();
      await func.call(context, { "show-token": false });

      expect(getStderr()).toContain("Could not verify credentials");
    });

    test("shows org list on successful verification", async () => {
      getAuthConfigSpy.mockReturnValue({
        token: "sntrys_abc",
        source: "oauth",
      });
      isAuthenticatedSpy.mockResolvedValue(true);
      listOrgsSpy.mockResolvedValue([{ name: "My Org", slug: "my-org" }]);

      const { context, getStdout } = createContext();
      await func.call(context, { "show-token": false });

      expect(getStdout()).toContain("Access verified");
      expect(getStdout()).toContain("My Org");
      expect(getStdout()).toContain("my-org");
    });
  });

  describe("defaults", () => {
    test("shows defaults when org and project are set", async () => {
      getAuthConfigSpy.mockReturnValue({
        token: "sntrys_abc",
        source: "oauth",
      });
      isAuthenticatedSpy.mockResolvedValue(true);
      getDefaultOrgSpy.mockResolvedValue("my-org");
      getDefaultProjectSpy.mockResolvedValue("my-project");

      const { context, getStdout } = createContext();
      await func.call(context, { "show-token": false });

      expect(getStdout()).toContain("Defaults:");
      expect(getStdout()).toContain("my-org");
      expect(getStdout()).toContain("my-project");
    });

    test("hides defaults section when none set", async () => {
      getAuthConfigSpy.mockReturnValue({
        token: "sntrys_abc",
        source: "oauth",
      });
      isAuthenticatedSpy.mockResolvedValue(true);

      const { context, getStdout } = createContext();
      await func.call(context, { "show-token": false });

      expect(getStdout()).not.toContain("Defaults:");
    });
  });

  describe("user info", () => {
    test("shows user identity when available", async () => {
      getAuthConfigSpy.mockReturnValue({
        token: "sntrys_abc",
        source: "oauth",
      });
      isAuthenticatedSpy.mockResolvedValue(true);
      getUserInfoSpy.mockReturnValue({
        name: "Jane Doe",
        email: "jane@example.com",
      });

      const { context, getStdout } = createContext();
      await func.call(context, { "show-token": false });

      expect(getStdout()).toContain("User:");
      expect(getStdout()).toContain("Jane Doe");
    });
  });
});
