/**
 * Runtime image → sixel encoder tests.
 *
 * Exercises format detection (magic bytes + Content-Type fallback), PNG/JPEG
 * decoding, median-cut palette construction, nearest-neighbor downscaling, and
 * the shape of the emitted sixel escape sequence. Real terminal I/O is not
 * involved — everything here is pure and deterministic.
 */

import { encode as encodeJpeg } from "jpeg-js";
import { PNG } from "pngjs";
import { describe, expect, test } from "vitest";
import {
  buildPalette,
  type DecodedImage,
  decodeImage,
  detectImageFormat,
  downscale,
  encodeImageToSixel,
  imageBytesToSixel,
} from "../../src/lib/sixel-image.js";

const ESC = "\x1b";

/** Build a solid-color RGBA image of the given size. */
function solidImage(
  width: number,
  height: number,
  rgba: [number, number, number, number]
): DecodedImage {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = rgba[0];
    data[i * 4 + 1] = rgba[1];
    data[i * 4 + 2] = rgba[2];
    data[i * 4 + 3] = rgba[3];
  }
  return { width, height, data };
}

/** Encode an RGBA DecodedImage as PNG bytes. */
function toPngBytes(img: DecodedImage): Uint8Array {
  const png = new PNG({ width: img.width, height: img.height });
  png.data = Buffer.from(img.data);
  return new Uint8Array(PNG.sync.write(png));
}

/** Encode an RGB(A) DecodedImage as JPEG bytes. */
function toJpegBytes(img: DecodedImage): Uint8Array {
  const { data } = encodeJpeg(
    { data: Buffer.from(img.data), width: img.width, height: img.height },
    90
  );
  return new Uint8Array(data);
}

describe("detectImageFormat", () => {
  test("detects PNG from magic bytes", () => {
    const png = toPngBytes(solidImage(2, 2, [255, 0, 0, 255]));
    expect(detectImageFormat(png)).toBe("png");
  });

  test("detects JPEG from magic bytes", () => {
    const jpeg = toJpegBytes(solidImage(4, 4, [0, 128, 0, 255]));
    expect(detectImageFormat(jpeg)).toBe("jpeg");
  });

  test("magic bytes win over a mislabeled Content-Type", () => {
    const png = toPngBytes(solidImage(2, 2, [0, 0, 255, 255]));
    expect(detectImageFormat(png, "application/octet-stream")).toBe("png");
  });

  test("falls back to Content-Type when bytes are inconclusive", () => {
    const notAnImage = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(detectImageFormat(notAnImage, "image/png")).toBe("png");
    expect(detectImageFormat(notAnImage, "image/jpeg")).toBe("jpeg");
  });

  test("returns undefined for unsupported input", () => {
    const notAnImage = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(detectImageFormat(notAnImage)).toBeUndefined();
    expect(detectImageFormat(notAnImage, "image/gif")).toBeUndefined();
  });
});

describe("decodeImage", () => {
  test("round-trips a PNG to RGBA pixels", () => {
    const src = solidImage(3, 2, [10, 20, 30, 255]);
    const decoded = decodeImage(toPngBytes(src), "png");
    expect(decoded).toBeDefined();
    expect(decoded?.width).toBe(3);
    expect(decoded?.height).toBe(2);
    expect(decoded?.data[0]).toBe(10);
    expect(decoded?.data[1]).toBe(20);
    expect(decoded?.data[2]).toBe(30);
  });

  test("returns undefined for corrupt bytes", () => {
    const garbage = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]);
    expect(decodeImage(garbage, "png")).toBeUndefined();
  });
});

describe("downscale", () => {
  test("returns the source unchanged when already within maxWidth", () => {
    const img = solidImage(10, 5, [1, 2, 3, 255]);
    expect(downscale(img, 20)).toBe(img);
  });

  test("scales width down and height proportionally", () => {
    const img = solidImage(100, 50, [1, 2, 3, 255]);
    const out = downscale(img, 20);
    expect(out.width).toBe(20);
    expect(out.height).toBe(10);
  });
});

describe("buildPalette", () => {
  test("skips fully transparent pixels", () => {
    const img = solidImage(4, 4, [255, 0, 0, 0]);
    expect(buildPalette(img, 16)).toEqual([]);
  });

  test("produces a single entry for a solid opaque image", () => {
    const img = solidImage(4, 4, [128, 64, 32, 255]);
    const palette = buildPalette(img, 16);
    expect(palette.length).toBe(1);
    expect(palette[0]).toEqual([128, 64, 32]);
  });

  test("never exceeds the requested size", () => {
    // A gradient with many distinct colors.
    const width = 32;
    const height = 1;
    const data = new Uint8Array(width * height * 4);
    for (let x = 0; x < width; x++) {
      data[x * 4] = x * 8;
      data[x * 4 + 1] = 255 - x * 8;
      data[x * 4 + 2] = 100;
      data[x * 4 + 3] = 255;
    }
    const palette = buildPalette({ width, height, data }, 8);
    expect(palette.length).toBeLessThanOrEqual(8);
    expect(palette.length).toBeGreaterThan(0);
  });
});

describe("encodeImageToSixel", () => {
  test("emits a well-formed DCS sixel payload", () => {
    const img = solidImage(6, 6, [200, 100, 50, 255]);
    const sixel = encodeImageToSixel(img);
    expect(sixel).toBeDefined();
    expect(sixel?.startsWith(`${ESC}P0;1;0q`)).toBe(true);
    expect(sixel?.endsWith(`${ESC}\\`)).toBe(true);
    // Raster attributes reserve the pixel box.
    expect(sixel).toContain('"1;1;6;6');
    // At least one palette definition and one color-plane selector.
    expect(sixel).toContain("#0;2;");
  });

  test("returns undefined when the image is fully transparent", () => {
    const img = solidImage(4, 4, [255, 255, 255, 0]);
    expect(encodeImageToSixel(img)).toBeUndefined();
  });
});

describe("imageBytesToSixel", () => {
  test("decodes and encodes a PNG in one step", () => {
    const png = toPngBytes(solidImage(8, 8, [0, 150, 255, 255]));
    const sixel = imageBytesToSixel(png, "image/png");
    expect(sixel).toBeDefined();
    expect(sixel?.startsWith(`${ESC}P`)).toBe(true);
    expect(sixel?.endsWith(`${ESC}\\`)).toBe(true);
  });

  test("returns undefined for unsupported bytes", () => {
    const notAnImage = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(imageBytesToSixel(notAnImage, "text/plain")).toBeUndefined();
  });
});
