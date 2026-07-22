/**
 * Byte-driven progress bar for long-running upgrade phases (patch apply,
 * full-binary download).
 *
 * Design contract:
 * - Renders only when output is interactive (respects `isPlainOutput()`, so
 *   `NO_COLOR`, piped stdout, and CI all suppress the bar). In plain mode it
 *   prints the label once.
 * - Cosmetic ONLY — rendering must never throw or abort the underlying work.
 * - Determinate when a byte `total` is supplied; an indeterminate byte counter
 *   otherwise (the decompressed download size isn't known ahead of time).
 *
 * One line, redrawn in place via carriage return; `done()` clears the line so
 * the next message prints cleanly.
 */

import { formatBytes } from "./formatters/numbers.js";
import { isPlainOutput } from "./formatters/plain-detect.js";

export type ByteProgressOut = {
  isTTY?: boolean;
  write: (s: string) => unknown;
};

export type ByteProgress = {
  /** Report `bytes` additional bytes processed since the last call. */
  onProgress: (bytes: number) => void;
  /** Clear the progress line (call before printing the next message). */
  done: () => void;
};

const BAR_WIDTH = 16;

function renderBar(frac: number, width = BAR_WIDTH): string {
  const filled = Math.max(0, Math.min(width, Math.round(width * frac)));
  return "█".repeat(filled) + "░".repeat(width - filled);
}

/**
 * Create a byte-progress bar.
 *
 * @param label - Short label shown before the bar (e.g. "Applying 3 patches").
 * @param totalBytes - Expected total bytes; `null` renders an indeterminate
 *   byte counter instead of a bar.
 * @param out - Output stream (defaults to stderr, the CLI's progress channel).
 */
export function makeByteProgress(
  label: string,
  totalBytes: number | null,
  out: ByteProgressOut = process.stderr
): ByteProgress {
  // Interactive only: a real TTY AND not forced into plain output.
  const interactive = !!out.isTTY && !isPlainOutput();
  let written = 0;
  let lastLen = 0;
  let headerShown = false;

  const line = (): string => {
    if (totalBytes === null || totalBytes <= 0) {
      return `${label}  ${formatBytes(written)}`;
    }
    const frac = Math.min(written / totalBytes, 1);
    return (
      `${label} [${renderBar(frac)}] ` +
      `${formatBytes(written)} / ${formatBytes(totalBytes)}`
    );
  };

  const onProgress = (bytes: number): void => {
    // Cosmetic only — a rendering failure must never abort the operation.
    try {
      written += bytes;
      if (!interactive) {
        if (!headerShown) {
          out.write(`${label}\n`);
          headerShown = true;
        }
        return;
      }
      const l = line();
      // Pad with spaces to overwrite any leftover tail from a longer previous
      // frame (e.g. when formatBytes shrinks at the KB→MB boundary), then track
      // the full printed width so done() clears it completely.
      const padded =
        l.length < lastLen ? l + " ".repeat(lastLen - l.length) : l;
      lastLen = padded.length;
      out.write(`\r${padded}`);
    } catch {
      // ignore — progress is cosmetic
    }
  };

  const done = (): void => {
    // Cosmetic only — must never throw, matching onProgress's contract.
    try {
      if (interactive && lastLen > 0) {
        out.write(`\r${" ".repeat(lastLen)}\r`);
      }
    } catch {
      // ignore — progress is cosmetic
    }
  };

  return { onProgress, done };
}
