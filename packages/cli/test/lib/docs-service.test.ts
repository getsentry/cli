import { describe, expect, test, vi } from "vitest";

const { assertHostedInitServiceAcceptsTokenHost, customFetch, refreshToken } =
  vi.hoisted(() => ({
    assertHostedInitServiceAcceptsTokenHost: vi.fn(),
    customFetch: vi.fn(),
    refreshToken: vi.fn(),
  }));

vi.mock("../../src/lib/custom-ca.js", () => ({ customFetch }));
vi.mock("../../src/lib/db/auth.js", () => ({ refreshToken }));
vi.mock("../../src/lib/init/init-service-auth.js", () => ({
  assertHostedInitServiceAcceptsTokenHost,
}));

import { queryDocs } from "../../src/lib/docs-service.js";

describe("queryDocs", () => {
  test("explains when the service cannot verify a cited answer", async () => {
    refreshToken.mockResolvedValue({ token: "test-token" });
    customFetch.mockResolvedValue({
      ok: false,
      status: 502,
      text: vi.fn().mockResolvedValue(
        JSON.stringify({
          code: "DOCS_UNGROUNDED",
          error: "Sentry documentation answer could not be verified",
        })
      ),
    });

    await expect(
      queryDocs("How do I configure tracing?", {
        frameworks: [],
        languages: [],
        sentryConfigured: false,
      })
    ).rejects.toMatchObject({
      detail:
        "Try rephrasing the question so it can be answered from current Sentry documentation.",
      message: "Could not produce a verified documentation answer.",
      status: 502,
    });
  });
});
