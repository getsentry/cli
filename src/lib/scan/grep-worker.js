/**
 * Grep worker body. Imported as raw text (`with { type: "text" }`)
 * by `worker-pool.ts` and handed to a `Blob` / `URL.createObjectURL`
 * at runtime to spawn workers.
 *
 * ## Why a plain `.js` file, not a `.ts` one
 *
 * This file is NEVER executed as a module via `import` — it's always
 * loaded as the body of a `new Worker()`. So we need its contents to
 * be valid JS verbatim (no TS syntax). Keeping it `.js` avoids a
 * transpile step and makes the flow obvious: the file you see is
 * exactly what the worker engine parses.
 *
 * ## Why a separate file and not a string in TS
 *
 * Linting, syntax validation, and IDE tooling all work on real files.
 * A previous iteration inlined this as a template literal inside a
 * TS source — but the string was invisible to lint/format/search.
 * `with { type: "text" }` gives us the best of both: the worker is a
 * first-class file at dev time, and a string constant at runtime.
 *
 * ## Why not `new Worker(url)` with a TS file entrypoint
 *
 * Bun's `bun build --compile` docs describe passing the worker TS
 * file as an additional entrypoint. We tested that with our
 * esbuild→Bun compile two-step and all three documented forms
 * (`new Worker("./path.ts")`, `new Worker(new URL(...))`,
 * `new Worker(URL.href)`). The URL forms fail in compiled binaries
 * because `import.meta.url` resolves to the binary path — the
 * bundler doesn't rewrite URLs at compile time. The plain-string
 * form resolves relative to the project root that `bun build` ran
 * from, which works in compiled mode but requires `bun run` / `bun
 * test` to also be invoked from the project root — brittle.
 *
 * The Blob-URL + text-import approach has no such fragility and
 * works identically in dev, `bun test`, and compiled binaries.
 *
 * ## Self-contained
 *
 * - No imports from local modules (they wouldn't be available in
 *   the worker's module registry anyway).
 * - Uses `require("node:fs")` (CJS-style) which Bun exposes to
 *   workers; avoids the top-level await concerns of ESM imports.
 *
 * ## Protocol
 *
 * Main → Worker: `{ paths, patternSource, flags, maxLineLength,
 * maxMatchesPerFile, literal }`
 *
 * Worker → Main:
 * - Once on startup: `{ type: "ready" }`
 * - Per request: `{ type: "result", ints: Uint32Array, linePool: string }`
 *   — `ints.buffer` is transferred (zero-copy); `linePool` is cloned.
 *
 * ## Match encoding
 *
 * Each match is 4 consecutive `u32`s in `ints`:
 *   [0] pathIdx     index into the input `paths` array
 *   [1] lineNum     1-based line number
 *   [2] lineOffset  character offset into `linePool`
 *   [3] lineLength  character length of the line (post-truncation)
 *
 * Structured-clone of `GrepMatch[]` for 215k-match workloads costs
 * ~200ms because the per-match path/line strings get deep-copied.
 * The binary-packed form + single shared `linePool` string drops
 * that to ~2-3ms.
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
  // Packed match data: 4 u32s per match — [pathIdx, lineNum, lineOffset, lineLength]
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

    // File-level literal gate (matches main-thread readAndGrep behavior).
    if (literal !== null) {
      const isCaseInsensitive = regex.flags.includes("i");
      const haystack = isCaseInsensitive ? content.toLowerCase() : content;
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
      // Advance line counter to match position via indexOf hops.
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

      // Append line text to pool, record offset+length
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

  // Pack into Uint32Array with transferable backing buffer.
  const packed = new Uint32Array(ints);
  self.postMessage(
    { type: "result", ints: packed, linePool },
    { transfer: [packed.buffer] }
  );
};

self.postMessage({ type: "ready" });
