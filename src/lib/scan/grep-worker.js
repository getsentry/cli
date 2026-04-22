/**
 * Grep worker body. Imported as raw text (`with { type: "text" }`)
 * by `worker-pool.ts` and spawned via `Blob` + `URL.createObjectURL`.
 *
 * Kept as plain `.js` (no TS) so it's valid Worker input verbatim
 * with no transpile step. Self-contained: no imports from local
 * modules (the worker's module registry wouldn't have them).
 *
 * ## Protocol
 *
 * Main → Worker: `{ paths, patternSource, flags, maxLineLength,
 *   maxMatchesPerFile, literal }`.
 *
 * Worker → Main:
 * - `{ type: "ready" }` once on startup.
 * - `{ type: "result", ints: Uint32Array, linePool: string }` per
 *   request. `ints.buffer` is transferred (zero-copy); `linePool`
 *   is cloned.
 *
 * ## Match encoding
 *
 * Each match is 4 consecutive `u32`s in `ints`:
 *   [0] pathIdx     index into the input `paths` array
 *   [1] lineNum     1-based line number
 *   [2] lineOffset  character offset into `linePool`
 *   [3] lineLength  character length of the line (post-truncation)
 *
 * Structured-clone of `GrepMatch[]` for 215k matches costs ~200ms.
 * Binary-packed form + shared `linePool` string drops that to
 * ~2–3ms.
 */

const { readFileSync } = require("node:fs");

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: hot regex loop with literal gate + line counter + line-bound extraction + per-file cap is inherently branchy
self.onmessage = (event) => {
  const {
    paths,
    patternSource,
    flags,
    maxLineLength,
    maxMatchesPerFile,
    literal,
  } = event.data;
  const regex = new RegExp(patternSource, flags);
  const ints = [];
  let linePool = "";

  for (let pathIdx = 0; pathIdx < paths.length; pathIdx += 1) {
    const p = paths[pathIdx];
    let content;
    try {
      content = readFileSync(p, "utf-8");
    } catch {
      continue;
    }

    if (literal !== null) {
      const haystack = regex.flags.includes("i")
        ? content.toLowerCase()
        : content;
      if (haystack.indexOf(literal) === -1) {
        continue;
      }
    }

    regex.lastIndex = 0;
    let m = regex.exec(content);
    let lineNum = 1;
    let cursor = 0;
    let fileMatches = 0;

    while (m !== null) {
      const matchIndex = m.index;
      // Advance line counter to the match position via indexOf hops.
      let nl = content.indexOf("\n", cursor);
      while (nl !== -1 && nl < matchIndex) {
        lineNum += 1;
        nl = content.indexOf("\n", nl + 1);
      }
      cursor = matchIndex;

      const lineStart = content.lastIndexOf("\n", matchIndex) + 1;
      const lineEndRaw = content.indexOf("\n", matchIndex);
      const lineEnd = lineEndRaw === -1 ? content.length : lineEndRaw;
      let line = content.slice(lineStart, lineEnd);
      if (line.length > maxLineLength) {
        line = `${line.slice(0, maxLineLength - 1)}\u2026`;
      }

      const lineOffset = linePool.length;
      linePool += line;
      ints.push(pathIdx, lineNum, lineOffset, line.length);

      fileMatches += 1;
      if (fileMatches >= maxMatchesPerFile) {
        break;
      }
      if (lineEndRaw === -1) {
        break;
      }
      regex.lastIndex = lineEnd + 1;
      m = regex.exec(content);
    }
  }

  const packed = new Uint32Array(ints);
  self.postMessage(
    { type: "result", ints: packed, linePool },
    { transfer: [packed.buffer] }
  );
};

self.postMessage({ type: "ready" });
