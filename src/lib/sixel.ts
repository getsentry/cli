/**
 * Sixel Banner Support
 *
 * Detects whether the current terminal can render sixel graphics and, if so,
 * returns the baked banner (see {@link BANNER_SIXEL}) sized to fit the terminal.
 * Everything degrades gracefully to the block-art banner in `banner.ts`.
 *
 * Detection uses a synchronous, best-effort terminal round-trip (unix only):
 *   - Primary Device Attributes (`ESC [ c`) — attribute `4` means sixel.
 *   - Text-area cell size (`ESC [ 16 t` → `ESC [ 6 ; H ; W t`) — used to check
 *     the fixed-pixel image actually fits the current column width.
 * The probe is gated behind an interactive TTY, honors plain-output/opt-out
 * signals, has a short timeout, restores terminal state, and never throws.
 * The result is cached for the process.
 */

import { execSync } from "node:child_process";
import { closeSync, openSync, readSync, writeSync } from "node:fs";
import { BANNER_SIXEL } from "../generated/banner-sixel.js";
import { isPlainOutput } from "./formatters/plain-detect.js";

/** Terminal sixel capabilities discovered by the probe. */
export type SixelCaps = {
  /** True when the terminal advertised sixel support (DA1 attribute 4). */
  supported: boolean;
  /** Character-cell width in pixels (from `CSI 16 t`), when reported. */
  cellWidth?: number;
  /** Character-cell height in pixels (from `CSI 16 t`), when reported. */
  cellHeight?: number;
};

/** Shared "no sixel" result. */
const UNSUPPORTED: SixelCaps = { supported: false };

/** Primary DA reply: `ESC [ ? <p;p;...> c` — attribute list; `4` == sixel. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: parsing terminal escapes
const DA1_RE = /\x1b\[\?([0-9;]*)c/;

/** Cell-size report: `ESC [ 6 ; <height> ; <width> t`. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: parsing terminal escapes
const CELL_SIZE_RE = /\x1b\[6;(\d+);(\d+)t/;

let cached: SixelCaps | undefined;

/** Clear the cached probe result. Test-only. */
export function __resetSixelCache(): void {
  cached = undefined;
}

/**
 * Parse a terminal's reply to the DA1 + cell-size queries.
 *
 * Pure and side-effect free so it can be unit-tested without a terminal.
 * Returns {@link UNSUPPORTED} unless the DA1 attribute list contains `4`.
 */
export function parseSixelCaps(reply: string): SixelCaps {
  const da = reply.match(DA1_RE);
  const attrs = da?.[1]?.split(";") ?? [];
  if (!attrs.includes("4")) {
    return UNSUPPORTED;
  }
  const size = reply.match(CELL_SIZE_RE);
  const caps: SixelCaps = { supported: true };
  if (size) {
    caps.cellHeight = Number(size[1]);
    caps.cellWidth = Number(size[2]);
  }
  return caps;
}

/**
 * Whether the fixed-pixel banner of `bannerWidth` px fits within `columns`
 * given the reported cell width. Requires a known cell width — if the terminal
 * didn't report one we can't guarantee the image won't overflow, so we decline.
 */
export function sixelFits(
  caps: SixelCaps,
  columns: number,
  bannerWidth: number
): boolean {
  if (!(caps.supported && caps.cellWidth && caps.cellWidth > 0)) {
    return false;
  }
  return bannerWidth <= columns * caps.cellWidth;
}

/** True when any signal says we must not probe/emit sixel. */
function optedOut(): boolean {
  const env = process.env;
  return (
    !(process.stdout.isTTY && process.stdin.isTTY) ||
    process.platform === "win32" || // MVP: probe is unix-only
    isPlainOutput() ||
    !env.TERM ||
    env.TERM === "dumb" ||
    Boolean(env.SENTRY_NO_SIXEL)
  );
}

/**
 * Read the terminal's query replies from a blocking tty fd. With the tty in
 * `min 0 time N` mode each read blocks up to N deciseconds and returns 0 on
 * timeout. Stops once both terminators (`c` for DA1, `t` for cell size) arrive
 * or a read times out with nothing — draining the full reply so it never leaks
 * onto the shell prompt.
 */
function readReply(fd: number): string {
  const buf = Buffer.alloc(256);
  let data = "";
  for (let i = 0; i < 16; i++) {
    let n = 0;
    try {
      n = readSync(fd, buf, 0, buf.length, null);
    } catch {
      break;
    }
    if (n <= 0) {
      break;
    }
    data += buf.toString("latin1", 0, n);
    if (data.includes("c") && data.includes("t")) {
      break;
    }
  }
  return data;
}

/**
 * Probe the terminal for sixel support. Synchronous, best-effort, unix-only.
 * Puts the tty in a timed raw read mode, emits the queries, parses the reply,
 * and always restores the prior tty state.
 *
 * Reads/writes a dedicated blocking `/dev/tty` fd rather than stdin (fd 0):
 * Node keeps stdin non-blocking, so a `readSync(0)` would return EAGAIN before
 * the terminal replies — leaving the reply to leak onto the shell prompt.
 */
function probe(): SixelCaps {
  if (optedOut()) {
    return UNSUPPORTED;
  }
  let savedStty: string | undefined;
  let fd: number | undefined;
  try {
    fd = openSync("/dev/tty", "r+");
    savedStty = execSync("stty -g < /dev/tty", { encoding: "utf8" }).trim();
    // min 0 time 3 => each read blocks up to ~300ms for (more) reply bytes.
    execSync("stty -echo -icanon min 0 time 3 < /dev/tty");
    writeSync(fd, "\x1b[c\x1b[16t");
    return parseSixelCaps(readReply(fd));
  } catch {
    return UNSUPPORTED;
  } finally {
    if (savedStty) {
      try {
        execSync(`stty ${savedStty} < /dev/tty`);
      } catch {
        // Best-effort restore; nothing actionable if it fails.
      }
    }
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        // Best-effort close.
      }
    }
  }
}

/** Cached terminal sixel capabilities (probes once per process). */
export function detectSixelCaps(): SixelCaps {
  if (!cached) {
    cached = probe();
  }
  return cached;
}

/**
 * The baked sixel banner escape string when the terminal supports sixel and the
 * image fits `columns`; otherwise `undefined` so the caller falls back to the
 * block-art banner.
 */
export function sixelBanner(
  columns: number = process.stdout.columns ?? 80
): string | undefined {
  const caps = detectSixelCaps();
  return sixelFits(caps, columns, BANNER_SIXEL.width)
    ? BANNER_SIXEL.data
    : undefined;
}
