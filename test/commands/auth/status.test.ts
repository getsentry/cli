/**
 * Status Command Tests
 *
 * Tests for the statusCommand func() in src/commands/auth/status.ts.
 * Focuses on the env-token-aware branches and the structured data output.
 * Uses spyOn to mock db/auth, db/defaults, db/user, and api-client.
 *
 * The command returns { data: AuthStatusData } which is rendered to stdout
 * by the buildCommand wrapper. Tests assert on stdout content for human
 * output and parse JSON for --json output.
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

type StatusFlags = {
  readonly "show-token": boolean;
  readonly json: boolean;
};
type StatusFunc = (this: unknown, flags: StatusFlags) => Promise<void>;

/**
 * Create a mock Stricli context with stdout capture.
 */
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
          /* unused */
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
    listOrgsSpy = spyOn(apiClient, "listOrganizationsUncached");

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

  /** Default flags for most tests (human output) */
  const humanFlags: StatusFlags = { "show-token": false, json: false };
  /** JSON output flags */
  const jsonFlags: StatusFlags = { "show-token": false, json: true };

  describe("not authenticated", () => {
    test("throws AuthError with skipAutoAuth when not authenticated", async () => {
      getAuthConfigSpy.mockReturnValue(undefined);
      isAuthenticatedSpy.mockResolvedValue(false);

      const { context } = createContext();

      try {
        await func.call(context, humanFlags);
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

      const { context, getOutput } = createContext();
      await func.call(context, humanFlags);

      expect(getOutput()).toContain("/fake/db/path");
    });

    test("shows 'Authenticated' without env var mention for OAuth", async () => {
      getAuthConfigSpy.mockReturnValue({
        token: "sntrys_abc123def456",
        source: "oauth",
      });
      isAuthenticatedSpy.mockResolvedValue(true);

      const { context, getOutput } = createContext();
      await func.call(context, humanFlags);

      expect(getOutput()).toContain("Authenticated");
      expect(getOutput()).not.toContain("environment variable");
    });

    test("shows expiration for OAuth token with expiresAt", async () => {
      getAuthConfigSpy.mockReturnValue({
        token: "sntrys_abc123def456",
        source: "oauth",
        expiresAt: Date.now() + 3_600_000,
      });
      isAuthenticatedSpy.mockResolvedValue(true);

      const { context, getOutput } = createContext();
      await func.call(context, humanFlags);

      expect(getOutput()).toContain("Expires");
    });

    test("shows auto-refresh enabled with refresh token", async () => {
      getAuthConfigSpy.mockReturnValue({
        token: "sntrys_abc123def456",
        source: "oauth",
        refreshToken: "refresh_xyz",
      });
      isAuthenticatedSpy.mockResolvedValue(true);

      const { context, getOutput } = createContext();
      await func.call(context, humanFlags);

      expect(getOutput()).toContain("Auto-refresh");
      expect(getOutput()).toContain("enabled");
    });

    test("shows auto-refresh disabled without refresh token", async () => {
      getAuthConfigSpy.mockReturnValue({
        token: "sntrys_abc123def456",
        source: "oauth",
      });
      isAuthenticatedSpy.mockResolvedValue(true);

      const { context, getOutput } = createContext();
      await func.call(context, humanFlags);

      expect(getOutput()).toContain("Auto-refresh");
      expect(getOutput()).toContain("disabled");
    });
  });

  describe("env var token (SENTRY_AUTH_TOKEN)", () => {
    test("hides config path for env var tokens", async () => {
      getAuthConfigSpy.mockReturnValue({
        token: "sntrys_env_token_123",
        source: "env:SENTRY_AUTH_TOKEN",
      });
      isAuthenticatedSpy.mockResolvedValue(true);

      const { context, getOutput } = createContext();
      await func.call(context, humanFlags);

      expect(getOutput()).not.toContain("/fake/db/path");
    });

    test("shows 'Authenticated via SENTRY_AUTH_TOKEN environment variable'", async () => {
      getAuthConfigSpy.mockReturnValue({
        token: "sntrys_env_token_123",
        source: "env:SENTRY_AUTH_TOKEN",
      });
      isAuthenticatedSpy.mockResolvedValue(true);

      const { context, getOutput } = createContext();
      await func.call(context, humanFlags);

      // Markdown escapes underscores: SENTRY\_AUTH\_TOKEN
      expect(getOutput()).toContain("SENTRY\\_AUTH\\_TOKEN");
      expect(getOutput()).toContain("environment variable");
    });

    test("does not show expiration or auto-refresh for env tokens", async () => {
      getAuthConfigSpy.mockReturnValue({
        token: "sntrys_env_token_123",
        source: "env:SENTRY_AUTH_TOKEN",
      });
      isAuthenticatedSpy.mockResolvedValue(true);

      const { context, getOutput } = createContext();
      await func.call(context, humanFlags);

      expect(getOutput()).not.toContain("Expires");
      expect(getOutput()).not.toContain("Auto-refresh");
    });

    test("masks token by default for env tokens", async () => {
      getAuthConfigSpy.mockReturnValue({
        token: "sntrys_env_token_123_long_enough",
        source: "env:SENTRY_AUTH_TOKEN",
      });
      isAuthenticatedSpy.mockResolvedValue(true);

      const { context, getOutput } = createContext();
      await func.call(context, humanFlags);

      const out = getOutput();
      expect(out).toContain("Token");
      expect(out).not.toContain("sntrys_env_token_123_long_enough");
    });

    test("shows full token with --show-token for env tokens", async () => {
      getAuthConfigSpy.mockReturnValue({
        token: "sntrys_env_token_123_long_enough",
        source: "env:SENTRY_AUTH_TOKEN",
      });
      isAuthenticatedSpy.mockResolvedValue(true);

      const { context, getOutput } = createContext();
      await func.call(context, { ...humanFlags, "show-token": true });

      expect(getOutput()).toContain("sntrys_env_token_123_long_enough");
    });
  });

  describe("env var token (SENTRY_TOKEN)", () => {
    test("shows 'Authenticated via SENTRY_TOKEN environment variable'", async () => {
      getAuthConfigSpy.mockReturnValue({
        token: "sntrys_token_456",
        source: "env:SENTRY_TOKEN",
      });
      isAuthenticatedSpy.mockResolvedValue(true);

      const { context, getOutput } = createContext();
      await func.call(context, humanFlags);

      // Markdown escapes underscores: SENTRY\_TOKEN
      expect(getOutput()).toContain("SENTRY\\_TOKEN");
      expect(getOutput()).toContain("environment variable");
      // Should NOT say SENTRY_AUTH_TOKEN (escaped form)
      expect(getOutput()).not.toContain("SENTRY\\_AUTH\\_TOKEN");
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

      const { context, getOutput } = createContext();
      await func.call(context, humanFlags);

      expect(getOutput()).toContain("Could not verify credentials");
    });

    test("shows org list on successful verification", async () => {
      getAuthConfigSpy.mockReturnValue({
        token: "sntrys_abc",
        source: "oauth",
      });
      isAuthenticatedSpy.mockResolvedValue(true);
      listOrgsSpy.mockResolvedValue([{ name: "My Org", slug: "my-org" }]);

      const { context, getOutput } = createContext();
      await func.call(context, humanFlags);

      expect(getOutput()).toContain("Access verified");
      expect(getOutput()).toContain("My Org");
      expect(getOutput()).toContain("my-org");
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

      const { context, getOutput } = createContext();
      await func.call(context, humanFlags);

      expect(getOutput()).toContain("Defaults");
      expect(getOutput()).toContain("my-org");
      expect(getOutput()).toContain("my-project");
    });

    test("hides defaults section when none set", async () => {
      getAuthConfigSpy.mockReturnValue({
        token: "sntrys_abc",
        source: "oauth",
      });
      isAuthenticatedSpy.mockResolvedValue(true);

      const { context, getOutput } = createContext();
      await func.call(context, humanFlags);

      expect(getOutput()).not.toContain("Defaults");
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

      const { context, getOutput } = createContext();
      await func.call(context, humanFlags);

      expect(getOutput()).toContain("User");
      expect(getOutput()).toContain("Jane Doe");
    });
  });

  describe("JSON output", () => {
    test("outputs valid JSON with all fields", async () => {
      getAuthConfigSpy.mockReturnValue({
        token: "sntrys_abc123def456",
        source: "oauth",
        expiresAt: Date.now() + 3_600_000,
        refreshToken: "refresh_xyz",
      });
      isAuthenticatedSpy.mockResolvedValue(true);
      getUserInfoSpy.mockReturnValue({
        name: "Jane Doe",
        email: "jane@example.com",
        username: "janedoe",
      });
      getDefaultOrgSpy.mockResolvedValue("my-org");
      getDefaultProjectSpy.mockResolvedValue("my-project");
      listOrgsSpy.mockResolvedValue([{ name: "My Org", slug: "my-org" }]);

      const { context, getOutput } = createContext();
      await func.call(context, jsonFlags);

      const parsed = JSON.parse(getOutput());
      expect(parsed.authenticated).toBe(true);
      expect(parsed.source).toBe("oauth");
      expect(parsed.configPath).toBe("/fake/db/path");
      expect(parsed.user.name).toBe("Jane Doe");
      expect(parsed.token.display).toContain("...");
      expect(parsed.token.refreshEnabled).toBe(true);
      expect(parsed.defaults.organization).toBe("my-org");
      expect(parsed.defaults.project).toBe("my-project");
      expect(parsed.verification.success).toBe(true);
      expect(parsed.verification.organizations).toHaveLength(1);
    });

    test("JSON token is masked by default", async () => {
      getAuthConfigSpy.mockReturnValue({
        token: "sntrys_abc123def456",
        source: "oauth",
      });
      isAuthenticatedSpy.mockResolvedValue(true);

      const { context, getOutput } = createContext();
      await func.call(context, jsonFlags);

      const parsed = JSON.parse(getOutput());
      expect(parsed.token.display).not.toBe("sntrys_abc123def456");
      expect(parsed.token.display).toContain("...");
    });

    test("JSON includes verification error on failure", async () => {
      getAuthConfigSpy.mockReturnValue({
        token: "sntrys_abc",
        source: "oauth",
      });
      isAuthenticatedSpy.mockResolvedValue(true);
      listOrgsSpy.mockRejectedValue(new Error("Network error"));

      const { context, getOutput } = createContext();
      await func.call(context, jsonFlags);

      const parsed = JSON.parse(getOutput());
      expect(parsed.verification.success).toBe(false);
      expect(parsed.verification.error).toContain("Network error");
    });
  });
});
