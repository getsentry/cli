/**
 * Tests for the `sentry init` command entry point.
 *
 * Uses spyOn on the wizard-runner and resolve-target namespaces to
 * capture runWizard calls and mock resolveProjectBySlug without
 * mock.module (which leaks across test files).
 */

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import path from "node:path";
import { initCommand } from "../../src/commands/init.js";
import { ContextError } from "../../src/lib/errors.js";
// biome-ignore lint/performance/noNamespaceImport: spyOn requires object reference
import * as wizardRunner from "../../src/lib/init/wizard-runner.js";
// biome-ignore lint/performance/noNamespaceImport: spyOn requires object reference
import * as resolveTarget from "../../src/lib/resolve-target.js";

// ── Spy setup ─────────────────────────────────────────────────────────────
let capturedArgs: Record<string, unknown> | undefined;
let runWizardSpy: ReturnType<typeof spyOn>;
let resolveProjectSpy: ReturnType<typeof spyOn>;

const func = (await initCommand.loader()) as unknown as (
  this: {
    cwd: string;
    stdout: { write: () => boolean };
    stderr: { write: () => boolean };
    stdin: typeof process.stdin;
  },
  flags: Record<string, unknown>,
  first?: string,
  second?: string
) => Promise<void>;

function makeContext(cwd = "/projects/app") {
  return {
    cwd,
    stdout: { write: () => true },
    stderr: { write: () => true },
    stdin: process.stdin,
  };
}

const DEFAULT_FLAGS = { yes: true, "dry-run": false } as const;

beforeEach(() => {
  capturedArgs = undefined;
  runWizardSpy = spyOn(wizardRunner, "runWizard").mockImplementation(
    (args: Record<string, unknown>) => {
      capturedArgs = args;
      return Promise.resolve();
    }
  );
  // Default: mock resolveProjectBySlug to return a match
  resolveProjectSpy = spyOn(
    resolveTarget,
    "resolveProjectBySlug"
  ).mockImplementation(async (slug: string) => ({
    org: "resolved-org",
    project: slug,
  }));
});

afterEach(() => {
  runWizardSpy.mockRestore();
  resolveProjectSpy.mockRestore();
});

describe("init command func", () => {
  // ── Features parsing ──────────────────────────────────────────────────

  describe("features parsing", () => {
    test("splits comma-separated features", async () => {
      const ctx = makeContext();
      await func.call(ctx, {
        ...DEFAULT_FLAGS,
        features: ["errors,tracing,logs"],
      });
      expect(capturedArgs?.features).toEqual(["errors", "tracing", "logs"]);
    });

    test("splits plus-separated features", async () => {
      const ctx = makeContext();
      await func.call(ctx, {
        ...DEFAULT_FLAGS,
        features: ["errors+tracing+logs"],
      });
      expect(capturedArgs?.features).toEqual(["errors", "tracing", "logs"]);
    });

    test("splits space-separated features", async () => {
      const ctx = makeContext();
      await func.call(ctx, {
        ...DEFAULT_FLAGS,
        features: ["errors tracing logs"],
      });
      expect(capturedArgs?.features).toEqual(["errors", "tracing", "logs"]);
    });

    test("merges multiple --features flags", async () => {
      const ctx = makeContext();
      await func.call(ctx, {
        ...DEFAULT_FLAGS,
        features: ["errors,tracing", "logs"],
      });
      expect(capturedArgs?.features).toEqual(["errors", "tracing", "logs"]);
    });

    test("trims whitespace from features", async () => {
      const ctx = makeContext();
      await func.call(ctx, {
        ...DEFAULT_FLAGS,
        features: [" errors , tracing "],
      });
      expect(capturedArgs?.features).toEqual(["errors", "tracing"]);
    });

    test("filters empty segments", async () => {
      const ctx = makeContext();
      await func.call(ctx, {
        ...DEFAULT_FLAGS,
        features: ["errors,,tracing,"],
      });
      expect(capturedArgs?.features).toEqual(["errors", "tracing"]);
    });

    test("passes undefined when features not provided", async () => {
      const ctx = makeContext();
      await func.call(ctx, DEFAULT_FLAGS);
      expect(capturedArgs?.features).toBeUndefined();
    });
  });

  // ── No arguments ──────────────────────────────────────────────────────

  describe("no arguments", () => {
    test("defaults to cwd with auto-detect", async () => {
      const ctx = makeContext("/projects/app");
      await func.call(ctx, DEFAULT_FLAGS);
      expect(capturedArgs?.directory).toBe("/projects/app");
      expect(capturedArgs?.org).toBeUndefined();
      expect(capturedArgs?.project).toBeUndefined();
    });
  });

  // ── Single path argument ──────────────────────────────────────────────

  describe("single path argument", () => {
    test(". resolves to cwd", async () => {
      const ctx = makeContext("/projects/app");
      await func.call(ctx, DEFAULT_FLAGS, ".");
      expect(capturedArgs?.directory).toBe(path.resolve("/projects/app", "."));
      expect(capturedArgs?.org).toBeUndefined();
      expect(capturedArgs?.project).toBeUndefined();
    });

    test("./subdir resolves relative to cwd", async () => {
      const ctx = makeContext("/projects/app");
      await func.call(ctx, DEFAULT_FLAGS, "./subdir");
      expect(capturedArgs?.directory).toBe(
        path.resolve("/projects/app", "./subdir")
      );
      expect(capturedArgs?.org).toBeUndefined();
    });

    test("../other resolves relative to cwd", async () => {
      const ctx = makeContext("/projects/app");
      await func.call(ctx, DEFAULT_FLAGS, "../other");
      expect(capturedArgs?.directory).toBe(
        path.resolve("/projects/app", "../other")
      );
      expect(capturedArgs?.org).toBeUndefined();
    });

    test("/absolute/path used as-is", async () => {
      const ctx = makeContext("/projects/app");
      await func.call(ctx, DEFAULT_FLAGS, "/absolute/path");
      expect(capturedArgs?.directory).toBe("/absolute/path");
      expect(capturedArgs?.org).toBeUndefined();
    });

    test("~/path treated as literal path (no shell expansion)", async () => {
      const ctx = makeContext("/projects/app");
      await func.call(ctx, DEFAULT_FLAGS, "~/projects/other");
      expect(capturedArgs?.directory).toBe(
        path.resolve("/projects/app", "~/projects/other")
      );
      expect(capturedArgs?.org).toBeUndefined();
    });
  });

  // ── Single target argument ────────────────────────────────────────────

  describe("single target argument", () => {
    test("org/ sets explicit org, dir = cwd", async () => {
      const ctx = makeContext("/projects/app");
      await func.call(ctx, DEFAULT_FLAGS, "acme/");
      expect(capturedArgs?.org).toBe("acme");
      expect(capturedArgs?.project).toBeUndefined();
      expect(capturedArgs?.directory).toBe("/projects/app");
    });

    test("org/project sets both, dir = cwd", async () => {
      const ctx = makeContext("/projects/app");
      await func.call(ctx, DEFAULT_FLAGS, "acme/my-app");
      expect(capturedArgs?.org).toBe("acme");
      expect(capturedArgs?.project).toBe("my-app");
      expect(capturedArgs?.directory).toBe("/projects/app");
    });

    test("bare slug resolves project via resolveProjectBySlug", async () => {
      const ctx = makeContext("/projects/app");
      await func.call(ctx, DEFAULT_FLAGS, "my-app");
      expect(resolveProjectSpy).toHaveBeenCalledWith(
        "my-app",
        expect.any(String),
        expect.any(String)
      );
      expect(capturedArgs?.org).toBe("resolved-org");
      expect(capturedArgs?.project).toBe("my-app");
      expect(capturedArgs?.directory).toBe("/projects/app");
    });
  });

  // ── Two arguments: target + directory ─────────────────────────────────

  describe("two arguments (target + directory)", () => {
    test("org/ + path", async () => {
      const ctx = makeContext("/projects/app");
      await func.call(ctx, DEFAULT_FLAGS, "acme/", "./subdir");
      expect(capturedArgs?.org).toBe("acme");
      expect(capturedArgs?.project).toBeUndefined();
      expect(capturedArgs?.directory).toBe(
        path.resolve("/projects/app", "./subdir")
      );
    });

    test("org/project + path", async () => {
      const ctx = makeContext("/projects/app");
      await func.call(ctx, DEFAULT_FLAGS, "acme/my-app", "./subdir");
      expect(capturedArgs?.org).toBe("acme");
      expect(capturedArgs?.project).toBe("my-app");
      expect(capturedArgs?.directory).toBe(
        path.resolve("/projects/app", "./subdir")
      );
    });

    test("bare slug + path", async () => {
      const ctx = makeContext("/projects/app");
      await func.call(ctx, DEFAULT_FLAGS, "my-app", "./subdir");
      expect(resolveProjectSpy).toHaveBeenCalled();
      expect(capturedArgs?.org).toBe("resolved-org");
      expect(capturedArgs?.project).toBe("my-app");
      expect(capturedArgs?.directory).toBe(
        path.resolve("/projects/app", "./subdir")
      );
    });
  });

  // ── Swapped arguments ─────────────────────────────────────────────────

  describe("swapped arguments (path first, target second)", () => {
    test(". org/ swaps with warning", async () => {
      const ctx = makeContext("/projects/app");
      await func.call(ctx, DEFAULT_FLAGS, ".", "acme/");
      expect(capturedArgs?.org).toBe("acme");
      expect(capturedArgs?.project).toBeUndefined();
      expect(capturedArgs?.directory).toBe(path.resolve("/projects/app", "."));
    });

    test("./subdir org/project swaps with warning", async () => {
      const ctx = makeContext("/projects/app");
      await func.call(ctx, DEFAULT_FLAGS, "./subdir", "acme/my-app");
      expect(capturedArgs?.org).toBe("acme");
      expect(capturedArgs?.project).toBe("my-app");
      expect(capturedArgs?.directory).toBe(
        path.resolve("/projects/app", "./subdir")
      );
    });
  });

  // ── Error cases ───────────────────────────────────────────────────────

  describe("error cases", () => {
    test("two paths throws ContextError", async () => {
      const ctx = makeContext();
      expect(func.call(ctx, DEFAULT_FLAGS, "./dir1", "./dir2")).rejects.toThrow(
        ContextError
      );
    });

    test("two targets throws ContextError", async () => {
      const ctx = makeContext();
      expect(func.call(ctx, DEFAULT_FLAGS, "acme/", "other/")).rejects.toThrow(
        ContextError
      );
    });

    test("invalid org slug (whitespace) throws", async () => {
      const ctx = makeContext();
      expect(func.call(ctx, DEFAULT_FLAGS, "acme corp/")).rejects.toThrow();
    });
  });

  // ── Flag forwarding ───────────────────────────────────────────────────

  describe("flag forwarding", () => {
    test("forwards yes and dry-run flags", async () => {
      const ctx = makeContext();
      await func.call(ctx, { yes: true, "dry-run": true });
      expect(capturedArgs?.yes).toBe(true);
      expect(capturedArgs?.dryRun).toBe(true);
    });

    test("forwards team flag alongside org/project", async () => {
      const ctx = makeContext();
      await func.call(
        ctx,
        { ...DEFAULT_FLAGS, team: "backend" },
        "acme/my-app"
      );
      expect(capturedArgs?.org).toBe("acme");
      expect(capturedArgs?.project).toBe("my-app");
      expect(capturedArgs?.team).toBe("backend");
    });
  });
});
