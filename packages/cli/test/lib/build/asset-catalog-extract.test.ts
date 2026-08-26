/**
 * Tests for the native `Assets.car` pixel-extraction glue.
 *
 * The real decoder is a macOS-only CoreUI helper (compiled for darwin-arm64 and
 * embedded as a SEA asset), so these tests cover the platform guard and the
 * non-fatal fallback contract — the behavior every non-macOS-arm64 runner and
 * every helper failure must exhibit. The decoder itself is exercised on the
 * darwin-arm64 CI runner, not here.
 */

import { describe, expect, test, vi } from "vitest";
import { extractAssetCatalogImages } from "../../../src/lib/build/asset-catalog-extract.js";

describe("extractAssetCatalogImages", () => {
  test("returns null on non-macOS-arm64 platforms", () => {
    const platform = vi
      .spyOn(process, "platform", "get")
      .mockReturnValue("linux");
    try {
      expect(
        extractAssetCatalogImages("MyApp.app/Assets.car", new Uint8Array([1, 2]))
      ).toBeNull();
    } finally {
      platform.mockRestore();
    }
  });

  test("returns null on macOS x64 (extraction is arm64-only)", () => {
    const platform = vi
      .spyOn(process, "platform", "get")
      .mockReturnValue("darwin");
    const arch = vi.spyOn(process, "arch", "get").mockReturnValue("x64");
    try {
      expect(
        extractAssetCatalogImages("Assets.car", new Uint8Array([1, 2]))
      ).toBeNull();
    } finally {
      platform.mockRestore();
      arch.mockRestore();
    }
  });

  test("returns null (never throws) when no helper is available", () => {
    // On a darwin-arm64 dev box without the compiled helper, extraction must
    // degrade to the size-only manifest rather than fail the upload.
    const platform = vi
      .spyOn(process, "platform", "get")
      .mockReturnValue("darwin");
    const arch = vi.spyOn(process, "arch", "get").mockReturnValue("arm64");
    try {
      expect(() =>
        extractAssetCatalogImages("Assets.car", new Uint8Array([1, 2]))
      ).not.toThrow();
    } finally {
      platform.mockRestore();
      arch.mockRestore();
    }
  });
});
