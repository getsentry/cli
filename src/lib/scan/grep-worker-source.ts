/**
 * Inline source for the grep worker, delivered to `new Worker()` via
 * `Blob` + `URL.createObjectURL`.
 *
 * Why inline-as-string and not a separate `.ts` file?
 *
 * - `bun build --compile` (our single-file CLI binary) can't resolve
 *   `new Worker(new URL("./file.ts", import.meta.url).href)` at
 *   runtime — the worker URL points to a source that's not part of
 *   the compiled binary's module map. The worker spawn hangs.
 *
 * - A Blob URL sidesteps that: we construct the worker source at
 *   runtime from a string bundled into the main module, so there's
 *   no runtime file resolution.
 *
 * The worker is deliberately self-contained:
 *
 * - No imports from local modules (those wouldn't be available in
 *   the worker's module registry anyway).
 * - Uses `require("node:fs")` (CJS-style) inside the worker function
 *   because Bun and Node both expose `node:fs` to workers via
 *   `require` and `import`, but the CJS form avoids top-level
 *   await parsing issues in the string template.
 *
 * The worker receives a batch of file paths, a regex pattern, and
 * options. It reads each file synchronously (fast in-process),
 * runs the regex, and returns matches packed as a `Uint32Array` +
 * a single `linePool` string. The caller then re-hydrates
 * `GrepMatch` objects from the packed data — this avoids the
 * structured-clone cost of ~216ms that a plain `GrepMatch[]`
 * would incur for typical large-result workloads.
 *
 * Match encoding — each match is 4 consecutive `u32`s in `ints`:
 *   [0] pathIdx     index into the input `paths` array
 *   [1] lineNum     1-based line number
 *   [2] lineOffset  character offset into `linePool`
 *   [3] lineLength  character length of the line (post-truncation)
 */

/**
 * Worker source. Injected into a `Blob` at runtime.
 *
 * Kept as plain JS (not TS) so it can be embedded verbatim without
 * a compile step inside the worker.
 */
export const GREP_WORKER_SOURCE = `
const { readFileSync } = require("node:fs");

self.onmessage = (event) => {
  const { paths, patternSource, flags, maxLineLength, maxMatchesPerFile, literal } = event.data;
  const regex = new RegExp(patternSource, flags);
  // Packed match data: 4 u32s per match — [pathIdx, lineNum, lineOffset, lineLength]
  const ints = [];
  let linePool = "";

  for (let pathIdx = 0; pathIdx < paths.length; pathIdx++) {
    const p = paths[pathIdx];
    let content;
    try {
      content = readFileSync(p, "utf-8");
    } catch {
      continue;
    }

    // File-level literal gate (matches main-thread readAndGrep behavior).
    if (literal !== null) {
      const isCaseInsensitive = regex.flags.includes("i");
      const haystack = isCaseInsensitive ? content.toLowerCase() : content;
      if (haystack.indexOf(literal) === -1) continue;
    }

    regex.lastIndex = 0;
    let m = regex.exec(content);
    let lineNum = 1;
    let cursor = 0;
    let fileMatches = 0;

    while (m !== null) {
      const matchIndex = m.index;
      // Advance line counter to match position via indexOf hops.
      let nl = content.indexOf("\\n", cursor);
      while (nl !== -1 && nl < matchIndex) {
        lineNum++;
        nl = content.indexOf("\\n", nl + 1);
      }
      cursor = matchIndex;

      const lineStart = content.lastIndexOf("\\n", matchIndex) + 1;
      const lineEndRaw = content.indexOf("\\n", matchIndex);
      const lineEnd = lineEndRaw === -1 ? content.length : lineEndRaw;
      let line = content.slice(lineStart, lineEnd);
      if (line.length > maxLineLength) {
        line = line.slice(0, maxLineLength - 1) + "\\u2026";
      }

      // Append line text to pool, record offset+length
      const lineOffset = linePool.length;
      linePool += line;
      ints.push(pathIdx, lineNum, lineOffset, line.length);

      fileMatches++;
      if (fileMatches >= maxMatchesPerFile) break;
      if (lineEndRaw === -1) break;
      regex.lastIndex = lineEnd + 1;
      m = regex.exec(content);
    }
  }

  // Pack into Uint32Array with transferable backing buffer.
  const packed = new Uint32Array(ints);
  self.postMessage(
    { type: "result", ints: packed, linePool },
    { transfer: [packed.buffer] }
  );
};

self.postMessage({ type: "ready" });
`;
