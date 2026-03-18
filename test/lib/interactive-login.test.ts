/**
 * Tests for buildDeviceFlowDisplay — the extracted display logic from the
 * interactive login flow's onUserCode callback.
 *
 * Uses SENTRY_PLAIN_OUTPUT=1 to get predictable raw markdown output
 * (no ANSI codes) for string assertions.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { buildDeviceFlowDisplay } from "../../src/lib/interactive-login.js";

// Force plain output for predictable string matching
let origPlain: string | undefined;
beforeAll(() => {
  origPlain = process.env.SENTRY_PLAIN_OUTPUT;
  process.env.SENTRY_PLAIN_OUTPUT = "1";
});
afterAll(() => {
  if (origPlain === undefined) {
    delete process.env.SENTRY_PLAIN_OUTPUT;
  } else {
    process.env.SENTRY_PLAIN_OUTPUT = origPlain;
  }
});

describe("buildDeviceFlowDisplay", () => {
  const CODE = "ABCD-EFGH";
  const URL = "https://sentry.io/auth/device/?user_code=ABCD-EFGH";

  test("includes complete URL as plain text for copy-paste", () => {
    const lines = buildDeviceFlowDisplay(CODE, URL, true, false);
    const joined = lines.join("\n");
    // URL must be literal (no markdown escaping) so it's copyable
    expect(joined).toContain(URL);
  });

  test("preserves underscores in URLs (no markdown escaping)", () => {
    const urlWithUnderscores =
      "https://self_hosted.example.com/auth/device/?user_code=AB_CD";
    const lines = buildDeviceFlowDisplay(
      "AB_CD",
      urlWithUnderscores,
      true,
      false
    );
    const joined = lines.join("\n");
    // URL must not be escaped — underscores stay as-is for copy-paste
    expect(joined).toContain(urlWithUnderscores);
    expect(joined).not.toContain("\\_");
  });

  test("includes user code as inline code span", () => {
    const lines = buildDeviceFlowDisplay(CODE, URL, true, false);
    const joined = lines.join("\n");
    expect(joined).toContain(`\`${CODE}\``);
  });

  test("omits copy hint when browser opened", () => {
    const lines = buildDeviceFlowDisplay(CODE, URL, true, true);
    const joined = lines.join("\n");
    expect(joined).not.toContain("Copy the URL above");
    expect(joined).not.toContain("to copy URL");
  });

  test("shows copy hint when browser did not open (TTY)", () => {
    const lines = buildDeviceFlowDisplay(CODE, URL, false, true);
    const joined = lines.join("\n");
    expect(joined).toContain("Copy the URL above to sign in.");
    expect(joined).toContain("to copy URL");
  });

  test("shows copy hint without keyboard shortcut in non-TTY", () => {
    const lines = buildDeviceFlowDisplay(CODE, URL, false, false);
    const joined = lines.join("\n");
    expect(joined).toContain("Copy the URL above to sign in.");
    expect(joined).not.toContain("to copy URL");
  });

  test("returns more lines when browser did not open", () => {
    const withBrowser = buildDeviceFlowDisplay(CODE, URL, true, false);
    const withoutBrowser = buildDeviceFlowDisplay(CODE, URL, false, false);
    // Without browser: extra copy-hint line + blank line
    expect(withoutBrowser.length).toBeGreaterThan(withBrowser.length);
  });

  test("includes user code as inline code span", () => {
    const lines = buildDeviceFlowDisplay(CODE, URL, true, false);
    const joined = lines.join("\n");
    expect(joined).toContain(`\`${CODE}\``);
  });

  test("omits copy hint when browser opened", () => {
    const lines = buildDeviceFlowDisplay(CODE, URL, true, true);
    const joined = lines.join("\n");
    expect(joined).not.toContain("Copy the URL above");
    expect(joined).not.toContain("to copy URL");
  });

  test("shows copy hint when browser did not open (TTY)", () => {
    const lines = buildDeviceFlowDisplay(CODE, URL, false, true);
    const joined = lines.join("\n");
    expect(joined).toContain("Copy the URL above to sign in.");
    expect(joined).toContain("to copy URL");
  });

  test("shows copy hint without keyboard shortcut in non-TTY", () => {
    const lines = buildDeviceFlowDisplay(CODE, URL, false, false);
    const joined = lines.join("\n");
    expect(joined).toContain("Copy the URL above to sign in.");
    expect(joined).not.toContain("to copy URL");
  });

  test("returns more lines when browser did not open", () => {
    const withBrowser = buildDeviceFlowDisplay(CODE, URL, true, false);
    const withoutBrowser = buildDeviceFlowDisplay(CODE, URL, false, false);
    // Without browser: extra copy-hint line + blank line
    expect(withoutBrowser.length).toBeGreaterThan(withBrowser.length);
  });
});
