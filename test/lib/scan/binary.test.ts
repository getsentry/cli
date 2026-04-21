/**
 * Unit tests for `src/lib/scan/binary.ts`.
 *
 * Covers the three entry points:
 *   - `isLikelyBinary(head)` — pure NUL-byte sniff on a buffer.
 *   - `classifyByExtension(path, textExtensions)` — O(1) fast path.
 *   - `readHeadAndSniff(path)` — opens a real file and runs both.
 *
 * We also pin a few known limitations as assertions so they don't
 * silently change (UTF-16 misclassified as binary; empty file = text).
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  classifyByExtension,
  isLikelyBinary,
  readHeadAndSniff,
} from "../../../src/lib/scan/binary.js";
import { TEXT_EXTENSIONS } from "../../../src/lib/scan/constants.js";

const TMP = mkdtempSync(join(tmpdir(), "scan-binary-test-"));

afterAll(() => {
  rmSync(TMP, { recursive: true, force: true });
});

describe("isLikelyBinary", () => {
  test("empty buffer is text", () => {
    expect(isLikelyBinary(new Uint8Array(0))).toBe(false);
  });

  test("ASCII text is text", () => {
    const buf = new TextEncoder().encode("hello world\nfoo bar\n");
    expect(isLikelyBinary(buf)).toBe(false);
  });

  test("UTF-8 with CJK is text", () => {
    const buf = new TextEncoder().encode("こんにちは世界\n");
    expect(isLikelyBinary(buf)).toBe(false);
  });

  test("single NUL at offset 0 classifies as binary", () => {
    expect(isLikelyBinary(Uint8Array.of(0, 1, 2, 3))).toBe(true);
  });

  test("NUL byte anywhere in first 8 KB classifies as binary", () => {
    const buf = new Uint8Array(8000);
    buf.fill(0x41); // 'A'
    buf[7999] = 0;
    expect(isLikelyBinary(buf)).toBe(true);
  });

  test("NUL beyond 8 KB is ignored (sniff window bounded)", () => {
    const buf = new Uint8Array(10_000);
    buf.fill(0x41);
    buf[9000] = 0;
    expect(isLikelyBinary(buf)).toBe(false);
  });

  test("documented limitation: UTF-16LE text misclassified as binary", () => {
    // "A" in UTF-16LE is 0x41 0x00 — the 0x00 triggers the sniff.
    const buf = Uint8Array.of(0x41, 0x00, 0x42, 0x00, 0x43, 0x00);
    expect(isLikelyBinary(buf)).toBe(true);
  });
});

describe("classifyByExtension", () => {
  test("known text extensions return {isBinary: false}", () => {
    expect(classifyByExtension("/a/b/c.ts", TEXT_EXTENSIONS)).toEqual({
      isBinary: false,
    });
    expect(classifyByExtension("/a/b/c.JSON", TEXT_EXTENSIONS)).toEqual({
      isBinary: false,
    });
  });

  test("unknown extensions return null (caller must sniff)", () => {
    expect(classifyByExtension("/a/b/c.png", TEXT_EXTENSIONS)).toBeNull();
    expect(classifyByExtension("/a/b/c.bin", TEXT_EXTENSIONS)).toBeNull();
    expect(classifyByExtension("/a/b/c.woff", TEXT_EXTENSIONS)).toBeNull();
  });

  test("no-extension files return null", () => {
    expect(classifyByExtension("/a/b/Makefile", TEXT_EXTENSIONS)).toBeNull();
    expect(
      classifyByExtension("/a/b/.sentryclirc", TEXT_EXTENSIONS)
    ).toBeNull();
  });
});

describe("readHeadAndSniff", () => {
  let textPath: string;
  let binaryPath: string;
  let emptyPath: string;
  let smallPath: string;

  beforeAll(() => {
    textPath = join(TMP, "hello.txt");
    binaryPath = join(TMP, "blob.bin");
    emptyPath = join(TMP, "empty.bin");
    smallPath = join(TMP, "tiny.txt");
    writeFileSync(textPath, "hello world\nfoo bar\nanother line\n", "utf8");
    const bin = new Uint8Array(1024);
    for (let i = 0; i < bin.length; i += 1) {
      bin[i] = 0x41;
    }
    bin[16] = 0; // match the fixture generator convention
    writeFileSync(binaryPath, bin);
    writeFileSync(emptyPath, new Uint8Array(0));
    writeFileSync(smallPath, "ok");
  });

  test("text file classified as text with a non-empty head", async () => {
    const { head, isBinary } = await readHeadAndSniff(textPath);
    expect(isBinary).toBe(false);
    expect(head.length).toBeGreaterThan(0);
  });

  test("binary file classified as binary", async () => {
    const { head, isBinary } = await readHeadAndSniff(binaryPath);
    expect(isBinary).toBe(true);
    expect(head.length).toBe(1024);
  });

  test("empty file sniffs to head.length 0 and is text", async () => {
    const { head, isBinary } = await readHeadAndSniff(emptyPath);
    expect(head.length).toBe(0);
    expect(isBinary).toBe(false);
  });

  test("tiny files yield a correctly-sized head buffer", async () => {
    const { head } = await readHeadAndSniff(smallPath);
    expect(head.length).toBe(2);
  });
});
