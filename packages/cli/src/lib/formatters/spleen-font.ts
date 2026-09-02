/*!
 * Spleen bitmap font subset, version 2.2.0.
 * Copyright (c) 2018-2026, Frederic Cambus
 * https://github.com/fcambus/spleen
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *
 * 1. Redistributions of source code must retain the above copyright notice,
 *    this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright notice,
 *    this list of conditions and the following disclaimer in the documentation
 *    and/or other materials provided with the distribution.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
 * AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
 * ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE
 * LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
 * CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
 * SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
 * INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
 * CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
 * ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
 * POSSIBILITY OF SUCH DAMAGE.
 */

import { Buffer } from "node:buffer";

/** Spleen's native monospaced cell width. */
export const SPLEEN_CELL_WIDTH = 8;

/** Spleen's native monospaced cell height, including descenders. */
export const SPLEEN_CELL_HEIGHT = 16;

const FIRST_ASCII_CODE_POINT = 32;
const LAST_ASCII_CODE_POINT = 126;
const QUESTION_MARK_INDEX = 0x3f - FIRST_ASCII_CODE_POINT;
const DASHBOARD_CODE_POINTS = [
  0x25_80, // ▀
  0x25_84, // ▄
  0x25_00, // ─
  0x25_02, // │
  0x25_14, // └
  0x25_24, // ┤
  0x25_2c, // ┬
  0x20_26, // …
  0x25_91, // ░
  0x25_92, // ▒
  0x25_93, // ▓
  0x25_81, // ▁
  0x25_82, // ▂
  0x25_83, // ▃
  0x25_85, // ▅
  0x25_86, // ▆
  0x25_87, // ▇
  0x25_88, // █
  0x25_a0, // ■
] as const;

const DASHBOARD_GLYPH_INDEX = new Map<number, number>(
  DASHBOARD_CODE_POINTS.map((codePoint, index) => [
    codePoint,
    LAST_ASCII_CODE_POINT - FIRST_ASCII_CODE_POINT + 1 + index,
  ])
);

/**
 * Printable ASCII and glyphs needed by the dashboard's box, sparkline, and
 * text output, generated from Spleen 2.2.0's 8x16 BDF release. Each glyph has
 * 16 rows packed into a byte, with bit 7 as the leftmost pixel. Source commit:
 * 57f9219328c9f5873085320fe8bc8f7dd34b8791. Source BDF SHA-256:
 * b38b32a66920068965a3101f98071d310c5c74659fe86e55d346140770f8f6e8.
 */
const GLYPH_ROWS = Uint8Array.from(
  Buffer.from(
    "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",
    "base64"
  )
);

/** Look up a Spleen glyph by character without parsing or rasterizing a font. */
export function getSpleenGlyph(character: string): Uint8Array {
  const index = getGlyphIndex(character.codePointAt(0));
  const start = (index ?? QUESTION_MARK_INDEX) * SPLEEN_CELL_HEIGHT;
  return GLYPH_ROWS.subarray(start, start + SPLEEN_CELL_HEIGHT);
}

/** Whether the embedded font can represent a character without substitution. */
export function hasSpleenGlyph(character: string): boolean {
  return getGlyphIndex(character.codePointAt(0)) !== undefined;
}

function getGlyphIndex(codePoint: number | undefined): number | undefined {
  if (
    codePoint !== undefined &&
    codePoint >= FIRST_ASCII_CODE_POINT &&
    codePoint <= LAST_ASCII_CODE_POINT
  ) {
    return codePoint - FIRST_ASCII_CODE_POINT;
  }
  return codePoint === undefined
    ? undefined
    : DASHBOARD_GLYPH_INDEX.get(codePoint);
}
