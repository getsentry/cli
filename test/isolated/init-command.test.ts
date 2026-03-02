/**
 * Isolated tests for the `sentry init` command entry point.
 *
 * Mocks the same modules as init-wizard-runner.test.ts to avoid
 * mock.module() cross-file interference in bun's test runner.
 */

import { beforeEach, describe, expect, mock, test } from "bun:test";
import path from "node:path";

// ── Clack mocks (must match wizard-runner test to avoid leakage) ─────────
const spinnerMock = { start: mock(), stop: mock(), message: mock() };

mock.module("@clack/prompts", () => ({
  spinner: () => spinnerMock,
  intro: mock(),
  log: { info: mock(), warn: mock(), error: mock() },
  cancel: mock(),
  note: mock(),
  outro: mock(),
  select: mock(),
  multiselect: mock(),
  confirm: mock(),
  isCancel: (v: unknown) => v === Symbol.for("cancel"),
}));

// ── Handler mocks ────────────────────────────────────────────────────────
mock.module("../../src/lib/init/local-ops.js", () => ({
  handleLocalOp: mock(() =>
    Promise.resolve({ ok: true, data: { results: [] } })
  ),
  validateCommand: () => {
    /* noop mock */
  },
}));

mock.module("../../src/lib/init/interactive.js", () => ({
  handleInteractive: mock(() => Promise.resolve({ action: "continue" })),
}));

mock.module("../../src/lib/init/formatters.js", () => ({
  formatResult: mock(),
  formatError: mock(),
}));

mock.module("../../src/lib/db/auth.js", () => ({
  getAuthToken: () => "fake-token",
  isAuthenticated: () => Promise.resolve(false),
}));

mock.module("../../src/lib/help.js", () => ({
  formatBanner: () => "BANNER",
}));

// ── MastraClient mock — startAsync captures the runWizard call args ──────
let capturedInputData: Record<string, unknown> | undefined;

mock.module("@mastra/client-js", () => ({
  MastraClient: class {
    getWorkflow() {
      return {
        createRun: () =>
          Promise.resolve({
            startAsync: ({
              inputData,
            }: {
              inputData: Record<string, unknown>;
            }) => {
              capturedInputData = inputData;
              return Promise.resolve({ status: "success" });
            },
            resumeAsync: () => Promise.resolve({ status: "success" }),
          }),
      };
    }
  },
}));

const { initCommand } = await import("../../src/commands/init.js");

const func = (await initCommand.loader()) as (
  this: {
    cwd: string;
    stdout: { write: () => boolean };
    stderr: { write: () => boolean };
    stdin: typeof process.stdin;
  },
  flags: Record<string, unknown>,
  directory?: string
) => Promise<void>;

function makeContext(cwd = "/projects/app") {
  return {
    cwd,
    stdout: { write: () => true },
    stderr: { write: () => true },
    stdin: process.stdin,
  };
}

beforeEach(() => {
  capturedInputData = undefined;
});

describe("init command func", () => {
  describe("features parsing", () => {
    test("splits comma-separated features", async () => {
      const ctx = makeContext();
      await func.call(ctx, {
        force: false,
        yes: true,
        "dry-run": false,
        features: "errors,tracing,logs",
      });

      expect(capturedInputData?.features).toEqual([
        "errors",
        "tracing",
        "logs",
      ]);
    });

    test("trims whitespace from features", async () => {
      const ctx = makeContext();
      await func.call(ctx, {
        force: false,
        yes: true,
        "dry-run": false,
        features: " errors , tracing ",
      });

      expect(capturedInputData?.features).toEqual(["errors", "tracing"]);
    });

    test("filters empty segments", async () => {
      const ctx = makeContext();
      await func.call(ctx, {
        force: false,
        yes: true,
        "dry-run": false,
        features: "errors,,tracing,",
      });

      expect(capturedInputData?.features).toEqual(["errors", "tracing"]);
    });

    test("passes undefined when features not provided", async () => {
      const ctx = makeContext();
      await func.call(ctx, {
        force: false,
        yes: true,
        "dry-run": false,
      });

      expect(capturedInputData?.features).toBeUndefined();
    });
  });

  describe("directory resolution", () => {
    test("defaults to cwd when no directory provided", async () => {
      const ctx = makeContext("/projects/app");
      await func.call(ctx, {
        force: false,
        yes: true,
        "dry-run": false,
      });

      expect(capturedInputData?.directory).toBe("/projects/app");
    });

    test("resolves relative directory against cwd", async () => {
      const ctx = makeContext("/projects/app");
      await func.call(
        ctx,
        {
          force: false,
          yes: true,
          "dry-run": false,
        },
        "sub/dir"
      );

      expect(capturedInputData?.directory).toBe(
        path.resolve("/projects/app", "sub/dir")
      );
    });
  });

  describe("flag forwarding", () => {
    test("forwards force, yes, and dry-run flags", async () => {
      const ctx = makeContext();
      await func.call(ctx, {
        force: true,
        yes: true,
        "dry-run": true,
      });

      expect(capturedInputData?.force).toBe(true);
      expect(capturedInputData?.yes).toBe(true);
      expect(capturedInputData?.dryRun).toBe(true);
    });
  });
});
