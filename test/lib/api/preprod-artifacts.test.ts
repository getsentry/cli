/**
 * Tests for the preprod-artifacts (mobile build) API.
 *
 * Pure URL helpers are tested directly. `getBuildInstallDetails` mocks the
 * region request layer; `downloadBuildArtifact` mocks `customFetch` and the
 * auth-token getter so the streaming write and — critically — the
 * same-origin-only auth attachment can be verified without a network.
 */

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ApiError, ValidationError } from "../../../src/lib/errors.js";

const { customFetchMock, apiRequestToRegionMock, getAuthTokenMock } =
  vi.hoisted(() => ({
    customFetchMock: vi.fn(),
    apiRequestToRegionMock: vi.fn(),
    getAuthTokenMock: vi.fn<() => string | undefined>(() => "secret-token"),
  }));

vi.mock("../../../src/lib/region.js", () => ({
  resolveOrgRegion: vi.fn(async () => "https://us.sentry.io"),
}));
vi.mock("../../../src/lib/api/infrastructure.js", () => ({
  apiRequestToRegion: apiRequestToRegionMock,
}));
vi.mock("../../../src/lib/custom-ca.js", () => ({
  customFetch: customFetchMock,
}));
vi.mock("../../../src/lib/db/auth.js", () => ({
  getAuthToken: getAuthTokenMock,
}));

import {
  buildFormatFromUrl,
  downloadBuildArtifact,
  getBuildInstallDetails,
  toBinaryDownloadUrl,
} from "../../../src/lib/api/preprod-artifacts.js";

describe("toBinaryDownloadUrl", () => {
  test("rewrites a plist manifest URL to fetch the ipa binary", () => {
    expect(
      toBinaryDownloadUrl("https://us.sentry.io/dl/?response_format=plist")
    ).toBe("https://us.sentry.io/dl/?response_format=ipa");
  });

  test("leaves non-plist URLs unchanged", () => {
    expect(
      toBinaryDownloadUrl("https://us.sentry.io/dl/?response_format=apk")
    ).toBe("https://us.sentry.io/dl/?response_format=apk");
  });
});

describe("buildFormatFromUrl", () => {
  test("detects ipa", () => {
    expect(buildFormatFromUrl("https://x/?response_format=ipa")).toBe("ipa");
  });
  test("detects apk", () => {
    expect(buildFormatFromUrl("https://x/?response_format=apk")).toBe("apk");
  });
  test("throws on an unrecognized format", () => {
    expect(() => buildFormatFromUrl("https://x/?response_format=zip")).toThrow(
      ValidationError
    );
  });
});

describe("getBuildInstallDetails", () => {
  beforeEach(() => {
    apiRequestToRegionMock.mockReset();
  });

  test("hits the install-details endpoint and returns parsed data", async () => {
    apiRequestToRegionMock.mockResolvedValue({
      data: { isInstallable: true, installUrl: "https://u/" },
      headers: new Headers(),
    });

    const result = await getBuildInstallDetails("my-org", "build 1");

    expect(result).toEqual({ isInstallable: true, installUrl: "https://u/" });
    const lastCall = apiRequestToRegionMock.mock.calls.at(-1);
    expect(lastCall?.[0]).toBe("https://us.sentry.io");
    // Build id is URL-encoded into the path.
    expect(lastCall?.[1]).toBe(
      "organizations/my-org/preprodartifacts/build%201/install-details/"
    );
    expect(lastCall?.[2]?.schema).toBeDefined();
  });
});

describe("downloadBuildArtifact", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "preprod-dl-"));
    customFetchMock.mockReset();
    getAuthTokenMock.mockReturnValue("secret-token");
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("streams the body to disk and attaches auth for a same-origin URL", async () => {
    customFetchMock.mockResolvedValue(
      new Response("FAKE-BINARY", { status: 200 })
    );
    const dest = join(tmpDir, "out.ipa");

    await downloadBuildArtifact(
      "https://us.sentry.io",
      "https://us.sentry.io/dl/?response_format=ipa",
      dest
    );

    expect(await readFile(dest, "utf8")).toBe("FAKE-BINARY");
    const init = customFetchMock.mock.calls.at(-1)?.[1] as {
      headers: Record<string, string>;
    };
    expect(init.headers.Authorization).toBe("Bearer secret-token");
  });

  test("does NOT attach the auth token to a cross-origin (signed) URL", async () => {
    customFetchMock.mockResolvedValue(new Response("X", { status: 200 }));

    await downloadBuildArtifact(
      "https://us.sentry.io",
      "https://cdn.example.com/blob?response_format=ipa",
      join(tmpDir, "o2.ipa")
    );

    const init = customFetchMock.mock.calls.at(-1)?.[1] as {
      headers: Record<string, string>;
    };
    expect(init.headers.Authorization).toBeUndefined();
  });

  test("omits auth when no token is available", async () => {
    getAuthTokenMock.mockReturnValue(undefined);
    customFetchMock.mockResolvedValue(new Response("X", { status: 200 }));

    await downloadBuildArtifact(
      "https://us.sentry.io",
      "https://us.sentry.io/dl/?response_format=ipa",
      join(tmpDir, "o3.ipa")
    );

    const init = customFetchMock.mock.calls.at(-1)?.[1] as {
      headers: Record<string, string>;
    };
    expect(init.headers.Authorization).toBeUndefined();
  });

  test("throws ApiError on a non-2xx response", async () => {
    customFetchMock.mockResolvedValue(
      new Response("nope", { status: 404, statusText: "Not Found" })
    );

    await expect(
      downloadBuildArtifact(
        "https://us.sentry.io",
        "https://us.sentry.io/dl/?response_format=ipa",
        join(tmpDir, "o4.ipa")
      )
    ).rejects.toThrow(ApiError);
  });
});
