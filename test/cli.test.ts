/**
 * Unit tests for argv-parsing helpers in src/cli.ts.
 *
 * These run at boot to decide whether to bypass the .sentryclirc URL trust
 * check. They must be robust against global-flag placements so that
 * `auth login --url <url>` onboarding from inside a poisoned-rc repo
 * always works regardless of argv arrangement.
 */

import { describe, expect, test } from "bun:test";
import { extractPositionals, isTrustChangingCommand } from "../src/cli.js";

describe("extractPositionals", () => {
  test("returns all positionals when no flags present", () => {
    expect(extractPositionals(["auth", "login"])).toEqual(["auth", "login"]);
  });

  test("skips leading --flag=value", () => {
    expect(extractPositionals(["--json=false", "auth", "login"])).toEqual([
      "auth",
      "login",
    ]);
  });

  test("skips leading --flag (no value)", () => {
    expect(extractPositionals(["--json", "auth", "login"])).toEqual([
      "auth",
      "login",
    ]);
  });

  test("skips short -f flag", () => {
    expect(extractPositionals(["-v", "auth", "login"])).toEqual([
      "auth",
      "login",
    ]);
  });

  test("skips interleaved flags", () => {
    expect(
      extractPositionals(["--json", "auth", "--verbose", "login"])
    ).toEqual(["auth", "login"]);
  });

  test("-- terminates flag parsing; everything after is positional", () => {
    expect(extractPositionals(["--", "--not-a-flag", "auth", "login"])).toEqual(
      ["--not-a-flag", "auth", "login"]
    );
  });

  test("empty argv → empty positionals", () => {
    expect(extractPositionals([])).toEqual([]);
  });

  test("all-flags argv → empty positionals", () => {
    expect(extractPositionals(["--json", "--verbose", "-v"])).toEqual([]);
  });
});

describe("isTrustChangingCommand", () => {
  test("matches bare 'auth login'", () => {
    expect(isTrustChangingCommand(["auth", "login"])).toBe(true);
  });

  test("matches 'auth logout'", () => {
    expect(isTrustChangingCommand(["auth", "logout"])).toBe(true);
  });

  test("matches 'auth login --url <url>'", () => {
    expect(
      isTrustChangingCommand([
        "auth",
        "login",
        "--url",
        "https://sentry.example.com",
      ])
    ).toBe(true);
  });

  test("matches 'auth login' with leading global flag", () => {
    // Regression: earlier version used args[0]/args[1] positionally, which
    // failed when any flag preceded the command.
    expect(isTrustChangingCommand(["--json", "auth", "login"])).toBe(true);
  });

  test("matches 'auth login' with leading short flag", () => {
    expect(isTrustChangingCommand(["-v", "auth", "login"])).toBe(true);
  });

  test("does NOT match 'auth status' (credentials required)", () => {
    expect(isTrustChangingCommand(["auth", "status"])).toBe(false);
  });

  test("does NOT match 'auth whoami'", () => {
    expect(isTrustChangingCommand(["auth", "whoami"])).toBe(false);
  });

  test("does NOT match 'auth refresh' (needs matching token scope)", () => {
    expect(isTrustChangingCommand(["auth", "refresh"])).toBe(false);
  });

  test("does NOT match non-auth commands", () => {
    expect(isTrustChangingCommand(["issue", "list"])).toBe(false);
    expect(isTrustChangingCommand(["project", "view", "foo"])).toBe(false);
  });

  test("does NOT match 'login' without auth prefix (top-level alias doesn't exist)", () => {
    expect(isTrustChangingCommand(["login"])).toBe(false);
  });

  test("does NOT match empty argv", () => {
    expect(isTrustChangingCommand([])).toBe(false);
  });
});
