import { MastraClientError } from "@mastra/client-js";
import { afterEach, describe, expect, test, vi } from "vitest";
import { ApiError } from "../../../src/lib/errors.js";
import {
  WORKFLOW_RESUME_ASYNC_ENDPOINT,
  withInitServiceAuthRetry,
} from "../../../src/lib/init/init-service-auth.js";

function serviceError(
  body: Record<string, unknown>,
  status = 503
): MastraClientError {
  return new MastraClientError(
    status,
    "Service Unavailable",
    `HTTP error! status: ${status} - ${JSON.stringify(body)}`,
    body
  );
}

afterEach(() => {
  vi.useRealTimers();
});

describe("withInitServiceAuthRetry", () => {
  test.each([
    "AUTH_UPSTREAM_TIMEOUT",
    "AUTH_UPSTREAM_UNAVAILABLE",
  ])("retries %s once and returns the second result", async (code) => {
    vi.useFakeTimers();
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(serviceError({ code, safeToRetry: true }))
      .mockResolvedValueOnce("ok");
    const onRetry = vi.fn();

    const resultPromise = withInitServiceAuthRetry(
      operation,
      WORKFLOW_RESUME_ASYNC_ENDPOINT,
      onRetry
    );
    await vi.advanceTimersByTimeAsync(250);

    await expect(resultPromise).resolves.toBe("ok");
    expect(operation).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  test("stops after the single retry when the upstream is still unavailable", async () => {
    vi.useFakeTimers();
    const error = serviceError({
      code: "AUTH_UPSTREAM_TIMEOUT",
      safeToRetry: true,
    });
    const operation = vi.fn<() => Promise<string>>().mockRejectedValue(error);

    const resultPromise = withInitServiceAuthRetry(
      operation,
      WORKFLOW_RESUME_ASYNC_ENDPOINT
    );
    const rejection = expect(resultPromise).rejects.toBe(error);
    await vi.advanceTimersByTimeAsync(250);

    await rejection;
    expect(operation).toHaveBeenCalledTimes(2);
  });

  test.each([
    {
      name: "generic 503",
      error: serviceError({ error: "Internal Server Error" }),
    },
    {
      name: "server-declared non-retryable failure",
      error: serviceError({
        code: "AUTH_UPSTREAM_TIMEOUT",
        safeToRetry: false,
      }),
    },
    {
      name: "unknown server code",
      error: serviceError({
        code: "AUTH_UPSTREAM_OTHER",
        safeToRetry: true,
      }),
    },
    {
      name: "recognized code with a non-503 status",
      error: serviceError(
        {
          code: "AUTH_UPSTREAM_TIMEOUT",
          safeToRetry: true,
        },
        500
      ),
    },
    {
      name: "ambiguous network failure",
      error: new TypeError("fetch failed"),
    },
  ])("does not retry a $name", async ({ error }) => {
    const operation = vi.fn<() => Promise<string>>().mockRejectedValue(error);

    await expect(
      withInitServiceAuthRetry(operation, WORKFLOW_RESUME_ASYNC_ENDPOINT)
    ).rejects.toBe(error);
    expect(operation).toHaveBeenCalledTimes(1);
  });

  test("still classifies a 401 without retrying", async () => {
    const operation = vi.fn<() => Promise<string>>().mockRejectedValue(
      serviceError(
        {
          error: "Unauthorized: invalid token",
        },
        401
      )
    );

    const error = await withInitServiceAuthRetry(
      operation,
      WORKFLOW_RESUME_ASYNC_ENDPOINT
    ).catch((caught) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      endpoint: WORKFLOW_RESUME_ASYNC_ENDPOINT,
      status: 401,
    });
    expect(operation).toHaveBeenCalledTimes(1);
  });
});
