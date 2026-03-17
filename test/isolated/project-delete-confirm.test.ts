/**
 * Isolated test for project delete interactive confirmation path.
 *
 * Uses mock.module() to override node:tty so isatty(0) returns true,
 * and mocks the logger module to control the prompt response.
 *
 * Run with: bun test test/isolated/project-delete-confirm.test.ts
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
// call made by the module-scoped `log = logger.withTag("project.delete")`.
const mockPrompt = mock(() => Promise.resolve("acme-corp/my-app"));

/** Fake scoped logger returned by withTag() */
const fakeLog = {
  prompt: mockPrompt,
  // biome-ignore lint/suspicious/noEmptyBlockStatements: no-op mock
  info: mock(() => {}),
  // biome-ignore lint/suspicious/noEmptyBlockStatements: no-op mock
  warn: mock(() => {}),
  // biome-ignore lint/suspicious/noEmptyBlockStatements: no-op mock
  error: mock(() => {}),
  // biome-ignore lint/suspicious/noEmptyBlockStatements: no-op mock
  debug: mock(() => {}),
  // biome-ignore lint/suspicious/noEmptyBlockStatements: no-op mock
  success: mock(() => {}),
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
  // These exports are required by command.ts (in the delete.ts import chain)
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
import * as apiClient from "../../src/lib/api-client.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as resolveTarget from "../../src/lib/resolve-target.js";
import type { SentryProject } from "../../src/types/index.js";

const { deleteCommand } = await import("../../src/commands/project/delete.js");

const sampleProject: SentryProject = {
  id: "999",
  slug: "my-app",
  name: "My App",
  platform: "python",
  dateCreated: "2026-02-12T10:00:00Z",
};

function createMockContext() {
  const stdoutWrite = mock(() => true);
  return {
    context: {
      stdout: { write: stdoutWrite },
      stderr: { write: mock(() => true) },
      cwd: "/tmp",
      // biome-ignore lint/suspicious/noEmptyBlockStatements: no-op mock
      setContext: mock(() => {}),
    },
    stdoutWrite,
  };
}

describe("project delete — interactive confirmation", () => {
  let getProjectSpy: ReturnType<typeof spyOn>;
  let deleteProjectSpy: ReturnType<typeof spyOn>;
  let resolveOrgProjectTargetSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    getProjectSpy = spyOn(apiClient, "getProject");
    deleteProjectSpy = spyOn(apiClient, "deleteProject");
    resolveOrgProjectTargetSpy = spyOn(
      resolveTarget,
      "resolveOrgProjectTarget"
    );

    getProjectSpy.mockResolvedValue(sampleProject);
    deleteProjectSpy.mockResolvedValue(undefined);
    resolveOrgProjectTargetSpy.mockResolvedValue({
      org: "acme-corp",
      project: "my-app",
    });

    mockPrompt.mockClear();
    fakeLog.info.mockClear();
  });

  afterEach(() => {
    getProjectSpy.mockRestore();
    deleteProjectSpy.mockRestore();
    resolveOrgProjectTargetSpy.mockRestore();
  });

  test("proceeds when user types exact org/project", async () => {
    mockPrompt.mockResolvedValue("acme-corp/my-app");

    const { context, stdoutWrite } = createMockContext();
    const func = await deleteCommand.loader();
    await func.call(
      context,
      { yes: false, "dry-run": false },
      "acme-corp/my-app"
    );

    expect(deleteProjectSpy).toHaveBeenCalledWith("acme-corp", "my-app");
    const output = stdoutWrite.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("Deleted project");
  });

  test("cancels when user types wrong value", async () => {
    mockPrompt.mockResolvedValue("wrong-org/wrong-project");

    const { context } = createMockContext();
    const func = await deleteCommand.loader();
    await func.call(
      context,
      { yes: false, "dry-run": false },
      "acme-corp/my-app"
    );

    expect(deleteProjectSpy).not.toHaveBeenCalled();
    expect(fakeLog.info).toHaveBeenCalledWith("Cancelled.");
  });

  test("cancels when user presses Ctrl+C (Symbol)", async () => {
    // consola returns Symbol(clack:cancel) on Ctrl+C — truthy but not a string.
    // Cast needed because the mock is typed as string but consola actually
    // returns a Symbol on cancel.
    mockPrompt.mockResolvedValue(Symbol("clack:cancel") as unknown as string);

    const { context } = createMockContext();
    const func = await deleteCommand.loader();
    await func.call(
      context,
      { yes: false, "dry-run": false },
      "acme-corp/my-app"
    );

    expect(deleteProjectSpy).not.toHaveBeenCalled();
    expect(fakeLog.info).toHaveBeenCalledWith("Cancelled.");
  });

  test("cancels when user submits empty string", async () => {
    mockPrompt.mockResolvedValue("");

    const { context } = createMockContext();
    const func = await deleteCommand.loader();
    await func.call(
      context,
      { yes: false, "dry-run": false },
      "acme-corp/my-app"
    );

    expect(deleteProjectSpy).not.toHaveBeenCalled();
  });

  test("prompt message includes project name and expected input", async () => {
    mockPrompt.mockResolvedValue("acme-corp/my-app");

    const { context } = createMockContext();
    const func = await deleteCommand.loader();
    await func.call(
      context,
      { yes: false, "dry-run": false },
      "acme-corp/my-app"
    );

    expect(mockPrompt).toHaveBeenCalledWith(
      expect.stringContaining("acme-corp/my-app"),
      expect.objectContaining({ type: "text" })
    );
  });
});
