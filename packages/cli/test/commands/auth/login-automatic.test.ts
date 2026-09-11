/**
 * Automatic login gates exercised through the real command and auth database.
 * The OAuth boundary stops execution before browser, network, or cache warming.
 */

import { isatty } from "node:tty";
import { run } from "@stricli/core";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { app } from "../../../src/app.js";
import type { SentryContext } from "../../../src/context.js";
import { getAuthConfig, setAuthToken } from "../../../src/lib/db/auth.js";
import {
  getProcessInfoFromOS,
  setProcessInfoProvider,
} from "../../../src/lib/detect-agent.js";
import { setEnv } from "../../../src/lib/env.js";
import { runInteractiveLogin } from "../../../src/lib/interactive-login.js";
import { useTestConfigDir } from "../../helpers.js";

vi.mock("node:tty", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:tty")>()),
  isatty: vi.fn(),
}));

vi.mock("../../../src/lib/interactive-login.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../../src/lib/interactive-login.js")
  >()),
  runInteractiveLogin: vi.fn(),
}));

describe("auth login --automatic", () => {
  const getConfigDir = useTestConfigDir("automatic-login-");
  let env: NodeJS.ProcessEnv;

  beforeEach(() => {
    env = {
      SENTRY_CONFIG_DIR: getConfigDir(),
      SENTRY_CLI_NO_TELEMETRY: "1",
    };
    setEnv(env);
    vi.mocked(isatty).mockReturnValue(true);
    setProcessInfoProvider(async () => ({ name: "bash", ppid: 1 }));
    vi.mocked(runInteractiveLogin).mockRejectedValue(
      new Error("OAuth boundary reached")
    );
  });

  afterEach(() => {
    vi.mocked(runInteractiveLogin).mockReset();
    vi.mocked(isatty).mockReset();
    setProcessInfoProvider(getProcessInfoFromOS);
    setEnv(process.env);
  });

  /** Run the parsed command with isolated output, environment, and exit status. */
  async function login(flags: string[] = ["--automatic"]) {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const stdoutWriter = { write: (value: string) => stdout.push(value) };
    const stderrWriter = { write: (value: string) => stderr.push(value) };
    const context = {
      env,
      cwd: getConfigDir(),
      homeDir: getConfigDir(),
      configDir: getConfigDir(),
      stdout: stdoutWriter,
      stderr: stderrWriter,
      stdin: process.stdin,
      process: {
        env,
        exitCode: undefined,
        stdout: stdoutWriter,
        stderr: stderrWriter,
      },
    } as unknown as SentryContext;

    await run(app, ["auth", "login", ...flags], context);

    return {
      stdout: stdout.join(""),
      stderr: stderr.join(""),
      exitCode: context.process.exitCode,
    };
  }

  test("enters the normal OAuth flow for an unauthenticated human TTY", async () => {
    const result = await login();

    expect(runInteractiveLogin).toHaveBeenCalledExactlyOnceWith({
      timeout: 900_000,
      scope: undefined,
    });
    expect(result.stderr).toContain("OAuth boundary reached");
  });

  test.each([0, 1])("skips login when fd %i is not a TTY", async (fd) => {
    vi.mocked(isatty).mockImplementation((candidate) => candidate !== fd);

    const result = await login();

    expect(runInteractiveLogin).not.toHaveBeenCalled();
    expect(result.exitCode).toBe(0);
    expect(result.stdout + result.stderr).toBe("");
  });

  test.each([
    { AI_AGENT: "claude" },
    { CODEX_THREAD_ID: "test-session" },
  ])("skips detected agents even with a TTY: %j", async (agentEnv) => {
    Object.assign(env, agentEnv);

    const result = await login();

    expect(runInteractiveLogin).not.toHaveBeenCalled();
    expect(result.exitCode).toBe(0);
  });

  test("waits for process-tree agent detection before starting login", async () => {
    setProcessInfoProvider(async () => {
      await Promise.resolve();
      return { name: "codex", ppid: 1 };
    });

    const result = await login();

    expect(runInteractiveLogin).not.toHaveBeenCalled();
    expect(result.exitCode).toBe(0);
  });

  test.each([
    { expiresIn: undefined, refreshToken: undefined },
    { expiresIn: -1, refreshToken: "refresh-token" },
  ])("keeps existing usable credentials without re-authentication: %j", async ({
    expiresIn,
    refreshToken,
  }) => {
    setAuthToken("stored-token", expiresIn, refreshToken);

    const result = await login();

    expect(runInteractiveLogin).not.toHaveBeenCalled();
    expect(result.exitCode).toBe(0);
    expect(getAuthConfig()?.token).toBe("stored-token");
  });

  test.each([
    "SENTRY_AUTH_TOKEN",
    "SENTRY_TOKEN",
  ])("skips login with an existing %s", async (name) => {
    env[name] = "existing-token";

    const result = await login();

    expect(runInteractiveLogin).not.toHaveBeenCalled();
    expect(result.exitCode).toBe(0);
  });

  test.each([
    { flags: ["--automatic", "--json"], outputFormat: undefined },
    { flags: ["--automatic"], outputFormat: "json" },
  ])("skips login for JSON output: %j", async ({ flags, outputFormat }) => {
    env.SENTRY_OUTPUT_FORMAT = outputFormat;

    const result = await login(flags);

    expect(runInteractiveLogin).not.toHaveBeenCalled();
    expect(result.exitCode).toBe(0);
  });

  test("refuses an untrusted host before starting OAuth", async () => {
    env.SENTRY_HOST = "https://sentry.example.com";

    const result = await login();

    expect(runInteractiveLogin).not.toHaveBeenCalled();
    expect(result.stderr).toContain("Refusing to log in against");
    expect(result.exitCode).not.toBe(0);
  });

  test("keeps explicit login available without automatic human gating", async () => {
    vi.mocked(isatty).mockReturnValue(false);
    env.AI_AGENT = "claude";

    const result = await login([]);

    expect(runInteractiveLogin).toHaveBeenCalledOnce();
    expect(result.stderr).toContain("OAuth boundary reached");
  });

  test("keeps the installer flag hidden from help", async () => {
    const result = await login(["--help"]);

    expect(result.stdout).toContain(
      "Log in to Sentry using OAuth or an API token."
    );
    expect(result.stdout).not.toContain("--automatic");
    expect(runInteractiveLogin).not.toHaveBeenCalled();
  });
});
