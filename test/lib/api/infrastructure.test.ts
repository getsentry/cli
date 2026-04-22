import { describe, expect, test } from "bun:test";
import { throwApiError } from "../../../src/lib/api/infrastructure.js";
import { ApiError } from "../../../src/lib/errors.js";

describe("throwApiError", () => {
  test("network failure with Error produces readable message", () => {
    expect(() =>
      throwApiError(
        new TypeError("fetch failed"),
        undefined,
        "Failed to resolve short ID"
      )
    ).toThrow(
      expect.objectContaining({
        message: "Failed to resolve short ID: Network error",
        status: 0,
      })
    );

    try {
      throwApiError(
        new TypeError("fetch failed"),
        undefined,
        "Failed to resolve short ID"
      );
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      const apiError = error as ApiError;
      expect(apiError.detail).toContain("fetch failed");
      expect(apiError.detail).toContain("Unable to reach Sentry API");
      expect(apiError.detail).toContain(
        "Check your internet connection and try again"
      );
    }
  });

  test("network failure with non-Error produces readable message", () => {
    try {
      throwApiError("connection refused", undefined, "Failed to list issues");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      const apiError = error as ApiError;
      expect(apiError.message).toBe("Failed to list issues: Network error");
      expect(apiError.status).toBe(0);
      expect(apiError.detail).toContain("connection refused");
    }
  });

  test("HTTP error with response preserves status and detail", () => {
    const mockResponse = new Response("", {
      status: 400,
      statusText: "Bad Request",
    });

    try {
      throwApiError(
        { detail: "Invalid query syntax" },
        mockResponse,
        "Failed to list issues"
      );
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      const apiError = error as ApiError;
      expect(apiError.message).toBe("Failed to list issues: 400 Bad Request");
      expect(apiError.status).toBe(400);
      expect(apiError.detail).toBe("Invalid query syntax");
    }
  });

  test("HTTP error without detail uses stringified error", () => {
    const mockResponse = new Response("", {
      status: 500,
      statusText: "Internal Server Error",
    });

    try {
      throwApiError("something went wrong", mockResponse, "Failed to fetch");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      const apiError = error as ApiError;
      expect(apiError.message).toBe(
        "Failed to fetch: 500 Internal Server Error"
      );
      expect(apiError.status).toBe(500);
      expect(apiError.detail).toBe("something went wrong");
    }
  });

  test("network failure with ECONNREFUSED-style error", () => {
    const err = new Error("connect ECONNREFUSED 127.0.0.1:443");

    try {
      throwApiError(err, undefined, "Failed to get event");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      const apiError = error as ApiError;
      expect(apiError.message).toBe("Failed to get event: Network error");
      expect(apiError.detail).toContain("ECONNREFUSED");
    }
  });
});
