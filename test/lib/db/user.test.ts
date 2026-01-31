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
    });
  });

  test("handles missing email and username", () => {
    setUserInfo({ userId: "12345" });

    const result = getUserInfo();
    expect(result).toEqual({
      userId: "12345",
      email: undefined,
      username: undefined,
    });
  });
});

describe("setUserInfo", () => {
  test("stores user info with all fields", () => {
    setUserInfo({
      userId: "user123",
      email: "user@test.com",
      username: "myuser",
    });

    const result = getUserInfo();
    expect(result?.userId).toBe("user123");
    expect(result?.email).toBe("user@test.com");
    expect(result?.username).toBe("myuser");
  });

  test("overwrites existing user info", () => {
    setUserInfo({ userId: "first", email: "first@test.com" });
    setUserInfo({ userId: "second", email: "second@test.com" });

    const result = getUserInfo();
    expect(result?.userId).toBe("second");
    expect(result?.email).toBe("second@test.com");
  });

  test("stores user info with only userId", () => {
    setUserInfo({ userId: "minimal" });

    const result = getUserInfo();
    expect(result?.userId).toBe("minimal");
    expect(result?.email).toBeUndefined();
    expect(result?.username).toBeUndefined();
  });
});
