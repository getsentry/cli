/**
 * Profile View Command Tests
 *
 * Tests for positional argument parsing, project resolution,
 * and command execution in src/commands/profile/view.ts.
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
import {
  parsePositionalArgs,
  viewCommand,
} from "../../../src/commands/profile/view.js";
import type { ProjectWithOrg } from "../../../src/lib/api-client.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as apiClient from "../../../src/lib/api-client.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as browser from "../../../src/lib/browser.js";
import { ContextError, ValidationError } from "../../../src/lib/errors.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as resolveTarget from "../../../src/lib/resolve-target.js";
import { resolveProjectBySlug } from "../../../src/lib/resolve-target.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as resolveTransactionMod from "../../../src/lib/resolve-transaction.js";
import type { Flamegraph } from "../../../src/types/index.js";

describe("parsePositionalArgs", () => {
  describe("single argument (transaction only)", () => {
    test("parses single arg as transaction name", () => {
      const result = parsePositionalArgs(["/api/users"]);
      expect(result.transactionRef).toBe("/api/users");
      expect(result.targetArg).toBeUndefined();
    });

    test("parses transaction index", () => {
      const result = parsePositionalArgs(["1"]);
      expect(result.transactionRef).toBe("1");
      expect(result.targetArg).toBeUndefined();
    });

    test("parses transaction alias", () => {
      const result = parsePositionalArgs(["a"]);
      expect(result.transactionRef).toBe("a");
      expect(result.targetArg).toBeUndefined();
    });

    test("parses complex transaction name", () => {
      const result = parsePositionalArgs(["POST /api/v2/users/:id/settings"]);
      expect(result.transactionRef).toBe("POST /api/v2/users/:id/settings");
      expect(result.targetArg).toBeUndefined();
    });
  });

  describe("two arguments (target + transaction)", () => {
    test("parses org/project target and transaction name", () => {
      const result = parsePositionalArgs(["my-org/backend", "/api/users"]);
      expect(result.targetArg).toBe("my-org/backend");
      expect(result.transactionRef).toBe("/api/users");
    });

    test("parses project-only target and transaction", () => {
      const result = parsePositionalArgs(["backend", "/api/users"]);
      expect(result.targetArg).toBe("backend");
      expect(result.transactionRef).toBe("/api/users");
    });

    test("parses org/ target (all projects) and transaction", () => {
      const result = parsePositionalArgs(["my-org/", "/api/users"]);
      expect(result.targetArg).toBe("my-org/");
      expect(result.transactionRef).toBe("/api/users");
    });

    test("parses target and transaction index", () => {
      const result = parsePositionalArgs(["my-org/backend", "1"]);
      expect(result.targetArg).toBe("my-org/backend");
      expect(result.transactionRef).toBe("1");
    });

    test("parses target and transaction alias", () => {
      const result = parsePositionalArgs(["my-org/backend", "a"]);
      expect(result.targetArg).toBe("my-org/backend");
      expect(result.transactionRef).toBe("a");
    });
  });

  describe("error cases", () => {
    test("throws ContextError for empty args", () => {
      expect(() => parsePositionalArgs([])).toThrow(ContextError);
    });

    test("throws ContextError with usage hint", () => {
      try {
        parsePositionalArgs([]);
        expect.unreachable("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(ContextError);
        expect((error as ContextError).message).toContain("Transaction");
      }
    });
  });

  describe("edge cases", () => {
    test("handles more than two args (ignores extras)", () => {
      const result = parsePositionalArgs([
        "my-org/backend",
        "/api/users",
        "extra-arg",
      ]);
      expect(result.targetArg).toBe("my-org/backend");
      expect(result.transactionRef).toBe("/api/users");
    });

    test("handles empty string transaction in two-arg case", () => {
      const result = parsePositionalArgs(["my-org/backend", ""]);
      expect(result.targetArg).toBe("my-org/backend");
      expect(result.transactionRef).toBe("");
    });
  });
});

// resolveProjectBySlug tests (profile context)

describe("resolveProjectBySlug (profile context)", () => {
  let findProjectsBySlugSpy: ReturnType<typeof spyOn>;

  const USAGE_HINT = "sentry profile view <org>/<project> <transaction>";

  beforeEach(() => {
    findProjectsBySlugSpy = spyOn(apiClient, "findProjectsBySlug");
  });

  afterEach(() => {
    findProjectsBySlugSpy.mockRestore();
  });

  describe("no projects found", () => {
    test("throws ContextError when project not found", async () => {
      findProjectsBySlugSpy.mockResolvedValue([]);

      await expect(
        resolveProjectBySlug("my-project", {
          usageHint: USAGE_HINT,
          contextValue: "/api/users",
        })
      ).rejects.toThrow(ContextError);
    });

    test("includes project name in error message", async () => {
      findProjectsBySlugSpy.mockResolvedValue([]);

      try {
        await resolveProjectBySlug("frontend", {
          usageHint: USAGE_HINT,
          contextValue: "/api/users",
        });
        expect.unreachable("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(ContextError);
        expect((error as ContextError).message).toContain('Project "frontend"');
      }
    });
  });

  describe("multiple projects found", () => {
    test("throws ValidationError when project exists in multiple orgs", async () => {
      findProjectsBySlugSpy.mockResolvedValue([
        {
          slug: "frontend",
          id: "1",
          name: "Frontend",
          orgSlug: "org-a",
        },
        {
          slug: "frontend",
          id: "2",
          name: "Frontend",
          orgSlug: "org-b",
        },
      ] as ProjectWithOrg[]);

      await expect(
        resolveProjectBySlug("frontend", {
          usageHint: USAGE_HINT,
          contextValue: "/api/users",
        })
      ).rejects.toThrow(ValidationError);
    });

    test("includes org alternatives in error", async () => {
      findProjectsBySlugSpy.mockResolvedValue([
        {
          slug: "api",
          id: "1",
          name: "API",
          orgSlug: "acme",
        },
        {
          slug: "api",
          id: "2",
          name: "API",
          orgSlug: "beta",
        },
      ] as ProjectWithOrg[]);

      try {
        await resolveProjectBySlug("api", {
          usageHint: USAGE_HINT,
          contextValue: "/api/users",
        });
        expect.unreachable("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationError);
        const msg = (error as ValidationError).message;
        expect(msg).toContain("multiple organizations");
      }
    });
  });

  describe("single project found", () => {
    test("returns resolved target using orgSlug", async () => {
      findProjectsBySlugSpy.mockResolvedValue([
        {
          slug: "backend",
          id: "42",
          name: "Backend",
          orgSlug: "my-company",
        },
      ] as ProjectWithOrg[]);

      const result = await resolveProjectBySlug("backend", {
        usageHint: USAGE_HINT,
        contextValue: "/api/users",
      });

      expect(result.org).toBe("my-company");
      expect(result.project).toBe("backend");
      expect(result.orgDisplay).toBe("my-company");
      expect(result.projectDisplay).toBe("backend");
    });
  });
});

// viewCommand.func tests

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

function getOutput(ctx: MockContext): string {
  return ctx.stdout.write.mock.calls.map((c) => c[0]).join("");
}

/** Create a minimal flamegraph with profile data */
function createTestFlamegraph(
  overrides?: Partial<{ hasData: boolean }>
): Flamegraph {
  const hasData = overrides?.hasData ?? true;
  return {
    activeProfileIndex: 0,
    platform: "node",
    profiles: hasData
      ? [
          {
            endValue: 1000,
            isMainThread: true,
            name: "main",
            samples: [[0], [0, 1]],
            startValue: 0,
            threadID: 1,
            type: "sampled",
            unit: "nanoseconds",
            weights: [100, 200],
          },
        ]
      : [],
    projectID: 12_345,
    shared: {
      frames: hasData
        ? [
            {
              file: "src/app.ts",
              is_application: true,
              line: 42,
              name: "processRequest",
              fingerprint: 1,
            },
          ]
        : [],
      frame_infos: hasData
        ? [
            {
              count: 100,
              weight: 5000,
              sumDuration: 10_000_000,
              sumSelfTime: 5_000_000,
              p75Duration: 8_000_000,
              p95Duration: 12_000_000,
              p99Duration: 15_000_000,
            },
          ]
        : [],
    },
  };
}

const defaultFlags = {
  period: "24h",
  limit: 10,
  allFrames: false,
  json: false,
  web: false,
};

/**
 * Load the actual function from Stricli's lazy loader.
 * At runtime, loader() always returns the function, but the TypeScript
 * type is a union of CommandModule | CommandFunction. We cast since
 * we only use .call() in tests.
 */
async function loadViewFunc(): Promise<(...args: any[]) => any> {
  return (await viewCommand.loader()) as (...args: any[]) => any;
}

describe("viewCommand.func", () => {
  let resolveOrgAndProjectSpy: ReturnType<typeof spyOn>;
  let getProjectSpy: ReturnType<typeof spyOn>;
  let getFlamegraphSpy: ReturnType<typeof spyOn>;
  let resolveTransactionSpy: ReturnType<typeof spyOn>;
  let openInBrowserSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    resolveOrgAndProjectSpy = spyOn(resolveTarget, "resolveOrgAndProject");
    getProjectSpy = spyOn(apiClient, "getProject");
    getFlamegraphSpy = spyOn(apiClient, "getFlamegraph");
    resolveTransactionSpy = spyOn(resolveTransactionMod, "resolveTransaction");
    openInBrowserSpy = spyOn(browser, "openInBrowser");
  });

  afterEach(() => {
    resolveOrgAndProjectSpy.mockRestore();
    getProjectSpy.mockRestore();
    getFlamegraphSpy.mockRestore();
    resolveTransactionSpy.mockRestore();
    openInBrowserSpy.mockRestore();
  });

  /** Standard setup for a resolved target that goes through the full flow */
  function setupFullFlow(flamegraph?: Flamegraph) {
    resolveOrgAndProjectSpy.mockResolvedValue({
      org: "my-org",
      project: "backend",
    });
    resolveTransactionSpy.mockReturnValue({
      transaction: "/api/users",
      resolvedFrom: "full-name",
    });
    getProjectSpy.mockResolvedValue({
      id: "12345",
      slug: "backend",
      name: "Backend",
    });
    getFlamegraphSpy.mockResolvedValue(
      flamegraph ?? createTestFlamegraph({ hasData: true })
    );
  }

  describe("target resolution", () => {
    test("throws ContextError for org-all target (org/)", async () => {
      const ctx = createMockContext();
      resolveTransactionSpy.mockReturnValue({
        transaction: "/api/users",
        resolvedFrom: "full-name",
      });
      const func = await loadViewFunc();

      await expect(
        func.call(ctx, defaultFlags, "my-org/", "/api/users")
      ).rejects.toThrow(ContextError);
    });

    test("throws ContextError when auto-detect returns null", async () => {
      const ctx = createMockContext();
      resolveOrgAndProjectSpy.mockResolvedValue(null);
      resolveTransactionSpy.mockReturnValue({
        transaction: "/api/users",
        resolvedFrom: "full-name",
      });
      const func = await loadViewFunc();

      await expect(func.call(ctx, defaultFlags, "/api/users")).rejects.toThrow(
        ContextError
      );
    });

    test("resolves explicit org/project target", async () => {
      const ctx = createMockContext();
      setupFullFlow();
      const func = await loadViewFunc();

      await func.call(ctx, defaultFlags, "my-org/backend", "/api/users");

      // Should NOT call resolveOrgAndProject for explicit targets
      expect(resolveOrgAndProjectSpy).not.toHaveBeenCalled();
    });

    test("auto-detects target when only transaction arg given", async () => {
      const ctx = createMockContext();
      setupFullFlow();
      const func = await loadViewFunc();

      await func.call(ctx, defaultFlags, "/api/users");

      expect(resolveOrgAndProjectSpy).toHaveBeenCalled();
    });

    test("sets telemetry context", async () => {
      const ctx = createMockContext();
      setupFullFlow();
      const func = await loadViewFunc();

      await func.call(ctx, defaultFlags, "/api/users");

      expect(ctx.setContext).toHaveBeenCalledWith(["my-org"], ["backend"]);
    });
  });

  describe("--web flag", () => {
    test("opens browser and returns early", async () => {
      const ctx = createMockContext();
      setupFullFlow();
      openInBrowserSpy.mockResolvedValue(undefined);
      const func = await loadViewFunc();

      await func.call(ctx, { ...defaultFlags, web: true }, "/api/users");

      expect(openInBrowserSpy).toHaveBeenCalledWith(
        ctx.stdout,
        expect.stringContaining("/profiling/"),
        "profile"
      );
      // Should NOT fetch flamegraph
      expect(getFlamegraphSpy).not.toHaveBeenCalled();
    });
  });

  describe("no profile data", () => {
    test("shows message when flamegraph has no data", async () => {
      const ctx = createMockContext();
      setupFullFlow(createTestFlamegraph({ hasData: false }));
      const func = await loadViewFunc();

      await func.call(ctx, defaultFlags, "/api/users");

      const output = getOutput(ctx);
      expect(output).toContain("No profiling data found");
      expect(output).toContain("/api/users");
    });
  });

  describe("--json flag", () => {
    test("outputs JSON analysis", async () => {
      const ctx = createMockContext();
      setupFullFlow();
      const func = await loadViewFunc();

      await func.call(ctx, { ...defaultFlags, json: true }, "/api/users");

      const output = getOutput(ctx);
      const parsed = JSON.parse(output);
      expect(parsed.transactionName).toBe("/api/users");
      expect(parsed.platform).toBe("node");
      expect(parsed.percentiles).toBeDefined();
      expect(parsed.hotPaths).toBeDefined();
    });
  });

  describe("human-readable output", () => {
    test("renders profile analysis with hot paths", async () => {
      const ctx = createMockContext();
      setupFullFlow();
      const func = await loadViewFunc();

      await func.call(ctx, defaultFlags, "/api/users");

      const output = getOutput(ctx);
      expect(output).toContain("/api/users");
      expect(output).toContain("CPU Profile Analysis");
      expect(output).toContain("Performance Percentiles");
      expect(output).toContain("Hot Paths");
    });

    test("passes period to getFlamegraph", async () => {
      const ctx = createMockContext();
      setupFullFlow();
      const func = await loadViewFunc();

      await func.call(ctx, { ...defaultFlags, period: "7d" }, "/api/users");

      expect(getFlamegraphSpy).toHaveBeenCalledWith(
        "my-org",
        "12345",
        "/api/users",
        "7d"
      );
    });

    test("respects --all-frames flag", async () => {
      const ctx = createMockContext();
      setupFullFlow();
      const func = await loadViewFunc();

      await func.call(ctx, { ...defaultFlags, allFrames: true }, "/api/users");

      const output = getOutput(ctx);
      // With allFrames, should NOT show "user code only"
      expect(output).not.toContain("user code only");
    });

    test("shows detectedFrom when present", async () => {
      const ctx = createMockContext();
      resolveOrgAndProjectSpy.mockResolvedValue({
        org: "my-org",
        project: "backend",
        detectedFrom: ".env file",
      });
      resolveTransactionSpy.mockReturnValue({
        transaction: "/api/users",
        resolvedFrom: "full-name",
      });
      getProjectSpy.mockResolvedValue({
        id: "12345",
        slug: "backend",
        name: "Backend",
      });
      getFlamegraphSpy.mockResolvedValue(
        createTestFlamegraph({ hasData: true })
      );
      const func = await loadViewFunc();

      await func.call(ctx, defaultFlags, "/api/users");

      const output = getOutput(ctx);
      expect(output).toContain("Detected from .env file");
    });

    test("clamps limit to 1-20 range", async () => {
      const ctx = createMockContext();
      setupFullFlow();
      const func = await loadViewFunc();

      // limit: 50 should be clamped to 20
      await func.call(ctx, { ...defaultFlags, limit: 50 }, "/api/users");

      // The output should render without error
      const output = getOutput(ctx);
      expect(output).toContain("Hot Paths");
    });
  });
});
