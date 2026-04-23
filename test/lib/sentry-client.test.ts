/**
 * Tests for the authenticated fetch retry + timeout behavior — CLI-1D6
 * regression coverage.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { setAuthToken } from "../../src/lib/db/auth.js";
import { TimeoutError } from "../../src/lib/errors.js";
import {
  __injectTimeoutOverrideForTests,
  __resolveRequestTimeoutMsForTests,
  getSdkConfig,
  resetAuthenticatedFetch,
} from "../../src/lib/sentry-client.js";
import { mockFetch, useTestConfigDir } from "../helpers.js";

useTestConfigDir("sentry-client-");

let originalFetch: typeof globalThis.fetch;
const REGION_URL = "https://us.sentry.io";

beforeEach(async () => {
  originalFetch = globalThis.fetch;
  // Non-expiring token — refreshToken() becomes a no-op.
  await setAuthToken("test-token");
  resetAuthenticatedFetch();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  resetAuthenticatedFetch();
});

function getAuthenticatedFetch(): typeof fetch {
  return getSdkConfig(REGION_URL).fetch as typeof fetch;
}

describe("fetchWithRetry / buildAttemptFactory", () => {
  test("retries a POST with a string body without re-consuming the body", async () => {
    const seen: string[] = [];
    let callCount = 0;

    globalThis.fetch = mockFetch(async (_input, init) => {
      callCount += 1;
      const body = init?.body;
      if (typeof body === "string") {
        seen.push(body);
      } else if (body) {
        seen.push(await new Response(body as BodyInit).text());
      } else {
        seen.push("<empty>");
      }
      if (callCount === 1) {
        return new Response("busy", { status: 503 });
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const authFetch = getAuthenticatedFetch();
    const res = await authFetch("https://us.sentry.io/api/0/organizations/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug: "acme" }),
    });

    expect(res.status).toBe(200);
    expect(callCount).toBe(2);
    expect(seen).toEqual([
      JSON.stringify({ slug: "acme" }),
      JSON.stringify({ slug: "acme" }),
    ]);
  });

  test("retries a POST built from a Request object without consuming its body", async () => {
    // SDK path: @sentry/api hands us a Request as the sole argument.
    // Pre-fix: attempt 2 saw a consumed body stream.
    let callCount = 0;
    const seen: string[] = [];

    globalThis.fetch = mockFetch(async (input) => {
      callCount += 1;
      if (input instanceof Request) {
        seen.push(await input.clone().text());
      } else {
        seen.push("<non-request>");
      }
      if (callCount === 1) {
        return new Response("gateway", { status: 502 });
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const payload = JSON.stringify({ stopping_point: "root_cause" });
    const request = new Request(
      "https://us.sentry.io/api/0/organizations/acme/issues/1/autofix/",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
      }
    );

    const authFetch = getAuthenticatedFetch();
    const res = await authFetch(request);

    expect(res.status).toBe(200);
    expect(callCount).toBe(2);
    expect(seen).toEqual([payload, payload]);
  });

  test("retries with a ReadableStream body by materializing once", async () => {
    // Streams are consumed on first read; without up-front materialization
    // attempt 2 would see an undefined body.
    let callCount = 0;
    const seen: string[] = [];

    globalThis.fetch = mockFetch(async (_input, init) => {
      callCount += 1;
      const body = init?.body;
      if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) {
        seen.push(new TextDecoder().decode(body as ArrayBuffer));
      } else if (typeof body === "string") {
        seen.push(body);
      } else if (body) {
        seen.push(await new Response(body as BodyInit).text());
      } else {
        seen.push("<empty>");
      }
      if (callCount === 1) {
        return new Response("", { status: 500 });
      }
      return new Response("{}", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("streamed-body"));
        controller.close();
      },
    });

    const authFetch = getAuthenticatedFetch();
    // Node's fetch requires duplex: "half" for streamed bodies; Bun accepts
    // it as a no-op.
    const res = await authFetch("https://us.sentry.io/api/0/streamed/", {
      method: "POST",
      body: stream,
      duplex: "half",
    } as RequestInit & { duplex?: string });

    expect(res.status).toBe(200);
    expect(callCount).toBe(2);
    expect(seen).toEqual(["streamed-body", "streamed-body"]);
  });
});

describe("fetchWithTimeout internal timeout classification", () => {
  test("surfaces TimeoutError on the last attempt when our own timeout fires", async () => {
    // Inject a tiny timeout so we don't wait 30 s for the default to fire.
    const restore = __injectTimeoutOverrideForTests({
      pattern: /\/___timeout-test___\//,
      timeoutMs: 50,
    });

    try {
      let calls = 0;
      globalThis.fetch = mockFetch(async (_input, init) => {
        calls += 1;
        return await new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (!signal) {
            reject(new Error("no signal provided — test bug"));
            return;
          }
          if (signal.aborted) {
            reject(new DOMException("aborted", "AbortError"));
            return;
          }
          signal.addEventListener(
            "abort",
            () => reject(new DOMException("aborted", "AbortError")),
            { once: true }
          );
        });
      });

      const authFetch = getAuthenticatedFetch();
      let thrown: unknown;
      try {
        await authFetch("https://us.sentry.io/___timeout-test___/");
      } catch (err) {
        thrown = err;
      }

      expect(thrown).toBeInstanceOf(TimeoutError);
      expect((thrown as TimeoutError).message).toContain(
        "Request timed out after"
      );
      // MAX_RETRIES = 2 → attempts 0, 1, 2.
      expect(calls).toBe(3);
    } finally {
      restore();
    }
  });
});

describe("user abort passthrough", () => {
  test("external AbortSignal.abort() propagates the original AbortError", async () => {
    let fetchCalled = false;
    globalThis.fetch = mockFetch(async (_input, init) => {
      fetchCalled = true;
      return await new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (signal?.aborted) {
          reject(new DOMException("aborted", "AbortError"));
          return;
        }
        signal?.addEventListener(
          "abort",
          () => reject(new DOMException("aborted", "AbortError")),
          { once: true }
        );
      });
    });

    const controller = new AbortController();
    const authFetch = getAuthenticatedFetch();
    const promise = authFetch("https://us.sentry.io/api/0/organizations/", {
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 10);

    let thrown: unknown;
    try {
      await promise;
    } catch (err) {
      thrown = err;
    }

    expect(fetchCalled).toBe(true);
    // User aborts must propagate unchanged — neither a TimeoutError nor an
    // ApiError wrapper. The central error handler in app.ts depends on it.
    expect(thrown).toBeInstanceOf(DOMException);
    expect((thrown as DOMException).name).toBe("AbortError");
  });
});

describe("resolveTimeoutMs", () => {
  test("returns 120 000 ms for Seer /autofix/ POST paths", () => {
    expect(
      __resolveRequestTimeoutMsForTests(
        "https://us.sentry.io/api/0/organizations/acme/issues/1/autofix/"
      )
    ).toBe(120_000);
    expect(
      __resolveRequestTimeoutMsForTests(
        "https://us.sentry.io/api/0/organizations/acme/issues/1/autofix/?run_id=42"
      )
    ).toBe(120_000);
    expect(
      __resolveRequestTimeoutMsForTests(
        "https://us.sentry.io/api/0/organizations/acme/issues/1/autofix"
      )
    ).toBe(120_000);
  });

  test("returns the 30 000 ms default for non-overridden paths", () => {
    expect(
      __resolveRequestTimeoutMsForTests(
        "https://us.sentry.io/api/0/organizations/"
      )
    ).toBe(30_000);
    expect(
      __resolveRequestTimeoutMsForTests(
        "https://us.sentry.io/api/0/issues/1/events/"
      )
    ).toBe(30_000);
    // Substring-only matches must not inherit the override.
    expect(
      __resolveRequestTimeoutMsForTests(
        "https://us.sentry.io/api/0/autofixation-report/"
      )
    ).toBe(30_000);
  });
});
