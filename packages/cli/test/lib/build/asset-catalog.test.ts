/**
 * Tests for the pure-TypeScript `Assets.car` (BOM asset catalog) parser.
 *
 * Fixtures are built in-memory with {@link buildFakeCar}, which assembles a
 * minimal but real BOM container so the parser runs end to end without a
 * committed binary.
 */

import { describe, expect, test } from "vitest";
import {
  type AssetCatalogEntry,
  parseAssetCatalog,
} from "../../../src/lib/build/asset-catalog.js";
import { buildFakeCar, type FakeRendition } from "./car-fixture.js";

const APP_ICON: FakeRendition = {
  name: "AppIcon",
  width: 120,
  height: 120,
  scale: 2,
  pixelFormat: "ARGB",
  payload: 50,
};

const VECTOR_ASSET: FakeRendition = {
  name: "Logo",
  width: 0,
  height: 0,
  scale: 1,
  pixelFormat: "PDF ",
  payload: 200,
};

describe("parseAssetCatalog", () => {
  test("parses renditions with size and geometry", () => {
    const assets = parseAssetCatalog(buildFakeCar([APP_ICON]));
    expect(assets).toHaveLength(1);
    const entry = assets[0] as AssetCatalogEntry;
    expect(entry.name).toBe("AppIcon");
    expect(entry.width).toBe(120);
    expect(entry.height).toBe(120);
    expect(entry.scale).toBe(2);
    expect(entry.vector).toBe(false);
    expect(entry.size).toBe(168 + APP_ICON.payload);
  });

  test("flags vector renditions and nulls absent geometry", () => {
    const assets = parseAssetCatalog(buildFakeCar([VECTOR_ASSET]));
    const entry = assets[0] as AssetCatalogEntry;
    expect(entry.vector).toBe(true);
    expect(entry.width).toBeNull();
    expect(entry.height).toBeNull();
  });

  test("returns entries sorted by name", () => {
    const assets = parseAssetCatalog(buildFakeCar([APP_ICON, VECTOR_ASSET]));
    expect(assets.map((a) => a.name)).toEqual(["AppIcon", "Logo"]);
  });

  test("throws on non-BOM bytes", () => {
    expect(() => parseAssetCatalog(new TextEncoder().encode("carbytes"))).toThrow(
      /BOM|too small/
    );
  });

  test("throws on a truncated file", () => {
    expect(() => parseAssetCatalog(new Uint8Array(4))).toThrow("too small");
  });
});
