# Twinkleplop Terminal Code Highlighting Evaluation

## Goal

Evaluate whether [Twinkleplop](https://twinkleplop.pngwn.at) is a viable
replacement for `cli-highlight` in the CLI's terminal Markdown code-block
renderer. This tracks a suitability evaluation only — it does not commit the
project to a replacement.

## Summary

Twinkleplop is not currently a drop-in replacement for `cli-highlight` in the
terminal renderer. The two libraries solve different problems: `cli-highlight`
renders highlight.js output directly to ANSI, while Twinkleplop is a
browser/web-oriented highlighter that emits HTML or flat token spans, with no
terminal (ANSI) rendering API. Its published benchmarks compare against Shiki
and Prism, neither of which we use, and omit highlight.js entirely — so the
advertised speedups do not establish a benefit for this code path. Adopting
Twinkleplop would require us to build and maintain a token-span-to-ANSI mapping
layer, and would not reduce the highlight.js footprint unless it also displaces
that dependency's language grammars. No terminal performance comparison has been
run because Twinkleplop is not resolvable from the npm registry, so a benchmark
cannot be produced here. The recommendation is to keep `cli-highlight` and defer
any migration until Twinkleplop ships a terminal-rendering API and a
highlight.js-inclusive benchmark.

## Current Implementation

The terminal Markdown renderer highlights fenced code blocks through a single
choke point in `packages/cli/src/lib/formatters/markdown.ts`:

- `highlightCode(code, language?)` (around line 239) calls
  `cliHighlight(code, { language, ignoreIllegals: true })` and falls back to a
  uniform `chalk.hex(COLORS.yellow)` block if highlighting throws (unknown
  language, parse failure).
- `renderBlocks()`'s `case "code"` (around line 422) invokes `highlightCode`
  with the fence's `lang`, then indents each output line by two spaces.
- Plain / `NO_COLOR` handling is centralized in `renderMarkdown()` (around line
  549): in plain mode the tokens are still rendered and then run through
  `stripAnsi(...)`. Code blocks are not special-cased for plain output; their
  ANSI is simply stripped after the fact. (Inline code spans are handled
  separately in `renderCodespan` and guard `isPlainOutput()` directly.)

Dependency facts (from `packages/cli/package.json` and `pnpm-lock.yaml`):

- `cli-highlight` is a direct devDependency at `^2.1.11`.
- `cli-highlight@2.1.11` pulls in `highlight.js@10.7.3`, plus `chalk@4.1.2`,
  `parse5@5.1.1`, `parse5-htmlparser2-tree-adapter@6.0.1`, `mz`, and `yargs`.
  The parse5 chain exists because `cli-highlight` renders highlight.js HTML and
  parses it back into ANSI.
- The renderer module docstring already notes this replaced `marked-terminal`
  specifically to shed a ~970KB dependency chain (`cli-highlight`, `node-emoji`,
  `cli-table3`, `parse5`), so dependency weight is an existing, tracked concern.

SQL formatting (`packages/cli/src/lib/formatters/sql.ts`) is explicitly out of
scope. It uses `@sentry/sqlish` (`SQLishParser` plus the `string` formatter) for
tolerant parsing, parameter recognition (`%s`, `$1`, `?`), structural
pretty-printing, and per-token ANSI coloring — capabilities a general syntax
highlighter does not provide. Twinkleplop is not a candidate for that path.

## Evaluation Concerns

### 1. Terminal rendering API (blocking)

`cli-highlight` produces ANSI directly, which is exactly what
`renderBlocks()` needs. Twinkleplop's documented surface exposes HTML output and
a flat token/`tokenize` API (token spans), not ANSI. There is no terminal
renderer. Using it would require a new adapter that maps Twinkleplop's token
types to the project's `chalk`/`COLORS` palette and emits ANSI — new code we
would own and maintain, including keeping the token-type-to-color mapping in
sync with Twinkleplop upgrades. This is the primary gap.

### 2. Benchmark relevance

Twinkleplop's [published benchmarks](https://twinkleplop.pngwn.at/docs/benchmarks)
compare against Shiki and Prism. The CLI uses neither; it uses highlight.js via
`cli-highlight`. highlight.js is absent from that comparison, so the advertised
speedups say nothing about the code path we would change. A meaningful decision
needs a direct terminal comparison against the current `cli-highlight` path.

### 3. No terminal performance comparison run

A direct comparison (startup time, packaged binary size, ANSI output parity,
language coverage/autodetection, plain/`NO_COLOR` behavior) has not been
executed. Twinkleplop is not resolvable from the public npm registry
(`npm view twinkleplop` returns 404), so it cannot be installed and benchmarked
in this environment. Until it is installable, the performance and size questions
remain open and cannot be answered empirically.

### 4. Packaged size

Any size benefit depends on whether Twinkleplop displaces highlight.js and its
`parse5` HTML round-trip, not merely sits alongside them. If a Twinkleplop-based
terminal path still needs highlight.js grammars for coverage, the footprint does
not shrink and may grow. Binary size is a live concern for this project (see the
binary-composition notes in `.lore.md`), so a migration that does not
demonstrably reduce the bundled highlighter footprint has weak justification.

### 5. Language coverage and autodetection

`highlightCode` passes the fence language through and relies on highlight.js
autodetection/`ignoreIllegals` for unknown or malformed input, with a yellow
fallback. Any replacement must match or exceed that coverage and degrade just as
gracefully; a regression here would visibly affect `sentry`'s Markdown output
(help text, docs rendering) across many languages.

### 6. Plain / NO_COLOR parity

The current design leans on post-hoc `stripAnsi()` in `renderMarkdown()` for
plain mode. A replacement must produce ANSI that `stripAnsi` fully removes (no
stray escape sequences or non-ANSI styling), or it must be taught to emit plain
text directly. This is straightforward to satisfy but must be verified, because
plain-output correctness is a strict contract for the CLI (piping, `NO_COLOR`,
`SENTRY_PLAIN_OUTPUT`).

## Findings

| Concern | cli-highlight (current) | Twinkleplop |
| --- | --- | --- |
| Terminal (ANSI) API | Native — renders ANSI directly | None — HTML or flat token spans only; needs a custom ANSI adapter |
| Benchmark relevance | N/A (incumbent) | Compares vs Shiki/Prism; highlight.js not included |
| Terminal perf comparison | Baseline | Not run — package not on npm registry |
| Packaged size | Known chain (highlight.js + parse5) | Unproven; no benefit unless it displaces highlight.js |
| Language coverage / autodetect | highlight.js grammars + `ignoreIllegals` fallback | Unverified for terminal use |
| Plain / NO_COLOR | Works via post-hoc `stripAnsi` | Must be validated |

## Recommendation

Do not migrate at this time. Keep `cli-highlight` for terminal Markdown code
blocks. Revisit only if Twinkleplop (a) ships a terminal/ANSI rendering API so
we are not maintaining a bespoke token-to-ANSI adapter, (b) publishes a
highlight.js-inclusive benchmark that isolates the code path we would change,
and (c) becomes installable so an actual comparison of startup, packaged size,
ANSI output, language coverage, and plain/`NO_COLOR` behavior can be run against
the current implementation. If a future effort targets the highlighter footprint
instead, evaluate it against the already-tracked ~970KB dependency-chain concern
rather than against Twinkleplop's web-oriented benchmarks.

## Scope Notes

- SQL formatting (`sql.ts`, `@sentry/sqlish`) is out of scope: it provides
  tolerant parsing, parameter recognition, and structural formatting beyond
  coloring, and is not comparable to a general syntax highlighter.
- This document records an evaluation only. No code, dependencies, or CI
  configuration are changed by it.
