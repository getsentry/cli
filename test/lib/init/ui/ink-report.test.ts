import { describe, expect, test } from "bun:test";
import { stripAnsi } from "../../../../src/lib/formatters/plain-detect.js";
import {
  formatFailureReport,
  formatSuccessReport,
} from "../../../../src/lib/init/ui/ink-report.js";

describe("Ink post-dispose feedback reports", () => {
  test("success report includes the success feedback command", () => {
    const output = stripAnsi(
      formatSuccessReport(
        "Sentry SDK installed successfully!",
        undefined,
        [
          "Nice, setup made it through.",
          "Tell us what felt great or rough:",
          '$ sentry cli feedback "sentry init worked well"',
        ].join("\n")
      )
    );

    expect(output).toContain("Sentry SDK installed successfully!");
    expect(output).toContain(
      [
        "Nice, setup made it through.",
        "   Tell us what felt great or rough:",
        '   $ sentry cli feedback "sentry init worked well"',
        "",
      ].join("\n")
    );
    expect(output.endsWith("\n")).toBe(true);
  });

  test("failure report includes the failed feedback command", () => {
    const output = stripAnsi(
      formatFailureReport(
        "Setup failed",
        [],
        [
          "Setup hit a wall.",
          "Tell us what happened so we can fix it:",
          '$ sentry cli feedback "sentry init failed"',
        ].join("\n")
      )
    );

    expect(output).toContain("Setup failed");
    expect(output).toContain(
      [
        "Setup hit a wall.",
        "   Tell us what happened so we can fix it:",
        '   $ sentry cli feedback "sentry init failed"',
        "",
      ].join("\n")
    );
    expect(output.endsWith("\n")).toBe(true);
  });

  test("cancel report includes the cancelled feedback command", () => {
    const output = stripAnsi(
      formatFailureReport(
        "Setup cancelled.",
        [],
        [
          "Sad to see setup stop. Was something going sideways?",
          "Tell us so we can fix it:",
          '$ sentry cli feedback "sentry init was cancelled"',
        ].join("\n")
      )
    );

    expect(output).toContain("Setup cancelled.");
    expect(output).toContain(
      [
        "Sad to see setup stop. Was something going sideways?",
        "   Tell us so we can fix it:",
        '   $ sentry cli feedback "sentry init was cancelled"',
        "",
      ].join("\n")
    );
    expect(output.endsWith("\n")).toBe(true);
  });
});
