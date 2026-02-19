/**
 * Profile List Command Tests
 *
 * Tests for the listCommand in src/commands/profile/list.ts.
 * Uses spyOn mocking for API calls and a mock SentryContext.
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
import { listCommand } from "../../../src/commands/profile/list.js";
import type { ProjectWithOrg } from "../../../src/lib/api-client.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as apiClient from "../../../src/lib/api-client.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as browser from "../../../src/lib/browser.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as transactionAliasesDb from "../../../src/lib/db/transaction-aliases.js";
import { ContextError, ValidationError } from "../../../src/lib/errors.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as resolveTarget from "../../../src/lib/resolve-target.js";

/** Captured stdout output */
type MockContext = {
  stdout: { write: ReturnType<typeof mock> };
  cwd: string;
  setContext: ReturnType<typeof mock>;
};

function createMockContext(): MockContext {
  return {
    stdout: { write: mock(() => true) },
    cwd: "/tmp/test",
    setContext: mock(() => true),
  };
}

/** Collect all written output as a single string */
function getOutput(ctx: MockContext): string {
  return ctx.stdout.write.mock.calls.map((c) => c[0]).join("");
}

/** Default flags */
const defaultFlags = {
  period: "24h",
  limit: 20,
  json: false,
  web: false,
};

// Spies
let resolveOrgAndProjectSpy: ReturnType<typeof spyOn>;
let getProjectSpy: ReturnType<typeof spyOn>;
let listProfiledTransactionsSpy: ReturnType<typeof spyOn>;
let findProjectsBySlugSpy: ReturnType<typeof spyOn>;
let openInBrowserSpy: ReturnType<typeof spyOn>;
let setTransactionAliasesSpy: ReturnType<typeof spyOn>;

beforeEach(() => {
  resolveOrgAndProjectSpy = spyOn(resolveTarget, "resolveOrgAndProject");
  getProjectSpy = spyOn(apiClient, "getProject");
  listProfiledTransactionsSpy = spyOn(apiClient, "listProfiledTransactions");
  findProjectsBySlugSpy = spyOn(apiClient, "findProjectsBySlug");
  openInBrowserSpy = spyOn(browser, "openInBrowser");
  setTransactionAliasesSpy = spyOn(
    transactionAliasesDb,
    "setTransactionAliases"
  );
});

afterEach(() => {
  resolveOrgAndProjectSpy.mockRestore();
  getProjectSpy.mockRestore();
  listProfiledTransactionsSpy.mockRestore();
  findProjectsBySlugSpy.mockRestore();
  openInBrowserSpy.mockRestore();
  setTransactionAliasesSpy.mockRestore();
});

/** Helper: set up default resolved target and project */
function setupResolvedTarget(
  overrides?: Partial<{ org: string; project: string; detectedFrom: string }>
) {
  const target = {
    org: overrides?.org ?? "my-org",
    project: overrides?.project ?? "backend",
    detectedFrom: overrides?.detectedFrom,
  };
  resolveOrgAndProjectSpy.mockResolvedValue(target);
  getProjectSpy.mockResolvedValue({
    id: "12345",
    slug: target.project,
    name: "Backend",
  });
  return target;
}

/**
 * Load the actual function from Stricli's lazy loader.
 * At runtime, loader() always returns the function, but the TypeScript
 * type is a union of CommandModule | CommandFunction. We cast since
 * we only use .call() in tests.
 */
async function loadListFunc(): Promise<(...args: any[]) => any> {
  return (await listCommand.loader()) as (...args: any[]) => any;
}

describe("listCommand.func", () => {
  describe("target resolution", () => {
    test("throws ContextError for org-all target (org/)", async () => {
      const ctx = createMockContext();
      const func = await loadListFunc();

      await expect(func.call(ctx, defaultFlags, "my-org/")).rejects.toThrow(
        ContextError
      );
    });

    test("org-all error mentions specific project requirement", async () => {
      const ctx = createMockContext();
      const func = await loadListFunc();

      try {
        await func.call(ctx, defaultFlags, "my-org/");
        expect.unreachable("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(ContextError);
        expect((error as ContextError).message).toContain("Project");
      }
    });

    test("throws ContextError when resolveOrgAndProject returns null", async () => {
      const ctx = createMockContext();
      resolveOrgAndProjectSpy.mockResolvedValue(null);
      const func = await loadListFunc();

      await expect(func.call(ctx, defaultFlags)).rejects.toThrow(ContextError);
    });

    test("resolves explicit org/project target directly", async () => {
      const ctx = createMockContext();
      getProjectSpy.mockResolvedValue({
        id: "12345",
        slug: "backend",
        name: "Backend",
      });
      listProfiledTransactionsSpy.mockResolvedValue({ data: [] });
      const func = await loadListFunc();

      await func.call(ctx, defaultFlags, "my-org/backend");

      // Explicit targets skip resolveOrgAndProject and use parsed values directly
      expect(resolveOrgAndProjectSpy).not.toHaveBeenCalled();
      expect(ctx.setContext).toHaveBeenCalledWith(["my-org"], ["backend"]);
    });

    test("resolves project-only target via findProjectsBySlug", async () => {
      const ctx = createMockContext();
      findProjectsBySlugSpy.mockResolvedValue([
        {
          slug: "backend",
          id: "42",
          name: "Backend",
          orgSlug: "my-org",
        },
      ] as ProjectWithOrg[]);
      getProjectSpy.mockResolvedValue({
        id: "12345",
        slug: "backend",
        name: "Backend",
      });
      listProfiledTransactionsSpy.mockResolvedValue({ data: [] });
      const func = await loadListFunc();

      await func.call(ctx, defaultFlags, "backend");

      expect(findProjectsBySlugSpy).toHaveBeenCalledWith("backend");
      // Should NOT call resolveOrgAndProject for project-search
      expect(resolveOrgAndProjectSpy).not.toHaveBeenCalled();
    });

    test("throws ContextError when project-only search finds nothing", async () => {
      const ctx = createMockContext();
      findProjectsBySlugSpy.mockResolvedValue([]);
      const func = await loadListFunc();

      await expect(func.call(ctx, defaultFlags, "nonexistent")).rejects.toThrow(
        ContextError
      );
    });

    test("throws ValidationError when project-only search finds multiple orgs", async () => {
      const ctx = createMockContext();
      findProjectsBySlugSpy.mockResolvedValue([
        { slug: "backend", id: "1", name: "Backend", orgSlug: "org-a" },
        { slug: "backend", id: "2", name: "Backend", orgSlug: "org-b" },
      ] as ProjectWithOrg[]);
      const func = await loadListFunc();

      await expect(func.call(ctx, defaultFlags, "backend")).rejects.toThrow(
        ValidationError
      );
    });

    test("auto-detect target when no positional arg", async () => {
      const ctx = createMockContext();
      setupResolvedTarget();
      listProfiledTransactionsSpy.mockResolvedValue({ data: [] });
      const func = await loadListFunc();

      await func.call(ctx, defaultFlags);

      expect(resolveOrgAndProjectSpy).toHaveBeenCalled();
    });

    test("sets telemetry context after resolution", async () => {
      const ctx = createMockContext();
      setupResolvedTarget();
      listProfiledTransactionsSpy.mockResolvedValue({ data: [] });
      const func = await loadListFunc();

      await func.call(ctx, defaultFlags, "my-org/backend");

      expect(ctx.setContext).toHaveBeenCalledWith(["my-org"], ["backend"]);
    });
  });

  describe("--web flag", () => {
    test("opens browser and returns early", async () => {
      const ctx = createMockContext();
      setupResolvedTarget();
      openInBrowserSpy.mockResolvedValue(undefined);
      const func = await loadListFunc();

      await func.call(ctx, { ...defaultFlags, web: true }, "my-org/backend");

      expect(openInBrowserSpy).toHaveBeenCalledWith(
        ctx.stdout,
        expect.stringContaining("/profiling/"),
        "profiling"
      );
      // Should NOT have called listProfiledTransactions
      expect(listProfiledTransactionsSpy).not.toHaveBeenCalled();
    });

    test("passes numeric project ID in profiling URL", async () => {
      const ctx = createMockContext();
      setupResolvedTarget();
      openInBrowserSpy.mockResolvedValue(undefined);
      const func = await loadListFunc();

      await func.call(ctx, { ...defaultFlags, web: true }, "my-org/backend");

      expect(openInBrowserSpy).toHaveBeenCalledWith(
        ctx.stdout,
        expect.stringContaining("project=12345"),
        "profiling"
      );
    });
  });

  describe("--json flag", () => {
    test("outputs JSON and returns", async () => {
      const ctx = createMockContext();
      setupResolvedTarget();
      const mockData = [
        { transaction: "/api/users", "count_unique(timestamp)": 50 },
        { transaction: "/api/events", "count_unique(timestamp)": 30 },
      ];
      listProfiledTransactionsSpy.mockResolvedValue({ data: mockData });
      const func = await loadListFunc();

      await func.call(ctx, { ...defaultFlags, json: true }, "my-org/backend");

      const output = getOutput(ctx);
      const parsed = JSON.parse(output);
      expect(parsed).toEqual(mockData);
    });
  });

  describe("empty state", () => {
    test("shows empty state message when no data", async () => {
      const ctx = createMockContext();
      setupResolvedTarget();
      listProfiledTransactionsSpy.mockResolvedValue({ data: [] });
      const func = await loadListFunc();

      await func.call(ctx, defaultFlags, "my-org/backend");

      const output = getOutput(ctx);
      expect(output).toContain("No profiling data found");
      expect(output).toContain("my-org/backend");
    });
  });

  describe("human-readable output", () => {
    test("renders table with header, rows, and footer", async () => {
      const ctx = createMockContext();
      setupResolvedTarget();
      listProfiledTransactionsSpy.mockResolvedValue({
        data: [
          {
            transaction: "/api/users",
            "count_unique(timestamp)": 150,
            "p75(function.duration)": 8_000_000,
          },
          {
            transaction: "/api/events",
            "count_unique(timestamp)": 75,
            "p75(function.duration)": 15_000_000,
          },
        ],
      });
      const func = await loadListFunc();

      await func.call(ctx, defaultFlags, "my-org/backend");

      const output = getOutput(ctx);
      expect(output).toContain("Transactions with Profiles");
      expect(output).toContain("my-org/backend");
      expect(output).toContain("last 24h");
      // Common prefix "/api/" is stripped, so we see just the segments
      expect(output).toContain("users");
      expect(output).toContain("events");
      expect(output).toContain("sentry profile view");
    });

    test("passes period flag to API", async () => {
      const ctx = createMockContext();
      setupResolvedTarget();
      listProfiledTransactionsSpy.mockResolvedValue({ data: [] });
      const func = await loadListFunc();

      await func.call(ctx, { ...defaultFlags, period: "7d" }, "my-org/backend");

      expect(listProfiledTransactionsSpy).toHaveBeenCalledWith(
        "my-org",
        "12345",
        expect.objectContaining({ statsPeriod: "7d" })
      );
    });

    test("passes limit flag to API", async () => {
      const ctx = createMockContext();
      setupResolvedTarget();
      listProfiledTransactionsSpy.mockResolvedValue({ data: [] });
      const func = await loadListFunc();

      await func.call(ctx, { ...defaultFlags, limit: 5 }, "my-org/backend");

      expect(listProfiledTransactionsSpy).toHaveBeenCalledWith(
        "my-org",
        "12345",
        expect.objectContaining({ limit: 5 })
      );
    });

    test("shows detectedFrom hint when auto-detected", async () => {
      const ctx = createMockContext();
      setupResolvedTarget({ detectedFrom: ".env file" });
      listProfiledTransactionsSpy.mockResolvedValue({
        data: [{ transaction: "/api/users", "count_unique(timestamp)": 10 }],
      });
      const func = await loadListFunc();

      // No target arg → auto-detect path, which returns detectedFrom
      await func.call(ctx, defaultFlags);

      const output = getOutput(ctx);
      expect(output).toContain("Detected from .env file");
    });

    test("does not show detectedFrom for explicit target", async () => {
      const ctx = createMockContext();
      getProjectSpy.mockResolvedValue({
        id: "12345",
        slug: "backend",
        name: "Backend",
      });
      listProfiledTransactionsSpy.mockResolvedValue({
        data: [{ transaction: "/api/users", "count_unique(timestamp)": 10 }],
      });
      const func = await loadListFunc();

      await func.call(ctx, defaultFlags, "my-org/backend");

      const output = getOutput(ctx);
      expect(output).not.toContain("Detected from");
    });
  });

  describe("alias building", () => {
    test("stores transaction aliases in DB", async () => {
      const ctx = createMockContext();
      setupResolvedTarget();
      listProfiledTransactionsSpy.mockResolvedValue({
        data: [
          { transaction: "/api/users", "count_unique(timestamp)": 50 },
          { transaction: "/api/events", "count_unique(timestamp)": 30 },
        ],
      });
      const func = await loadListFunc();

      await func.call(ctx, defaultFlags, "my-org/backend");

      expect(setTransactionAliasesSpy).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ transaction: "/api/users" }),
          expect.objectContaining({ transaction: "/api/events" }),
        ]),
        expect.any(String) // fingerprint
      );
    });

    test("filters out rows with no transaction name", async () => {
      const ctx = createMockContext();
      setupResolvedTarget();
      listProfiledTransactionsSpy.mockResolvedValue({
        data: [
          { transaction: "/api/users", "count_unique(timestamp)": 50 },
          { "count_unique(timestamp)": 30 }, // no transaction name
        ],
      });
      const func = await loadListFunc();

      await func.call(ctx, defaultFlags, "my-org/backend");

      // Aliases should only include the row with a transaction name
      const aliasCall = setTransactionAliasesSpy.mock.calls[0];
      expect(aliasCall).toBeDefined();
      const aliases = aliasCall[0];
      expect(aliases.length).toBe(1);
      expect(aliases[0].transaction).toBe("/api/users");
    });
  });
});
