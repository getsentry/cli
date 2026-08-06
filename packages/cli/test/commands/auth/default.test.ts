/**
 * Tests for bare `sentry auth` smart default routing.
 */

import { describe, expect, test, vi } from "vitest";
import {
  authDefaultCommand,
  resolveAuthDefaultTarget,
} from "../../../src/commands/auth/default.js";

describe("resolveAuthDefaultTarget", () => {
  test("logged out → login", () => {
    expect(resolveAuthDefaultTarget({}, false)).toBe("login");
  });

  test("logged in → status", () => {
    expect(resolveAuthDefaultTarget({}, true)).toBe("status");
  });

  test("login-only flags force login even when authenticated", () => {
    expect(resolveAuthDefaultTarget({ token: "t" }, true)).toBe("login");
    expect(resolveAuthDefaultTarget({ force: true }, true)).toBe("login");
    expect(
      resolveAuthDefaultTarget({ url: "https://sentry.example.com" }, true)
    ).toBe("login");
    expect(resolveAuthDefaultTarget({ "read-only": true }, true)).toBe("login");
    expect(resolveAuthDefaultTarget({ scope: ["org:read"] }, true)).toBe(
      "login"
    );
  });

  test("status-only flags keep status when authenticated", () => {
    expect(
      resolveAuthDefaultTarget({ "show-token": true, fresh: true }, true)
    ).toBe("status");
  });

  test("empty scope array does not force login", () => {
    expect(resolveAuthDefaultTarget({ scope: [] }, true)).toBe("status");
  });
});

describe("authDefaultCommand", () => {
  test("dispatches to login when logged out", async () => {
    const isAuthenticated = vi.spyOn(
      await import("../../../src/lib/db/auth.js"),
      "isAuthenticated"
    );
    isAuthenticated.mockReturnValue(false);

    const loginLoader = vi.fn(async () =>
      vi.fn(async () => {
        // login path
      })
    );
    const statusLoader = vi.fn(async () =>
      vi.fn(async () => {
        // status path
      })
    );

    const { loginCommand } = await import(
      "../../../src/commands/auth/login.js"
    );
    const { statusCommand } = await import(
      "../../../src/commands/auth/status.js"
    );
    const loginSpy = vi
      .spyOn(loginCommand, "loader")
      .mockImplementation(loginLoader);
    const statusSpy = vi
      .spyOn(statusCommand, "loader")
      .mockImplementation(statusLoader);

    const context = {
      stdout: { write: vi.fn() },
      stderr: { write: vi.fn() },
      cwd: "/tmp",
      env: process.env,
    };

    const func = await authDefaultCommand.loader();
    await func.call(context as never, {
      timeout: 900,
      force: false,
      "read-only": false,
      "show-token": false,
      fresh: false,
      json: false,
    });

    expect(loginSpy).toHaveBeenCalledOnce();
    expect(statusSpy).not.toHaveBeenCalled();

    loginSpy.mockRestore();
    statusSpy.mockRestore();
    isAuthenticated.mockRestore();
  });

  test("dispatches to status when logged in", async () => {
    const isAuthenticated = vi.spyOn(
      await import("../../../src/lib/db/auth.js"),
      "isAuthenticated"
    );
    isAuthenticated.mockReturnValue(true);

    const loginLoader = vi.fn(async () =>
      vi.fn(async () => {
        // login path
      })
    );
    const statusLoader = vi.fn(async () =>
      vi.fn(async () => {
        // status path
      })
    );

    const { loginCommand } = await import(
      "../../../src/commands/auth/login.js"
    );
    const { statusCommand } = await import(
      "../../../src/commands/auth/status.js"
    );
    const loginSpy = vi
      .spyOn(loginCommand, "loader")
      .mockImplementation(loginLoader);
    const statusSpy = vi
      .spyOn(statusCommand, "loader")
      .mockImplementation(statusLoader);

    const context = {
      stdout: { write: vi.fn() },
      stderr: { write: vi.fn() },
      cwd: "/tmp",
      env: process.env,
    };

    const func = await authDefaultCommand.loader();
    await func.call(context as never, {
      timeout: 900,
      force: false,
      "read-only": false,
      "show-token": false,
      fresh: false,
      json: false,
    });

    expect(statusSpy).toHaveBeenCalledOnce();
    expect(loginSpy).not.toHaveBeenCalled();

    loginSpy.mockRestore();
    statusSpy.mockRestore();
    isAuthenticated.mockRestore();
  });
});
