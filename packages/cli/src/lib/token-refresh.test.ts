import { expect, test } from "bun:test";
import { maybeRefreshTokenInBackground } from "./token-refresh.js";

test("maybeRefreshTokenInBackground never throws", async () => {
  // Call directly - it should handle missing/invalid config gracefully
  // and never throw, regardless of the environment state
  await expect(maybeRefreshTokenInBackground()).resolves.toBeUndefined();
});
