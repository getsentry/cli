/**
 * Tests for DSN resolution used by `sentry event send`.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn
import * as projectsApi from "../../../src/lib/api/projects.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn
import * as auth from "../../../src/lib/db/auth.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn
import * as dsnIndex from "../../../src/lib/dsn/index.js";
import {
  EVENT_SEND_NO_DSN_MESSAGE,
  peelOrgProjectTarget,
  resolveEventSendDsn,
} from "../../../src/lib/envelope/event-send-dsn.js";
import { ConfigError } from "../../../src/lib/errors.js";
import type { ProjectKey } from "../../../src/types/sentry.js";
import { useEnvSandbox, useTestConfigDir } from "../../helpers.js";

const getTestDir = useTestConfigDir("event-send-dsn-");
useEnvSandbox(["SENTRY_DSN"]);

const SAAS_DSN = "https://abc123@o1.ingest.us.sentry.io/999";
const OTHER_DSN = "https://def456@o2.ingest.us.sentry.io/111";

const ACTIVE_KEY = {
  id: "key-1",
  name: "Default",
  isActive: true,
  dsn: { public: SAAS_DSN, secret: "" },
} as ProjectKey;

const OAUTH_SESSION = {
  token: "sntrys_access",
  source: "oauth" as const,
  refreshToken: "refresh_xyz",
  expiresAt: Date.now() + 3_600_000,
};

const REFRESHABLE_EXPIRED_OAUTH_SESSION = {
  token: "sntrys_expired_access",
  source: "oauth" as const,
  refreshToken: "refresh_xyz",
  expiresAt: Date.now() - 60_000,
};

function detectedDsn(raw: string) {
  return {
    raw,
    protocol: "https",
    publicKey: "abc123",
    host: "o1.ingest.us.sentry.io",
    projectId: "999",
    source: "env_file" as const,
  };
}

describe("peelOrgProjectTarget", () => {
  test("peels a leading org/project that is not a file", () => {
    const result = peelOrgProjectTarget(getTestDir(), [
      "grow-together-therapy/javascript-react",
    ]);
    expect(result.target).toEqual({
      org: "grow-together-therapy",
      project: "javascript-react",
    });
    expect(result.files).toEqual([]);
  });

  test("leaves remaining file args after the target", () => {
    const result = peelOrgProjectTarget(getTestDir(), [
      "sentry/cli",
      "./event.json",
    ]);
    expect(result.target).toEqual({ org: "sentry", project: "cli" });
    expect(result.files).toEqual(["./event.json"]);
  });

  test("does not peel an existing path that looks like org/project", () => {
    const cwd = getTestDir();
    mkdirSync(join(cwd, "acme"));
    writeFileSync(join(cwd, "acme", "web"), "{}");
    const result = peelOrgProjectTarget(cwd, ["acme/web"]);
    expect(result.target).toBeUndefined();
    expect(result.files).toEqual(["acme/web"]);
  });

  test("does not peel a JSON path with a slash", () => {
    const result = peelOrgProjectTarget(getTestDir(), ["events/crash.json"]);
    expect(result.target).toBeUndefined();
    expect(result.files).toEqual(["events/crash.json"]);
  });

  test("does not peel relative or absolute paths", () => {
    expect(
      peelOrgProjectTarget(getTestDir(), ["./sentry/cli"]).target
    ).toBeUndefined();
    expect(
      peelOrgProjectTarget(getTestDir(), ["/tmp/sentry/cli"]).target
    ).toBeUndefined();
  });
});

describe("resolveEventSendDsn", () => {
  let detectSpy: ReturnType<typeof vi.spyOn>;
  let keysSpy: ReturnType<typeof vi.spyOn>;
  let authSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    detectSpy = vi.spyOn(dsnIndex, "detectDsn").mockResolvedValue(null);
    keysSpy = vi.spyOn(projectsApi, "getProjectKeys").mockResolvedValue([]);
    authSpy = vi.spyOn(auth, "getAuthConfig").mockReturnValue(undefined);
  });

  afterEach(() => {
    detectSpy.mockRestore();
    keysSpy.mockRestore();
    authSpy.mockRestore();
  });

  test("--dsn wins over org/project and project scan", async () => {
    detectSpy.mockResolvedValue(detectedDsn(OTHER_DSN));
    authSpy.mockReturnValue(OAUTH_SESSION);
    keysSpy.mockResolvedValue([ACTIVE_KEY]);

    const dsn = await resolveEventSendDsn({ dsn: SAAS_DSN }, "/tmp", {
      org: "acme",
      project: "web",
    });
    expect(dsn).toBe(SAAS_DSN);
    expect(keysSpy).not.toHaveBeenCalled();
    expect(detectSpy).not.toHaveBeenCalled();
  });

  test("SENTRY_DSN wins over org/project", async () => {
    process.env.SENTRY_DSN = SAAS_DSN;
    authSpy.mockReturnValue(OAUTH_SESSION);
    keysSpy.mockResolvedValue([ACTIVE_KEY]);

    const dsn = await resolveEventSendDsn({}, "/tmp", {
      org: "acme",
      project: "web",
    });
    expect(dsn).toBe(SAAS_DSN);
    expect(keysSpy).not.toHaveBeenCalled();
  });

  test("org/project looks up the project client key when logged in", async () => {
    authSpy.mockReturnValue(OAUTH_SESSION);
    keysSpy.mockResolvedValue([ACTIVE_KEY]);

    const dsn = await resolveEventSendDsn({}, "/tmp", {
      org: "acme",
      project: "web",
    });
    expect(dsn).toBe(SAAS_DSN);
    expect(keysSpy).toHaveBeenCalledWith("acme", "web");
    expect(detectSpy).not.toHaveBeenCalled();
  });

  test("org/project without login throws ConfigError", async () => {
    await expect(
      resolveEventSendDsn({}, "/tmp", { org: "acme", project: "web" })
    ).rejects.toBeInstanceOf(ConfigError);
    expect(keysSpy).not.toHaveBeenCalled();
  });

  test("org/project looks up the client key when the access token is expired but a refresh token exists", async () => {
    authSpy.mockReturnValue(REFRESHABLE_EXPIRED_OAUTH_SESSION);
    keysSpy.mockResolvedValue([ACTIVE_KEY]);

    const dsn = await resolveEventSendDsn({}, "/tmp", {
      org: "acme",
      project: "web",
    });
    expect(dsn).toBe(SAAS_DSN);
    expect(keysSpy).toHaveBeenCalledWith("acme", "web");
  });

  test("org/project without client keys throws ConfigError", async () => {
    authSpy.mockReturnValue(OAUTH_SESSION);

    await expect(
      resolveEventSendDsn({}, "/tmp", { org: "acme", project: "web" })
    ).rejects.toMatchObject({
      name: "ConfigError",
      message: "No DSN found for acme/web. The project has no client keys.",
    });
  });

  test("falls back to project scan when no flag, env, or target", async () => {
    detectSpy.mockResolvedValue(detectedDsn(OTHER_DSN));
    const dsn = await resolveEventSendDsn({}, "/tmp", undefined);
    expect(dsn).toBe(OTHER_DSN);
  });

  test("throws ConfigError listing every source when nothing resolves", async () => {
    const err = await resolveEventSendDsn({}, "/tmp", undefined).catch(
      (error) => error
    );
    expect(err).toBeInstanceOf(ConfigError);
    expect((err as ConfigError).message).toBe(EVENT_SEND_NO_DSN_MESSAGE);
  });
});
