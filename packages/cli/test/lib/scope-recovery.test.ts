import { describe, expect, test, vi } from "vitest";
import { ApiError } from "../../src/lib/errors.js";
import {
  runWithScopeRecovery,
  type ScopeRecoveryRuntime,
} from "../../src/lib/scope-recovery.js";

function missingScopeError(): ApiError {
  return new ApiError(
    "Forbidden",
    403,
    "You do not have permission to perform this action.",
    undefined,
    true,
    ["team:admin"]
  );
}

function runtime(
  overrides: Partial<ScopeRecoveryRuntime> = {}
): ScopeRecoveryRuntime {
  return {
    assertTrustedHost: vi.fn(),
    confirm: vi.fn().mockResolvedValue(true),
    getAuthSource: () => "oauth",
    inputIsTty: () => true,
    promptsAllowed: () => true,
    write: vi.fn(),
    ...overrides,
  };
}

describe("runWithScopeRecovery", () => {
  test("refreshes an old OAuth grant with current scopes and retries once", async () => {
    const originalError = missingScopeError();
    const proceed = vi
      .fn<(argv: string[]) => Promise<void>>()
      .mockRejectedValueOnce(originalError)
      .mockResolvedValueOnce();
    const login = vi.fn().mockResolvedValue({
      method: "oauth",
      configPath: "/tmp/config",
    });
    const testRuntime = runtime();

    await runWithScopeRecovery(
      proceed,
      ["project", "create"],
      login,
      testRuntime
    );

    expect(proceed).toHaveBeenCalledTimes(2);
    expect(testRuntime.assertTrustedHost).toHaveBeenCalledOnce();
    expect(testRuntime.confirm).toHaveBeenCalledOnce();
    expect(login).toHaveBeenCalledOnce();
    const scope = login.mock.calls[0]?.[0]?.scope;
    expect(scope?.split(" ")).toEqual(
      expect.arrayContaining(["org:read", "project:write", "team:admin"])
    );
  });

  test("keeps response-detail parsing as a legacy server fallback", async () => {
    const originalError = new ApiError(
      "Forbidden",
      403,
      "You do not have the required scope: project:admin"
    );
    const proceed = vi
      .fn<(argv: string[]) => Promise<void>>()
      .mockRejectedValueOnce(originalError)
      .mockResolvedValueOnce();
    const login = vi.fn().mockResolvedValue({
      method: "oauth",
      configPath: "/tmp/config",
    });

    await runWithScopeRecovery(proceed, [], login, runtime());

    expect(login.mock.calls[0]?.[0]?.scope?.split(" ")).toContain(
      "project:admin"
    );
  });

  test("can recover a scope introduced by a newer Sentry server", async () => {
    const originalError = new ApiError(
      "Forbidden",
      403,
      "Insufficient scope",
      undefined,
      true,
      ["project:new-capability"]
    );
    const proceed = vi
      .fn<(argv: string[]) => Promise<void>>()
      .mockRejectedValueOnce(originalError)
      .mockResolvedValueOnce();
    const login = vi.fn().mockResolvedValue({
      method: "oauth",
      configPath: "/tmp/config",
    });

    await runWithScopeRecovery(proceed, [], login, runtime());

    expect(login.mock.calls[0]?.[0]?.scope?.split(" ")).toContain(
      "project:new-capability"
    );
  });

  test.each([
    [["init", "--yes"], "oauth" as const],
    [["init", "-y"], "oauth" as const],
    [["init", "--dry-run"], "oauth" as const],
    [["project", "create"], "env:SENTRY_AUTH_TOKEN" as const],
  ])("does not refresh unattended commands or env tokens", async (argv, source) => {
    const originalError = missingScopeError();
    const proceed = vi.fn().mockRejectedValue(originalError);
    const login = vi.fn();

    await expect(
      runWithScopeRecovery(
        proceed,
        argv,
        login,
        runtime({ getAuthSource: () => source })
      )
    ).rejects.toBe(originalError);

    expect(proceed).toHaveBeenCalledOnce();
    expect(login).not.toHaveBeenCalled();
  });

  test("preserves the original error when the credential store cannot be read", async () => {
    const originalError = missingScopeError();
    const proceed = vi.fn().mockRejectedValue(originalError);
    const login = vi.fn();

    await expect(
      runWithScopeRecovery(
        proceed,
        [],
        login,
        runtime({
          getAuthSource: () => {
            throw new Error("database unavailable");
          },
        })
      )
    ).rejects.toBe(originalError);
    expect(login).not.toHaveBeenCalled();
  });

  test.each([
    { inputIsTty: () => false },
    { promptsAllowed: () => false },
  ])("does not refresh outside an interactive prompt context", async (overrides) => {
    const originalError = missingScopeError();
    const proceed = vi.fn().mockRejectedValue(originalError);
    const login = vi.fn();

    await expect(
      runWithScopeRecovery(proceed, [], login, runtime(overrides))
    ).rejects.toBe(originalError);
    expect(login).not.toHaveBeenCalled();
  });

  test("preserves the original error when refresh is declined", async () => {
    const originalError = missingScopeError();
    const proceed = vi.fn().mockRejectedValue(originalError);
    const login = vi.fn();

    await expect(
      runWithScopeRecovery(
        proceed,
        [],
        login,
        runtime({ confirm: vi.fn().mockResolvedValue(false) })
      )
    ).rejects.toBe(originalError);
    expect(login).not.toHaveBeenCalled();
  });

  test("preserves the original error when login is cancelled", async () => {
    const originalError = missingScopeError();
    const proceed = vi.fn().mockRejectedValue(originalError);
    const login = vi.fn().mockResolvedValue(null);

    await expect(
      runWithScopeRecovery(proceed, [], login, runtime())
    ).rejects.toBe(originalError);
    expect(proceed).toHaveBeenCalledOnce();
  });

  test("does not attempt a second recovery when the retry fails", async () => {
    const firstError = missingScopeError();
    const retryError = missingScopeError();
    const proceed = vi
      .fn<(argv: string[]) => Promise<void>>()
      .mockRejectedValueOnce(firstError)
      .mockRejectedValueOnce(retryError);
    const login = vi.fn().mockResolvedValue({
      method: "oauth",
      configPath: "/tmp/config",
    });
    const testRuntime = runtime();

    await expect(
      runWithScopeRecovery(proceed, [], login, testRuntime)
    ).rejects.toBe(retryError);
    expect(proceed).toHaveBeenCalledTimes(2);
    expect(testRuntime.confirm).toHaveBeenCalledOnce();
    expect(login).toHaveBeenCalledOnce();
  });
});
