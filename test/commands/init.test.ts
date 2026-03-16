/**
 * Tests for the `sentry init` command entry point.
 *
 * Uses spyOn on the wizard-runner namespace to capture runWizard calls
 * without mock.module (which leaks across test files).
 */

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import path from "node:path";
import { initCommand } from "../../src/commands/init.js";
import { ContextError } from "../../src/lib/errors.js";
// biome-ignore lint/performance/noNamespaceImport: spyOn requires object reference
import * as wizardRunner from "../../src/lib/init/wizard-runner.js";

// ── Spy on runWizard to capture call args ─────────────────────────────────
let capturedArgs: Record<string, unknown> | undefined;
let runWizardSpy: ReturnType<typeof spyOn>;

const func = (await initCommand.loader()) as unknown as (
  this: {
    cwd: string;
    stdout: { write: () => boolean };
    stderr: { write: () => boolean };
    stdin: typeof process.stdin;
  },
  flags: Record<string, unknown>,
  target?: string
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
  runWizardSpy = spyOn(wizardRunner, "runWizard").mockImplementation(
    (args: Record<string, unknown>) => {
      capturedArgs = args;
      return Promise.resolve();
    }
  );
});

afterEach(() => {
  runWizardSpy.mockRestore();
});

describe("init command func", () => {
  describe("features parsing", () => {
    test("splits comma-separated features", async () => {
      const ctx = makeContext();
      await func.call(ctx, {
        yes: true,
        "dry-run": false,
        features: ["errors,tracing,logs"],
      });

      expect(capturedArgs?.features).toEqual(["errors", "tracing", "logs"]);
    });

    test("splits plus-separated features", async () => {
      const ctx = makeContext();
      await func.call(ctx, {
        yes: true,
        "dry-run": false,
        features: ["errors+tracing+logs"],
      });

      expect(capturedArgs?.features).toEqual(["errors", "tracing", "logs"]);
    });

    test("splits space-separated features", async () => {
      const ctx = makeContext();
      await func.call(ctx, {
        yes: true,
        "dry-run": false,
        features: ["errors tracing logs"],
      });

      expect(capturedArgs?.features).toEqual(["errors", "tracing", "logs"]);
    });

    test("merges multiple --features flags", async () => {
      const ctx = makeContext();
      await func.call(ctx, {
        yes: true,
        "dry-run": false,
        features: ["errors,tracing", "logs"],
      });

      expect(capturedArgs?.features).toEqual(["errors", "tracing", "logs"]);
    });

    test("trims whitespace from features", async () => {
      const ctx = makeContext();
      await func.call(ctx, {
        yes: true,
        "dry-run": false,
        features: [" errors , tracing "],
      });

      expect(capturedArgs?.features).toEqual(["errors", "tracing"]);
    });

    test("filters empty segments", async () => {
      const ctx = makeContext();
      await func.call(ctx, {
        yes: true,
        "dry-run": false,
        features: ["errors,,tracing,"],
      });

      expect(capturedArgs?.features).toEqual(["errors", "tracing"]);
    });

    test("passes undefined when features not provided", async () => {
      const ctx = makeContext();
      await func.call(ctx, {
        yes: true,
        "dry-run": false,
      });

      expect(capturedArgs?.features).toBeUndefined();
    });
  });

  describe("directory resolution", () => {
    test("defaults to cwd when no --directory flag provided", async () => {
      const ctx = makeContext("/projects/app");
      await func.call(ctx, {
        yes: true,
        "dry-run": false,
      });

      expect(capturedArgs?.directory).toBe("/projects/app");
    });

    test("resolves relative --directory flag against cwd", async () => {
      const ctx = makeContext("/projects/app");
      await func.call(ctx, {
        yes: true,
        "dry-run": false,
        directory: "sub/dir",
      });

      expect(capturedArgs?.directory).toBe(
        path.resolve("/projects/app", "sub/dir")
      );
    });
  });

  describe("flag forwarding", () => {
    test("forwards yes and dry-run flags", async () => {
      const ctx = makeContext();
      await func.call(ctx, {
        yes: true,
        "dry-run": true,
      });

      expect(capturedArgs?.yes).toBe(true);
      expect(capturedArgs?.dryRun).toBe(true);
    });
  });

  describe("org/project parsing", () => {
    test("passes undefined org/project when no target provided", async () => {
      const ctx = makeContext();
      await func.call(ctx, {
        yes: true,
        "dry-run": false,
      });

      expect(capturedArgs?.org).toBeUndefined();
      expect(capturedArgs?.project).toBeUndefined();
    });

    test("parses org/project from explicit target", async () => {
      const ctx = makeContext();
      await func.call(
        ctx,
        {
          yes: true,
          "dry-run": false,
        },
        "acme/my-app"
      );

      expect(capturedArgs?.org).toBe("acme");
      expect(capturedArgs?.project).toBe("my-app");
    });

    test("throws on bare string (ambiguous — could be org or project)", async () => {
      const ctx = makeContext();
      expect(
        func.call(
          ctx,
          {
            yes: true,
            "dry-run": false,
          },
          "acme"
        )
      ).rejects.toThrow(ContextError);
    });

    test("parses org/ as org-only (no project override)", async () => {
      const ctx = makeContext();
      await func.call(
        ctx,
        {
          yes: true,
          "dry-run": false,
        },
        "acme/"
      );

      expect(capturedArgs?.org).toBe("acme");
      expect(capturedArgs?.project).toBeUndefined();
    });

    test("combines target with --directory flag", async () => {
      const ctx = makeContext("/projects/app");
      await func.call(
        ctx,
        {
          yes: true,
          "dry-run": false,
          directory: "sub/dir",
        },
        "acme/my-app"
      );

      expect(capturedArgs?.org).toBe("acme");
      expect(capturedArgs?.project).toBe("my-app");
      expect(capturedArgs?.directory).toBe(
        path.resolve("/projects/app", "sub/dir")
      );
    });

    test("forwards team flag alongside org/project", async () => {
      const ctx = makeContext();
      await func.call(
        ctx,
        {
          yes: true,
          "dry-run": false,
          team: "backend",
        },
        "acme/my-app"
      );

      expect(capturedArgs?.org).toBe("acme");
      expect(capturedArgs?.project).toBe("my-app");
      expect(capturedArgs?.team).toBe("backend");
    });

    test("rejects org slug with invalid characters", async () => {
      const ctx = makeContext();
      expect(
        func.call(
          ctx,
          {
            yes: true,
            "dry-run": false,
          },
          "acme corp/"
        )
      ).rejects.toThrow();
    });

    test("error message for bare string includes disambiguation hint", async () => {
      const ctx = makeContext();
      try {
        await func.call(
          ctx,
          {
            yes: true,
            "dry-run": false,
          },
          "myorg"
        );
        expect.unreachable("should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(ContextError);
        const msg = (error as ContextError).message;
        expect(msg).toContain("myorg/");
        expect(msg).toContain("myorg/<project>");
      }
    });
  });
});
