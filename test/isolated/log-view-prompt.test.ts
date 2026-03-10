/**
 * Isolated test for log view --web interactive prompt path.
 *
 * Uses mock.module() to override node:tty so isatty(0) returns true,
 * and mocks the logger module to control the prompt response.
 *
 * Run with: bun test test/isolated
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from "bun:test";

// Mock isatty to simulate interactive terminal.
// Bun's ESM wrapper for CJS built-ins exposes a `default` re-export plus
// `ReadStream` / `WriteStream` — all must be present or Bun throws
// "Missing 'default' export in module 'node:tty'".
const mockIsatty = mock(() => true);

class FakeReadStream {}
class FakeWriteStream {}

const ttyExports = {
  isatty: mockIsatty,
  ReadStream: FakeReadStream,
  WriteStream: FakeWriteStream,
};
mock.module("node:tty", () => ({
  ...ttyExports,
  default: ttyExports,
}));

// Mock prompt on the logger module — we need to intercept the .prompt()
// call made by the module-scoped `log = logger.withTag("log-view")` in view.ts.
// The approach: mock the entire logger so .withTag() returns a consola-like
// object whose .prompt() we control.
const mockPrompt = mock(() => Promise.resolve(true));
const mockWarn = mock(() => {
  // no-op
});

/** Fake scoped logger returned by withTag() */
const fakeLog = {
  prompt: mockPrompt,
  warn: mockWarn,
  // biome-ignore lint/suspicious/noEmptyBlockStatements: no-op mock
  info: mock(() => {}),
  // biome-ignore lint/suspicious/noEmptyBlockStatements: no-op mock
  error: mock(() => {}),
  // biome-ignore lint/suspicious/noEmptyBlockStatements: no-op mock
  debug: mock(() => {}),
  withTag: () => fakeLog,
};

/** Fake root logger */
const fakeLogger = {
  ...fakeLog,
  withTag: () => fakeLog,
};

mock.module("../../src/lib/logger.js", () => ({
  logger: fakeLogger,
  // biome-ignore lint/suspicious/noEmptyBlockStatements: no-op mock
  setLogLevel: mock(() => {}),
  // biome-ignore lint/suspicious/noEmptyBlockStatements: no-op mock
  attachSentryReporter: mock(() => {}),
  // These exports are required by command.ts (in the view.ts import chain)
  LOG_LEVEL_NAMES: ["error", "warn", "log", "info", "debug", "trace"],
  LOG_LEVEL_ENV_VAR: "SENTRY_LOG_LEVEL",
  parseLogLevel: (name: string) => {
    const levels = ["error", "warn", "log", "info", "debug", "trace"];
    const idx = levels.indexOf(name.toLowerCase().trim());
    return idx === -1 ? 3 : idx;
  },
  getEnvLogLevel: () => null,
}));

// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as browser from "../../src/lib/browser.js";

const { viewCommand } = await import("../../src/commands/log/view.js");

const ID1 = "aaaa1111bbbb2222cccc3333dddd4444";
const ID2 = "1111222233334444555566667777aaaa";

function createMockContext() {
  const stdoutWrite = mock(() => true);
  return {
    context: {
      stdout: { write: stdoutWrite },
      stderr: { write: mock(() => true) },
      cwd: "/tmp",
      setContext: mock(() => {
        // no-op
      }),
    },
    stdoutWrite,
  };
}

describe("log view --web interactive prompt", () => {
  let openInBrowserSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    openInBrowserSpy = spyOn(browser, "openInBrowser");
    mockIsatty.mockReturnValue(true);
    mockPrompt.mockClear();
  });

  afterEach(() => {
    openInBrowserSpy.mockRestore();
  });

  test("prompts and opens all tabs when user confirms", async () => {
    mockPrompt.mockResolvedValue(true);
    openInBrowserSpy.mockResolvedValue(undefined);

    const { context } = createMockContext();
    const func = await viewCommand.loader();
    await func.call(
      context,
      { json: false, web: true },
      "my-org/proj",
      ID1,
      ID2
    );

    expect(mockPrompt).toHaveBeenCalled();
    expect(openInBrowserSpy).toHaveBeenCalledTimes(2);
    const url1 = openInBrowserSpy.mock.calls[0][0] as string;
    const url2 = openInBrowserSpy.mock.calls[1][0] as string;
    expect(url1).toContain(ID1);
    expect(url2).toContain(ID2);
  });

  test("prompts and aborts when user declines", async () => {
    mockPrompt.mockResolvedValue(false);
    openInBrowserSpy.mockResolvedValue(undefined);

    const { context } = createMockContext();
    const func = await viewCommand.loader();
    await func.call(
      context,
      { json: false, web: true },
      "my-org/proj",
      ID1,
      ID2
    );

    expect(mockPrompt).toHaveBeenCalled();
    expect(openInBrowserSpy).not.toHaveBeenCalled();
  });

  test("aborts when user cancels prompt with Ctrl+C (truthy Symbol)", async () => {
    // consola returns Symbol(clack:cancel) on Ctrl+C — truthy but not `true`.
    // Cast needed because the mock is typed as boolean but consola actually
    // returns a Symbol on cancel.
    mockPrompt.mockResolvedValue(Symbol("clack:cancel") as unknown as boolean);
    openInBrowserSpy.mockResolvedValue(undefined);

    const { context } = createMockContext();
    const func = await viewCommand.loader();
    await func.call(
      context,
      { json: false, web: true },
      "my-org/proj",
      ID1,
      ID2
    );

    expect(mockPrompt).toHaveBeenCalled();
    expect(openInBrowserSpy).not.toHaveBeenCalled();
  });
});
