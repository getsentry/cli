/**
 * Tests for LoggingUI — verifies non-interactive output is emitted to the
 * appropriate stream (stdout vs stderr), spinners are line-stable, and
 * prompt methods throw `LoggingUIPromptError`.
 *
 * Output is captured via injected `Writable` streams so we don't write to
 * the real terminal during tests.
 */

import { describe, expect, test } from "bun:test";
import { Writable } from "node:stream";
import { stripAnsi } from "../../../../src/lib/formatters/plain-detect.js";
import {
  LoggingUI,
  LoggingUIPromptError,
} from "../../../../src/lib/init/ui/logging-ui.js";

/**
 * Test helper: constructs a LoggingUI with two in-memory sinks and
 * exposes them as ANSI-stripped string snapshots.
 *
 * Stripping ANSI keeps assertions terminal-agnostic — `LoggingUI` runs
 * markdown through `renderInlineMarkdown`, which can emit color codes
 * depending on the parent process's TTY/`FORCE_COLOR` state.
 */
function createUI(): {
  ui: LoggingUI;
  stdout: () => string;
  stderr: () => string;
} {
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  const stdout = new Writable({
    write(chunk, _encoding, callback): void {
      stdoutChunks.push(Buffer.from(chunk));
      callback();
    },
  });
  const stderr = new Writable({
    write(chunk, _encoding, callback): void {
      stderrChunks.push(Buffer.from(chunk));
      callback();
    },
  });
  const ui = new LoggingUI({ stdout, stderr });
  return {
    ui,
    stdout: () => stripAnsi(Buffer.concat(stdoutChunks).toString("utf-8")),
    stderr: () => stripAnsi(Buffer.concat(stderrChunks).toString("utf-8")),
  };
}

describe("LoggingUI lifecycle messages", () => {
  test("intro writes to stdout", () => {
    const { ui, stdout, stderr } = createUI();
    ui.intro("Starting wizard");
    expect(stdout()).toBe("Starting wizard\n");
    expect(stderr()).toBe("");
  });

  test("outro writes to stdout", () => {
    const { ui, stdout, stderr } = createUI();
    ui.outro("All done");
    expect(stdout()).toBe("All done\n");
    expect(stderr()).toBe("");
  });

  test("cancel writes to stderr", () => {
    const { ui, stdout, stderr } = createUI();
    ui.cancel("Aborted by user");
    expect(stdout()).toBe("");
    expect(stderr()).toBe("Aborted by user\n");
  });

  test("feedback writes the copy-paste command to stdout", () => {
    const { ui, stdout, stderr } = createUI();
    ui.feedback("cancelled");
    expect(stdout()).toBe(
      [
        "Sad to see setup stop. Was something going sideways?",
        "Tell us so we can fix it:",
        '$ sentry cli feedback "sentry init was cancelled"',
        "",
        "",
      ].join("\n")
    );
    expect(stderr()).toBe("");
  });
});

describe("LoggingUI log API", () => {
  test("info writes to stdout with prefix", () => {
    const { ui, stdout, stderr } = createUI();
    ui.log.info("hello");
    expect(stdout()).toBe("info: hello\n");
    expect(stderr()).toBe("");
  });

  test("success writes to stdout with prefix", () => {
    const { ui, stdout } = createUI();
    ui.log.success("done");
    expect(stdout()).toBe("ok: done\n");
  });

  test("warn writes to stderr with prefix", () => {
    const { ui, stdout, stderr } = createUI();
    ui.log.warn("careful");
    expect(stdout()).toBe("");
    expect(stderr()).toBe("warn: careful\n");
  });

  test("error writes to stderr with prefix", () => {
    const { ui, stdout, stderr } = createUI();
    ui.log.error("nope");
    expect(stdout()).toBe("");
    expect(stderr()).toBe("error: nope\n");
  });

  test("message renders markdown to stdout", () => {
    const { ui, stdout } = createUI();
    ui.log.message("# Heading\n\nbody");
    const out = stdout();
    // We don't assert exact ANSI output — just confirm content survived.
    expect(out).toContain("Heading");
    expect(out).toContain("body");
    expect(out.endsWith("\n")).toBe(true);
  });
});

describe("LoggingUI spinner", () => {
  test("emits a single line per lifecycle event", () => {
    const { ui, stdout } = createUI();
    const spinner = ui.spinner();
    spinner.start("Working");
    spinner.message("Still working");
    spinner.stop("Done", 0);
    const lines = stdout().split("\n").filter(Boolean);
    expect(lines).toEqual(["... Working", "... Still working", "ok: Done"]);
  });

  test("error stop routes to stderr with error prefix", () => {
    const { ui, stdout, stderr } = createUI();
    const spinner = ui.spinner();
    spinner.start("Working");
    spinner.stop("Boom", 1);
    expect(stdout()).toBe("... Working\n");
    expect(stderr()).toBe("error: Boom\n");
  });

  test("warn stop uses warn prefix", () => {
    const { ui, stdout } = createUI();
    const spinner = ui.spinner();
    spinner.start("Working");
    spinner.stop("Heads up", 2);
    const lines = stdout().split("\n").filter(Boolean);
    expect(lines.at(-1)).toBe("warn: Heads up");
  });

  test("stop without start is a no-op", () => {
    const { ui, stdout, stderr } = createUI();
    ui.spinner().stop("nothing", 0);
    expect(stdout()).toBe("");
    expect(stderr()).toBe("");
  });

  test("message after stop does not emit", () => {
    const { ui, stdout } = createUI();
    const spinner = ui.spinner();
    spinner.start("Working");
    spinner.stop("Done");
    spinner.message("ignored");
    const lines = stdout().split("\n").filter(Boolean);
    expect(lines).toEqual(["... Working", "ok: Done"]);
  });
});

describe("LoggingUI prompts throw", () => {
  test("select rejects with LoggingUIPromptError", async () => {
    const { ui } = createUI();
    expect(
      ui.select({
        message: "Pick one",
        options: [{ value: "a", label: "A" }],
      })
    ).rejects.toBeInstanceOf(LoggingUIPromptError);
  });

  test("multiselect rejects with LoggingUIPromptError", async () => {
    const { ui } = createUI();
    expect(
      ui.multiselect({
        message: "Pick many",
        options: [{ value: "a", label: "A" }],
      })
    ).rejects.toBeInstanceOf(LoggingUIPromptError);
  });

  test("confirm rejects with LoggingUIPromptError", async () => {
    const { ui } = createUI();
    expect(ui.confirm({ message: "Sure?" })).rejects.toBeInstanceOf(
      LoggingUIPromptError
    );
  });

  test("error message identifies the prompt kind and message", async () => {
    const { ui } = createUI();
    let caught: unknown;
    try {
      await ui.select({
        message: "Pick org",
        options: [{ value: "a", label: "A" }],
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(LoggingUIPromptError);
    const message = (caught as Error).message;
    expect(message).toContain("select");
    expect(message).toContain("Pick org");
    expect(message).toContain("--yes");
  });
});

describe("LoggingUI disposal", () => {
  test("[Symbol.asyncDispose] resolves without writing", async () => {
    const { ui, stdout, stderr } = createUI();
    await ui[Symbol.asyncDispose]();
    expect(stdout()).toBe("");
    expect(stderr()).toBe("");
  });

  test("works with await using", async () => {
    const stdoutChunks: Buffer[] = [];
    const stdout = new Writable({
      write(chunk, _encoding, callback): void {
        stdoutChunks.push(Buffer.from(chunk));
        callback();
      },
    });
    {
      await using ui = new LoggingUI({ stdout, stderr: stdout });
      ui.intro("hi");
    }
    expect(stripAnsi(Buffer.concat(stdoutChunks).toString("utf-8"))).toBe(
      "hi\n"
    );
  });
});
