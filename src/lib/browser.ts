/**
 * Browser utilities
 *
 * Cross-platform utilities for interacting with the user's browser.
 * Uses Bun.spawn and Bun.which for process management.
 */

import type { Writer } from "../types/index.js";
import { generateQRCode } from "./qrcode.js";

/**
 * Open a URL in the user's default browser.
 *
 * This is a "best effort" operation - returns true if successful, false otherwise.
 * Never throws, so callers can safely attempt to open a browser without breaking flows.
 */
export async function openBrowser(url: string): Promise<boolean> {
  const { platform } = process;

  let command: string | null = null;
  let args: string[];

  if (platform === "darwin") {
    command = Bun.which("open");
    args = [url];
  } else if (platform === "win32") {
    command = Bun.which("cmd");
    args = ["/c", "start", "", url];
  } else {
    // Linux and other Unix-like systems - try multiple openers
    const linuxOpeners = [
      "xdg-open",
      "sensible-browser",
      "x-www-browser",
      "gnome-open",
      "kde-open",
    ];
    for (const opener of linuxOpeners) {
      command = Bun.which(opener);
      if (command) {
        break;
      }
    }
    args = [url];
  }

  if (!command) {
    return false;
  }

  try {
    const proc = Bun.spawn([command, ...args], {
      stdout: "ignore",
      stderr: "ignore",
    });

    // Give browser time to open, then detach
    await Bun.sleep(500);
    proc.unref();
    return true;
  } catch {
    return false;
  }
}

/**
 * Open URL in browser, or show URL + QR code as fallback.
 *
 * Attempts to open the browser first. If that fails (no browser available,
 * headless environment, etc.), displays the URL and a QR code for mobile scanning.
 *
 * @param stdout - Output stream for messages
 * @param url - The URL to open or display
 * @returns true if browser opened, false if showing fallback
 */
export async function openOrShowUrl(
  stdout: Writer,
  url: string
): Promise<boolean> {
  const opened = await openBrowser(url);
  if (opened) {
    stdout.write("Opening in browser...\n");
    return true;
  }

  // Fallback: show URL and QR code
  stdout.write("Could not open browser. Visit this URL:\n\n");
  stdout.write(`${url}\n\n`);
  const qr = await generateQRCode(url);
  stdout.write(qr);
  stdout.write("\n");
  return false;
}

/**
 * Handle the --web flag for view commands.
 *
 * Opens the URL in a browser if available, otherwise shows URL + QR code.
 * If URL is undefined/null, prints an error message.
 *
 * @param stdout - Output stream for messages
 * @param url - The URL to open (or undefined if not available)
 * @param entityName - Name of the entity for error message (e.g., "issue", "project")
 */
export async function openInBrowser(
  stdout: Writer,
  url: string | undefined,
  entityName = "resource"
): Promise<void> {
  if (!url) {
    stdout.write(`No URL available for this ${entityName}.\n`);
    return;
  }
  await openOrShowUrl(stdout, url);
}
