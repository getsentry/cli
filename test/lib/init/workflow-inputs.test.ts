import { describe, expect, test } from "bun:test";
import path from "node:path";
import {
  precomputeDirListing,
  precomputeProjectContext,
  preReadCommonFiles,
} from "../../../src/lib/init/workflow-inputs.js";

const CLI_ROOT = path.resolve(__dirname, "../../..");

describe("precomputeDirListing", () => {
  test("returns POSIX-normalized entries from a real directory", async () => {
    const entries = await precomputeDirListing(CLI_ROOT);
    expect(Array.isArray(entries)).toBe(true);
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries.slice(0, 50)) {
      expect(typeof entry.path).toBe("string");
      expect(entry.path).not.toContain("\\");
      expect(["file", "directory"]).toContain(entry.type);
    }
  });

  test("respects the depth-3 / 500-entry caps", async () => {
    const entries = await precomputeDirListing(CLI_ROOT);
    expect(entries.length).toBeLessThanOrEqual(500);
    // `path.split('/').length` yields segment count: depth 3 means up
    // to 4 segments (root + 3 nested levels), e.g. a/b/c/d.
    const maxSegments = Math.max(
      ...entries.map((e) => e.path.split("/").length)
    );
    expect(maxSegments).toBeLessThanOrEqual(4);
  });
});

describe("preReadCommonFiles", () => {
  test("reads package.json when present in the listing", async () => {
    const entries = await precomputeDirListing(CLI_ROOT);
    const cache = await preReadCommonFiles(CLI_ROOT, entries);
    expect(cache["package.json"]).toBeTruthy();
    expect(cache["package.json"]).toContain("\"name\"");
  });

  test("ignores files that aren't on the listing", async () => {
    const cache = await preReadCommonFiles(CLI_ROOT, []);
    expect(Object.keys(cache).length).toBe(0);
  });
});

describe("precomputeProjectContext", () => {
  test("returns a populated context for the cli repo", async () => {
    const context = await precomputeProjectContext(CLI_ROOT);
    expect(context.dirListing.length).toBeGreaterThan(0);
    expect(context.configFiles["package.json"]).toBeTruthy();
    expect(["none", "installed"]).toContain(context.existingSentry.status);
    expect(Array.isArray(context.existingSentry.signals)).toBe(true);
  });

  test("returns empty defaults for a missing directory", async () => {
    const context = await precomputeProjectContext(
      "/this/path/definitely/does/not/exist/" + Math.random()
    );
    expect(context.dirListing).toEqual([]);
    expect(context.configFiles).toEqual({});
    expect(context.existingSentry.status).toBe("none");
  });
});
