# Feasibility: sixel for `dashboard view` rendering

Status: investigation / not scheduled
Issue: getsentry/cli#1231

## Question

Can `sentry dashboard view` use [sixel](https://en.wikipedia.org/wiki/Sixel)
(or a similar terminal-graphics protocol) for denser visuals — heatmaps,
multi-series charts, wheels — while keeping a plain-text fallback for terminals
that can't render graphics?

## TL;DR

Yes, and most of the hard parts are already built. The CLI already ships a
sixel capability probe (`src/lib/sixel.ts`) and a runtime PNG/JPEG→sixel encoder
(`src/lib/sixel-image.ts`), and already renders arbitrary images inline in
`sentry api`. A dashboard integration reuses that machinery: detect capability →
rasterize a widget to pixels → encode → emit, with the existing character
framebuffer (`src/lib/formatters/dashboard.ts`) as the fallback path. The real
cost is not detection or encoding; it's producing a raster (a chart-drawing
step) and fitting pixel images into a layout that is currently measured in
character cells. Recommendation: opt-in first (`--graphics=sixel`), auto-detect
later once the raster path is proven, and scope the first cut to a single widget
type (timeseries) rather than the whole grid.

## What already exists

The building blocks the issue assumes are missing are, for the most part,
present:

- **Capability detection** — `src/lib/sixel.ts`
  - `canRenderSixel()` — true only on an interactive unix TTY that advertised
    sixel in its Primary Device Attributes (DA1 attribute `4`), isn't opted out
    (`SENTRY_NO_SIXEL`, `NO_COLOR`, `SENTRY_PLAIN_OUTPUT`, `TERM=dumb`), and
    isn't Windows (the probe is unix-only today).
  - `detectSixelCaps()` — cached per-process probe returning `{ supported,
    cellWidth?, cellHeight? }`. The cell size comes from `CSI 16 t` and is what
    lets us convert between character cells and device pixels.
  - `terminalPixelWidth(columns?)` — usable image width in device pixels
    (`columns * cellWidth`), or `undefined` when the terminal didn't report a
    cell size (caller must fall back).
  - The probe is synchronous, best-effort, times out (~300ms), restores tty
    state, reads a dedicated `/dev/tty` fd, and never throws.

- **Runtime image encoding** — `src/lib/sixel-image.ts`
  - `imageBytesToSixel(body, contentType?, maxWidth?)` decodes PNG/JPEG (via the
    already-bundled `pngjs` / `jpeg-js`, both pure-JS so they work in the SEA
    binary), quantizes to a 128-color palette via median cut, downscales
    (nearest-neighbor, capped at 800×2000 px by default), and emits the sixel
    escape sequence. Fully-transparent pixels are left undrawn.
  - `encodeImageToSixel(decoded, maxWidth?)` if we already hold raw RGBA.

- **A working precedent** — `src/commands/api.ts` (`resolveBinaryTtyOutput`)
  gates on `canRenderSixel()`, caps to `terminalPixelWidth()`, and emits sixel
  for image attachments — otherwise it warns and falls through to raw bytes.
  This is the exact pattern a dashboard renderer would follow.

- **Plain-output discipline** — `src/lib/formatters/plain-detect.ts`
  (`isPlainOutput()`) and the env registry (`src/lib/env-registry.ts`, which
  already documents `SENTRY_NO_SIXEL`) give a single, consistent set of gates.

So the missing piece is not "can the terminal do sixel" or "how do we turn
pixels into sixel bytes" — both are solved. The missing piece is **producing the
pixels for a chart** and **placing a pixel image inside the grid**.

## How dashboards render today

`src/lib/formatters/dashboard.ts` composes a virtual character framebuffer:

- The dashboard is a 6-column grid (`GRID_COLS = 6`) with `LINES_PER_UNIT = 6`
  terminal rows per layout unit. Widget position/size come from
  `widget.layout.{x,y,w,h}`.
- Two-stage render: `renderContentLines()` dispatches per data type
  (`TimeseriesResult`, `TableResult`, `ScalarResult`, text, …) to produce the
  inner content lines; `renderWidgetLines()` wraps each widget in a
  border/title box of exactly `layout.h * LINES_PER_UNIT` lines.
- `renderGrid()` composes all widgets into terminal rows, computing each
  widget's column span with `startCol = floor((layout.x / GRID_COLS) *
  termWidth)` and clipping with the ANSI-aware `fitToWidth()`.
- Charts today are Unicode: block fractions (`▁`…`█`) for bars, `sparkline()`
  for timeseries, box-drawing for borders, multi-line glyph fonts for big
  numbers.
- `getTermWidth()` reads `process.stdout.columns`, falling back to
  `DEFAULT_TERM_WIDTH = 100` when not a TTY.
- `formatDashboardWithData()` returns the final string;
  `createDashboardViewRenderer()` is the `HumanRenderer` the `view` command
  hands to `buildCommand`'s output pipeline. `--json` bypasses all of this.

The important property: **the framebuffer is measured in character cells, and
composition (`renderGrid`/`composeTermRow`/`fitToWidth`) assumes every widget
occupies an integer number of cells wide and rows tall.** A sixel image is
measured in device pixels and does not participate in per-row string
composition. That mismatch is the core integration problem below.

## Terminal support matrix

| Terminal | Sixel | Notes |
| --- | --- | --- |
| xterm (`-ti vt340`) | yes | reference implementation |
| WezTerm | yes | good sixel support |
| foot | yes | native |
| mlterm | yes | native |
| Contour | yes | native |
| iTerm2 | partial | has its own inline-image protocol (OSC 1337); sixel supported in recent builds |
| Kitty | no (sixel) | uses its own graphics protocol (APC `_G`); does **not** do sixel |
| Windows Terminal | yes (recent) | the CLI probe is unix-only today, so we'd report unsupported on win32 regardless |
| VTE (GNOME Terminal) | recent only | sixel landed relatively late; older builds decline via DA1 |
| Apple Terminal | no | declines via DA1 |
| tmux | pass-through only with `set -g allow-passthrough on` and a sixel-capable outer terminal; DA1 is answered by tmux, so our probe can be wrong inside tmux | 
| ssh | fine — sixel is just bytes on the wire; capability is the *local* terminal's, which the DA1 round-trip already measures correctly | 

Practical consequence: DA1-based detection is correct for the common cases
(direct terminal, ssh) and already handles the "decline" path. The two soft
spots are **tmux** (DA1 answered by the multiplexer, not the real terminal) and
**Kitty/iTerm2** (which prefer their own protocols). We already opt out on
non-TTY, Windows, and `TERM=dumb`; a conservative first cut can additionally
treat tmux as unsupported unless explicitly forced.

## How sixel would plug into the grid

Two viable strategies:

### A. Per-widget pixel tiles (preferred, incremental)

Render individual widgets (start with timeseries) to a raster, encode with
`encodeImageToSixel`, and emit the sixel where that widget's box would go. The
grid stays character-based; a graphics-capable widget occupies its box's pixel
footprint, computed from its cell span times `cellWidth`/`cellHeight`.

- Pixel budget for a widget: `widthPx = colWidth_cells * caps.cellWidth`,
  `heightPx = (layout.h * LINES_PER_UNIT) * caps.cellHeight`. Both require a
  reported cell size; if `detectSixelCaps()` didn't return one, that widget
  falls back to the character renderer (same rule `sixelFits` already uses for
  the banner).
- Cursor placement is the tricky part: sixel advances the cursor after
  emission, and mixing sixel tiles with text on the same rows means the renderer
  can no longer treat output as a flat array of strings. `renderGrid()` would
  need to emit row-by-row with explicit cursor positioning (`CSI row;col H`) so
  each pixel tile lands in its box and text widgets fill the rest. This is the
  main new complexity.
- Fallback is per-widget and free: if a widget can't be rasterized or the
  terminal declined, `renderContentLines()` runs exactly as today for that box.

### B. Whole-canvas image (simpler output, worse fallback)

Rasterize the entire dashboard to one large image and emit a single sixel. No
cursor-positioning problem, but it throws away text selectability everywhere,
scales badly to tall dashboards, and makes the fallback all-or-nothing. Not
recommended.

Either way we need a **rasterizer** — something that draws a chart to RGBA. The
encoder consumes pixels; it does not draw charts. Options, cheapest first:

1. Hand-rolled 2D raster for the specific chart types (line/area/heatmap): a few
   hundred lines, no new deps, full control, works in the SEA binary. Matches
   the project's existing "no new deps, pure-JS" posture (see `sixel-image.ts`
   design notes).
2. A pure-JS canvas (`@napi-rs/canvas` is native — won't bundle cleanly;
   `skia-canvas`/`node-canvas` are native too). Native addons are a poor fit for
   the single-executable build, so this is effectively ruled out unless a
   pure-JS canvas is acceptable.
3. Render an SVG string and rasterize — still needs a rasterizer, so no win.

Option 1 is the realistic path and keeps the dependency/runtime cost at zero new
packages.

## Dependency & runtime cost

- **No new runtime dependencies** if we hand-roll the rasterizer; `pngjs` and
  `jpeg-js` are already bundled, and the sixel encoder is already written.
- **Runtime cost**: the DA1 probe is a one-time ~300ms-max round-trip already
  paid by the banner path; quantization + encoding is O(pixels) and already
  bounded by the 800×2000 downscale caps. A dashboard-sized image is well under
  that. Auto-refresh (`dashboard view -r`) would re-encode each frame — cheap
  for small tiles, but worth measuring before enabling under refresh.
- **Binary size**: unchanged (no new deps).

## Graceful fallback

The fallback story is already the CLI's default posture and needs no new
concepts:

1. `canRenderSixel()` false → render the character framebuffer exactly as today.
2. `detectSixelCaps()` returned no cell size → decline (can't compute the pixel
   budget), fall back.
3. `--json` / non-TTY / `SENTRY_PLAIN_OUTPUT` / `NO_COLOR` / `SENTRY_NO_SIXEL`
   → never emit sixel (the `sentry api` path already respects all of these).
4. Per-widget fallback (strategy A) means a partially-capable render degrades one
   widget at a time rather than failing the whole view.

## Opt-in vs auto-detect

Recommend **opt-in first**, auto-detect second:

- Ship `--graphics=<auto|sixel|none>` on `dashboard view`, defaulting to `none`
  (character render) while the raster path matures. `sixel` forces it (still
  gated by `canRenderSixel()` unless we add a hard `--graphics=sixel!` escape
  hatch for tmux). This mirrors how the banner and `sentry api` treat sixel as
  an enhancement over a guaranteed text path.
- Once the timeseries raster is proven and the tmux/Kitty edge cases are
  handled, flip the default to `auto` (emit when `canRenderSixel()` and a cell
  size are known, else fall back). Keep `--graphics=none` and `SENTRY_NO_SIXEL`
  as the always-available off switches. Register any new env var in
  `src/lib/env-registry.ts` (single source of truth).

## Recommended first cut (if scheduled)

1. Add a `renderTimeseriesSixel(widget, widthPx, heightPx)` rasterizer +
   `encodeImageToSixel` call behind a capability check; leave every other widget
   type on the character path.
2. Teach `renderGrid()` to emit with explicit cursor positioning so a single
   pixel tile can coexist with text widgets.
3. Wire `--graphics` on `dashboard view` (default `none`), gated by
   `canRenderSixel()` for `auto`/`sixel`.
4. Tests: unit-test the rasterizer and the placement math against known cell
   sizes; snapshot the character fallback stays byte-identical when graphics are
   off (protects the existing behavior).

## Open questions

- tmux: detect and decline by default, or rely on `allow-passthrough` + force?
- Kitty/iTerm2: worth a second backend (Kitty graphics protocol / OSC 1337), or
  sixel-only for v1 and let those terminals use the character path?
- Under `-r` auto-refresh, is per-frame re-encode acceptable, or do we cap the
  refresh rate when graphics are on?
- Where does the pixel budget come from when the terminal answers DA1 but not
  `CSI 16 t` (some terminals) — decline, or assume a default cell size?
