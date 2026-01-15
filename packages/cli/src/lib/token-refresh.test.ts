import { expect, mock, test } from "bun:test";

test("maybeRefreshTokenInBackground never throws", async () => {
  // Mock everything to fail
  mock.module("./config.js", () => ({
    readConfig: () => Promise.reject(new Error("config fail")),
    setAuthToken: () => Promise.reject(new Error("write fail")),
  }));
  mock.module("./oauth.js", () => ({
    refreshAccessToken: () => Promise.reject(new Error("network fail")),
  }));

  const { maybeRefreshTokenInBackground } = await import("./token-refresh.js");

  // Should complete without throwing
  await expect(maybeRefreshTokenInBackground()).resolves.toBeUndefined();
});
