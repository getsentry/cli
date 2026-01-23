/**
 * Clipboard utilities
 *
 * Cross-platform utilities for copying text to the system clipboard.
 * Includes both low-level copy function and interactive keyboard-triggered copy.
 */

import type { Writer } from "../types/index.js";
import { success } from "./formatters/colors.js";

const CTRL_C = "\x03";
const CLEAR_LINE = "\r\x1b[K";

/**
 * Copy text to the system clipboard.
 *
 * Uses platform-specific commands:
 * - macOS: pbcopy
 * - Linux: xclip or xsel
 * - Windows: clip
 *
 * @param text - The text to copy to clipboard
 * @returns true if copy succeeded, false otherwise
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  const { platform } = process;

  let command: string | null = null;
  let args: string[] = [];

  if (platform === "darwin") {
    command = Bun.which("pbcopy");
    args = [];
  } else if (platform === "win32") {
    command = Bun.which("clip");
    args = [];
  } else {
    // Linux - try xclip first, then xsel
    command = Bun.which("xclip");
    if (command) {
      args = ["-selection", "clipboard"];
    } else {
      command = Bun.which("xsel");
      if (command) {
        args = ["--clipboard", "--input"];
      }
    }
  }

  if (!command) {
    return false;
  }

  try {
    const proc = Bun.spawn([command, ...args], {
      stdin: "pipe",
      stdout: "ignore",
      stderr: "ignore",
    });

    proc.stdin.write(text);
    proc.stdin.end();

    const exitCode = await proc.exited;
    return exitCode === 0;
  } catch {
    return false;
  }
}

/**
 * Sets up a keyboard listener that copies text to clipboard when 'c' is pressed.
 * Only activates in TTY environments. Returns a cleanup function to restore stdin state.
 *
 * @param stdin - The stdin stream to listen on
 * @param getText - Function that returns the text to copy
 * @param stdout - Output stream for feedback messages
 * @returns Cleanup function to restore stdin state
 */
export function setupCopyKeyListener(
  stdin: NodeJS.ReadStream,
  getText: () => string,
  stdout: Writer
): () => void {
  if (!stdin.isTTY) {
    return () => {
      /* no-op for non-TTY */
    };
  }

  stdin.setRawMode(true);
  stdin.resume();

  let active = true;

  const onData = async (data: Buffer) => {
    const key = data.toString();

    if (key === "c" || key === "C") {
      const text = getText();
      const copied = await copyToClipboard(text);
      if (copied && active) {
        stdout.write(CLEAR_LINE);
        stdout.write(success("Copied!"));
      }
    }

    if (key === CTRL_C) {
      stdin.setRawMode(false);
      stdin.pause();
      process.exit(130);
    }
  };

  stdin.on("data", onData);

  return () => {
    active = false;
    stdin.off("data", onData);
    if (stdin.isTTY) {
      stdin.setRawMode(false);
    }
    stdin.pause();
  };
}
