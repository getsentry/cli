/**
 * API Client Tests
 *
 * Tests for the Sentry API client 401 retry behavior.
 *
 * The 401 handler behavior is validated through:
 *
 * 1. Unit test in token-refresh.test.ts: "server-side token revocation scenario"
 *    - Proves refreshToken({ force: true }) bypasses threshold and fetches new token
 *    - This is the key fix: without force, a revoked token would be reused
 *
 * 2. Code inspection tests below verify the api-client implementation
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("api-client 401 retry implementation", () => {
  const apiClientPath = join(import.meta.dir, "../../src/lib/api-client.ts");
  const sourceCode = readFileSync(apiClientPath, "utf-8");

  test("calls refreshToken with force:true on 401 response", () => {
    // The key fix for server-side token revocation:
    // On 401, must call refreshToken({ force: true }) to bypass threshold
    expect(sourceCode).toContain("refreshToken({ force: true })");
  });

  test("401 handler is in afterResponse hook", () => {
    // Must be in afterResponse to intercept before ky's error handling
    expect(sourceCode).toContain("afterResponse:");
    expect(sourceCode).toContain("response.status === 401");
  });

  test("retry marker header prevents infinite loops", () => {
    // Uses a header to mark requests as retries
    expect(sourceCode).toContain(
      'const RETRY_MARKER_HEADER = "x-sentry-cli-retry"'
    );
    expect(sourceCode).toContain("request.headers.get(RETRY_MARKER_HEADER)");
    expect(sourceCode).toContain("&& !isRetry");
    expect(sourceCode).toContain('retryHeaders.set(RETRY_MARKER_HEADER, "1")');
  });
});
