/**
 * Tests for the `sentry init` command entry point.
 *
 * Mocks only wizard-runner.js to break the circular import chain
 * (init.ts → wizard-runner.js → help.js → app.ts → init.ts)
 * and capture the arguments passed to runWizard.
 */

import { beforeEach, describe, expect, mock, test } from "bun:test";
import path from "node:path";

// ── Mock wizard-runner to capture runWizard call args ─────────────────────
let capturedArgs: Record<string, unknown> | undefined;

mock.module("../../src/lib/init/wizard-runner.js", () => ({
  runWizard: mock((args: Record<string, unknown>) => {
    capturedArgs = args;
    return Promise.resolve();
  }),
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
  capturedArgs = undefined;
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

      expect(capturedArgs?.features).toEqual(["errors", "tracing", "logs"]);
    });

    test("trims whitespace from features", async () => {
      const ctx = makeContext();
      await func.call(ctx, {
        force: false,
        yes: true,
        "dry-run": false,
        features: " errors , tracing ",
      });

      expect(capturedArgs?.features).toEqual(["errors", "tracing"]);
    });

    test("filters empty segments", async () => {
      const ctx = makeContext();
      await func.call(ctx, {
        force: false,
        yes: true,
        "dry-run": false,
        features: "errors,,tracing,",
      });

      expect(capturedArgs?.features).toEqual(["errors", "tracing"]);
    });

    test("passes undefined when features not provided", async () => {
      const ctx = makeContext();
      await func.call(ctx, {
        force: false,
        yes: true,
        "dry-run": false,
      });

      expect(capturedArgs?.features).toBeUndefined();
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

      expect(capturedArgs?.directory).toBe("/projects/app");
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

      expect(capturedArgs?.directory).toBe(
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

      expect(capturedArgs?.force).toBe(true);
      expect(capturedArgs?.yes).toBe(true);
      expect(capturedArgs?.dryRun).toBe(true);
    });
  });
});
