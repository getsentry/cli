/**
 * User Info Storage Tests
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { getUserInfo, setUserInfo } from "../../../src/lib/db/user.js";
import { cleanupTestDir, createTestConfigDir } from "../../helpers.js";

let testConfigDir: string;

beforeEach(async () => {
  testConfigDir = await createTestConfigDir("test-user-");
  process.env.SENTRY_CLI_CONFIG_DIR = testConfigDir;
});

afterEach(async () => {
  delete process.env.SENTRY_CLI_CONFIG_DIR;
  await cleanupTestDir(testConfigDir);
});

describe("getUserInfo", () => {
  test("returns undefined when no user info stored", () => {
    const result = getUserInfo();
    expect(result).toBeUndefined();
  });

  test("returns stored user info", () => {
    setUserInfo({
      userId: "12345",
      email: "test@example.com",
      username: "testuser",
    });

    const result = getUserInfo();
    expect(result).toEqual({
      userId: "12345",
      email: "test@example.com",
      username: "testuser",
      name: undefined,
    });
  });

  test("returns stored user info with name", () => {
    setUserInfo({
      userId: "12345",
      email: "test@example.com",
      username: "testuser",
      name: "Test User",
    });

    const result = getUserInfo();
    expect(result).toEqual({
      userId: "12345",
      email: "test@example.com",
      username: "testuser",
      name: "Test User",
    });
  });

  test("handles missing email, username, and name", () => {
    setUserInfo({ userId: "12345" });

    const result = getUserInfo();
    expect(result).toEqual({
      userId: "12345",
      email: undefined,
      username: undefined,
      name: undefined,
    });
  });
});

describe("setUserInfo", () => {
  test("stores user info with all fields", () => {
    setUserInfo({
      userId: "user123",
      email: "user@test.com",
      username: "myuser",
      name: "My User",
    });

    const result = getUserInfo();
    expect(result?.userId).toBe("user123");
    expect(result?.email).toBe("user@test.com");
    expect(result?.username).toBe("myuser");
    expect(result?.name).toBe("My User");
  });

  test("overwrites existing user info", () => {
    setUserInfo({ userId: "first", email: "first@test.com", name: "First" });
    setUserInfo({ userId: "second", email: "second@test.com", name: "Second" });

    const result = getUserInfo();
    expect(result?.userId).toBe("second");
    expect(result?.email).toBe("second@test.com");
    expect(result?.name).toBe("Second");
  });

  test("stores user info with only userId", () => {
    setUserInfo({ userId: "minimal" });

    const result = getUserInfo();
    expect(result?.userId).toBe("minimal");
    expect(result?.email).toBeUndefined();
    expect(result?.username).toBeUndefined();
    expect(result?.name).toBeUndefined();
  });

  test("stores user info with name but no username", () => {
    setUserInfo({
      userId: "user456",
      email: "user@test.com",
      name: "Display Name",
    });

    const result = getUserInfo();
    expect(result?.userId).toBe("user456");
    expect(result?.email).toBe("user@test.com");
    expect(result?.username).toBeUndefined();
    expect(result?.name).toBe("Display Name");
  });
});
