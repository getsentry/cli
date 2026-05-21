import { afterEach, beforeEach, describe, expect, test } from "bun:test";
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

  test("non-403 errors do not get enriched", () => {
    const mockResponse = new Response("", {
      status: 404,
      statusText: "Not Found",
    });

    try {
      throwApiError(
        { detail: "Resource not found" },
        mockResponse,
        "Failed to get org"
      );
    } catch (error) {
      const apiError = error as ApiError;
      expect(apiError.enriched403).toBe(false);
      expect(apiError.detail).toBe("Resource not found");
    }
  });

  describe("403 enrichment", () => {
    // Test preload sets SENTRY_AUTH_TOKEN, so isEnvTokenActive() returns true
    // by default in these tests.

    test("does not suggest token scopes for org-policy disabled-feature 403s", () => {
      const mockResponse = new Response("", {
        status: 403,
        statusText: "Forbidden",
      });

      try {
        throwApiError(
          {
            detail: "Your organization has disabled this feature for members.",
          },
          mockResponse,
          "Failed to create project"
        );
      } catch (error) {
        const apiError = error as ApiError;
        expect(apiError.enriched403).toBe(true);
        expect(apiError.detail).toContain("disabled this feature");
        expect(apiError.detail).toContain("org-level policy");
        expect(apiError.detail).not.toContain("SENTRY_AUTH_TOKEN");
      }
    });

    test("enriches 403 with env-var token hints", () => {
      const mockResponse = new Response("", {
        status: 403,
        statusText: "Forbidden",
      });

      try {
        throwApiError(
          { detail: "You do not have permission to perform this action." },
          mockResponse,
          "Failed to get organization"
        );
      } catch (error) {
        const apiError = error as ApiError;
        expect(apiError.enriched403).toBe(true);
        expect(apiError.status).toBe(403);
        expect(apiError.detail).toContain(
          "You do not have permission to perform this action."
        );
        expect(apiError.detail).toContain("SENTRY_AUTH_TOKEN");
        expect(apiError.detail).toContain(
          "https://sentry.io/settings/account/api/auth-tokens/"
        );
      }
    });

    test("extracts specific scope names when present in detail", () => {
      const mockResponse = new Response("", {
        status: 403,
        statusText: "Forbidden",
      });

      try {
        throwApiError(
          {
            detail:
              "You do not have permission. Required scope: org:read, project:read",
          },
          mockResponse,
          "Failed to list issues"
        );
      } catch (error) {
        const apiError = error as ApiError;
        expect(apiError.enriched403).toBe(true);
        expect(apiError.detail).toContain(
          "missing the required scope(s) 'org:read', 'project:read'"
        );
      }
    });

    test("uses generic scope hint when no scope names in detail", () => {
      const mockResponse = new Response("", {
        status: 403,
        statusText: "Forbidden",
      });

      try {
        throwApiError(
          { detail: "You do not have permission to perform this action." },
          mockResponse,
          "Failed to get organization"
        );
      } catch (error) {
        const apiError = error as ApiError;
        expect(apiError.detail).toContain(
          "may lack the required scope for this operation"
        );
      }
    });

    test("handles undefined detail without producing noise", () => {
      const mockResponse = new Response("", {
        status: 403,
        statusText: "Forbidden",
      });

      try {
        throwApiError(
          { detail: undefined },
          mockResponse,
          "Failed to get organization"
        );
      } catch (error) {
        const apiError = error as ApiError;
        expect(apiError.enriched403).toBe(true);
        // Should contain enrichment hints
        expect(apiError.detail).toContain("SENTRY_AUTH_TOKEN");
        // Should NOT contain noisy fallback strings
        expect(apiError.detail).not.toMatch(/^undefined/);
        expect(apiError.detail).not.toContain("{}");
      }
    });

    test("handles null detail without producing noise", () => {
      const mockResponse = new Response("", {
        status: 403,
        statusText: "Forbidden",
      });

      try {
        throwApiError(
          { detail: null },
          mockResponse,
          "Failed to get organization"
        );
      } catch (error) {
        const apiError = error as ApiError;
        expect(apiError.enriched403).toBe(true);
        expect(apiError.detail).toContain("SENTRY_AUTH_TOKEN");
        // Should NOT contain noisy fallback strings
        expect(apiError.detail).not.toMatch(/^null/);
        expect(apiError.detail).not.toContain('{"detail":null}');
      }
    });

    describe("with OAuth token (no env var)", () => {
      let savedAuthToken: string | undefined;
      let savedToken: string | undefined;

      beforeEach(() => {
        savedAuthToken = process.env.SENTRY_AUTH_TOKEN;
        savedToken = process.env.SENTRY_TOKEN;
        delete process.env.SENTRY_AUTH_TOKEN;
        delete process.env.SENTRY_TOKEN;
      });

      afterEach(() => {
        if (savedAuthToken !== undefined) {
          process.env.SENTRY_AUTH_TOKEN = savedAuthToken;
        } else {
          delete process.env.SENTRY_AUTH_TOKEN;
        }
        if (savedToken !== undefined) {
          process.env.SENTRY_TOKEN = savedToken;
        } else {
          delete process.env.SENTRY_TOKEN;
        }
      });

      test("does not suggest re-authentication for org-policy disabled-feature 403s", () => {
        const mockResponse = new Response("", {
          status: 403,
          statusText: "Forbidden",
        });

        try {
          throwApiError(
            {
              detail:
                "Your organization has disabled this feature for members.",
            },
            mockResponse,
            "Failed to create project"
          );
        } catch (error) {
          const apiError = error as ApiError;
          expect(apiError.enriched403).toBe(true);
          expect(apiError.detail).toContain("disabled this feature");
          expect(apiError.detail).toContain("org-level policy");
          expect(apiError.detail).not.toContain("Re-authenticate");
          expect(apiError.detail).not.toContain("sentry auth login");
        }
      });

      test("suggests re-authentication for OAuth tokens", () => {
        const mockResponse = new Response("", {
          status: 403,
          statusText: "Forbidden",
        });

        try {
          throwApiError(
            {
              detail: "You do not have permission to perform this action.",
            },
            mockResponse,
            "Failed to get organization"
          );
        } catch (error) {
          const apiError = error as ApiError;
          expect(apiError.enriched403).toBe(true);
          expect(apiError.detail).toContain(
            "You may not have access to this resource."
          );
          expect(apiError.detail).toContain("sentry auth login");
          // Should NOT mention SENTRY_AUTH_TOKEN
          expect(apiError.detail).not.toContain("SENTRY_AUTH_TOKEN");
        }
      });
    });
  });

  describe("401 enrichment", () => {
    // Test preload sets SENTRY_AUTH_TOKEN, so isEnvTokenActive() returns true
    // by default in these tests.

    test("uses 'not recognized or has been revoked' for invalid token", () => {
      const mockResponse = new Response("", {
        status: 401,
        statusText: "Unauthorized",
      });

      try {
        throwApiError(
          { detail: "Invalid token" },
          mockResponse,
          "Failed to list organizations"
        );
      } catch (error) {
        const apiError = error as ApiError;
        expect(apiError.status).toBe(401);
        expect(apiError.message).toBe(
          "Failed to list organizations: 401 Unauthorized"
        );
        expect(apiError.detail).toContain("Invalid token");
        expect(apiError.detail).toContain("SENTRY_AUTH_TOKEN");
        expect(apiError.detail).toContain("not recognized or has been revoked");
        expect(apiError.detail).toContain(
          "https://sentry.io/settings/account/api/auth-tokens/"
        );
      }
    });

    test("uses 'has expired' for Token expired detail", () => {
      const mockResponse = new Response("", {
        status: 401,
        statusText: "Unauthorized",
      });

      try {
        throwApiError(
          { detail: "Token expired" },
          mockResponse,
          "Failed to list organizations"
        );
      } catch (error) {
        const apiError = error as ApiError;
        expect(apiError.status).toBe(401);
        expect(apiError.detail).toContain("Token expired");
        expect(apiError.detail).toContain("SENTRY_AUTH_TOKEN");
        expect(apiError.detail).toContain("has expired");
        expect(apiError.detail).not.toContain("not recognized");
        expect(apiError.detail).toContain(
          "https://sentry.io/settings/account/api/auth-tokens/"
        );
      }
    });

    test("falls back to 'not recognized' when detail is absent", () => {
      const mockResponse = new Response("", {
        status: 401,
        statusText: "Unauthorized",
      });

      try {
        throwApiError(
          { detail: undefined },
          mockResponse,
          "Failed to list organizations"
        );
      } catch (error) {
        const apiError = error as ApiError;
        expect(apiError.status).toBe(401);
        expect(apiError.detail).toContain("SENTRY_AUTH_TOKEN");
        expect(apiError.detail).toContain("not recognized or has been revoked");
        expect(apiError.detail).not.toMatch(/^undefined/);
        expect(apiError.detail).not.toContain("{}");
      }
    });

    describe("with OAuth token (no env var)", () => {
      let savedAuthToken: string | undefined;
      let savedToken: string | undefined;

      beforeEach(() => {
        savedAuthToken = process.env.SENTRY_AUTH_TOKEN;
        savedToken = process.env.SENTRY_TOKEN;
        delete process.env.SENTRY_AUTH_TOKEN;
        delete process.env.SENTRY_TOKEN;
      });

      afterEach(() => {
        if (savedAuthToken !== undefined) {
          process.env.SENTRY_AUTH_TOKEN = savedAuthToken;
        } else {
          delete process.env.SENTRY_AUTH_TOKEN;
        }
        if (savedToken !== undefined) {
          process.env.SENTRY_TOKEN = savedToken;
        } else {
          delete process.env.SENTRY_TOKEN;
        }
      });

      test("suggests re-authentication for OAuth tokens", () => {
        const mockResponse = new Response("", {
          status: 401,
          statusText: "Unauthorized",
        });

        try {
          throwApiError(
            { detail: "Authentication credentials were not provided." },
            mockResponse,
            "Failed to list organizations"
          );
        } catch (error) {
          const apiError = error as ApiError;
          expect(apiError.status).toBe(401);
          expect(apiError.detail).toContain("session has expired");
          expect(apiError.detail).toContain("sentry auth login");
          // Should NOT mention SENTRY_AUTH_TOKEN
          expect(apiError.detail).not.toContain("SENTRY_AUTH_TOKEN");
        }
      });
    });
  });
});
