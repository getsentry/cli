/**
 * Transaction Resolver Tests
 *
 * Tests for resolving transaction references (numbers, aliases, full names)
 * to full transaction names for profile commands.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  clearTransactionAliases,
  setTransactionAliases,
} from "../../src/lib/db/transaction-aliases.js";
import { ConfigError } from "../../src/lib/errors.js";
import { resolveTransaction } from "../../src/lib/resolve-transaction.js";
import type { TransactionAliasEntry } from "../../src/types/index.js";
import { cleanupTestDir, createTestConfigDir } from "../helpers.js";

let testConfigDir: string;

beforeEach(async () => {
  testConfigDir = await createTestConfigDir("test-resolve-transaction-");
  process.env.SENTRY_CLI_CONFIG_DIR = testConfigDir;
});

afterEach(async () => {
  delete process.env.SENTRY_CLI_CONFIG_DIR;
  await cleanupTestDir(testConfigDir);
});

const defaultOptions = {
  org: "test-org",
  project: "test-project",
  period: "7d",
};

const setupAliases = () => {
  const fingerprint = "test-org:test-project:7d";
  const aliases: TransactionAliasEntry[] = [
    {
      idx: 1,
      alias: "i",
      transaction: "/api/0/organizations/{org}/issues/",
      orgSlug: "test-org",
      projectSlug: "test-project",
    },
    {
      idx: 2,
      alias: "e",
      transaction: "/api/0/projects/{org}/{proj}/events/",
      orgSlug: "test-org",
      projectSlug: "test-project",
    },
    {
      idx: 3,
      alias: "iu",
      transaction: "/extensions/jira/issue-updated/",
      orgSlug: "test-org",
      projectSlug: "test-project",
    },
  ];
  setTransactionAliases(aliases, fingerprint);
};

// =============================================================================
// Full Transaction Name Pass-Through
// =============================================================================

describe("full transaction name pass-through", () => {
  test("URL paths pass through unchanged", () => {
    const result = resolveTransaction(
      "/api/0/organizations/{org}/issues/",
      defaultOptions
    );

    expect(result.transaction).toBe("/api/0/organizations/{org}/issues/");
    expect(result.orgSlug).toBe("test-org");
    expect(result.projectSlug).toBe("test-project");
  });

  test("dotted task names pass through unchanged", () => {
    const result = resolveTransaction(
      "tasks.sentry.process_event",
      defaultOptions
    );

    expect(result.transaction).toBe("tasks.sentry.process_event");
    expect(result.orgSlug).toBe("test-org");
    expect(result.projectSlug).toBe("test-project");
  });

  test("uses empty string for project when null", () => {
    const result = resolveTransaction("/api/test/", {
      ...defaultOptions,
      project: null,
    });

    expect(result.projectSlug).toBe("");
  });

  test("underscored bare names pass through unchanged", () => {
    const result = resolveTransaction("process_request", defaultOptions);
    expect(result.transaction).toBe("process_request");
  });

  test("hyphenated bare names pass through unchanged", () => {
    const result = resolveTransaction("handle-webhook", defaultOptions);
    expect(result.transaction).toBe("handle-webhook");
  });

  test("uppercase bare names pass through unchanged", () => {
    const result = resolveTransaction("GET /users", defaultOptions);
    expect(result.transaction).toBe("GET /users");
  });

  test("mixed-case bare names pass through unchanged", () => {
    const result = resolveTransaction("ProcessEvent", defaultOptions);
    expect(result.transaction).toBe("ProcessEvent");
  });

  test("names with spaces pass through unchanged", () => {
    const result = resolveTransaction(
      "send email notification",
      defaultOptions
    );
    expect(result.transaction).toBe("send email notification");
  });

  test("names with colons pass through unchanged", () => {
    const result = resolveTransaction("worker:process_job", defaultOptions);
    expect(result.transaction).toBe("worker:process_job");
  });
});

// =============================================================================
// Numeric Index Resolution
// =============================================================================

describe("numeric index resolution", () => {
  beforeEach(() => {
    setupAliases();
  });

  test("resolves valid index to transaction", () => {
    const result = resolveTransaction("1", defaultOptions);

    expect(result.transaction).toBe("/api/0/organizations/{org}/issues/");
    expect(result.orgSlug).toBe("test-org");
    expect(result.projectSlug).toBe("test-project");
  });

  test("resolves different indices", () => {
    const r1 = resolveTransaction("1", defaultOptions);
    const r2 = resolveTransaction("2", defaultOptions);
    const r3 = resolveTransaction("3", defaultOptions);

    expect(r1.transaction).toBe("/api/0/organizations/{org}/issues/");
    expect(r2.transaction).toBe("/api/0/projects/{org}/{proj}/events/");
    expect(r3.transaction).toBe("/extensions/jira/issue-updated/");
  });

  test("throws ConfigError for unknown index", () => {
    expect(() => resolveTransaction("99", defaultOptions)).toThrow(ConfigError);
  });

  test("error message includes index and suggestion", () => {
    try {
      resolveTransaction("99", defaultOptions);
      expect.unreachable("Should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      const configError = error as ConfigError;
      expect(configError.message).toContain("99");
      expect(configError.message).toContain("index");
      expect(configError.suggestion).toContain("sentry profile list");
    }
  });
});

// =============================================================================
// Alias Resolution
// =============================================================================

describe("alias resolution", () => {
  beforeEach(() => {
    setupAliases();
  });

  test("resolves valid alias to transaction", () => {
    const result = resolveTransaction("i", defaultOptions);

    expect(result.transaction).toBe("/api/0/organizations/{org}/issues/");
  });

  test("resolves multi-character alias", () => {
    const result = resolveTransaction("iu", defaultOptions);

    expect(result.transaction).toBe("/extensions/jira/issue-updated/");
  });

  test("alias lookup is case-insensitive", () => {
    const lower = resolveTransaction("i", defaultOptions);
    const upper = resolveTransaction("I", defaultOptions);

    expect(lower.transaction).toBe(upper.transaction);
  });

  test("throws ConfigError for unknown alias", () => {
    expect(() => resolveTransaction("xyz", defaultOptions)).toThrow(
      ConfigError
    );
  });

  test("error message includes alias and suggestion", () => {
    try {
      resolveTransaction("xyz", defaultOptions);
      expect.unreachable("Should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      const configError = error as ConfigError;
      expect(configError.message).toContain("xyz");
      expect(configError.message).toContain("alias");
      expect(configError.suggestion).toContain("sentry profile list");
    }
  });
});

// =============================================================================
// Stale Alias Detection
// =============================================================================

describe("stale alias detection", () => {
  beforeEach(() => {
    clearTransactionAliases();
  });

  test("detects stale index from different period", () => {
    // Store aliases with 7d period
    const oldFingerprint = "test-org:test-project:7d";
    setTransactionAliases(
      [
        {
          idx: 1,
          alias: "i",
          transaction: "/api/issues/",
          orgSlug: "test-org",
          projectSlug: "test-project",
        },
      ],
      oldFingerprint
    );

    // Try to resolve with 24h period
    try {
      resolveTransaction("1", { ...defaultOptions, period: "24h" });
      expect.unreachable("Should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      const configError = error as ConfigError;
      expect(configError.message).toContain("different time period");
      expect(configError.message).toContain("7d");
      expect(configError.message).toContain("24h");
    }
  });

  test("detects stale alias from different project", () => {
    const oldFingerprint = "test-org:old-project:7d";
    setTransactionAliases(
      [
        {
          idx: 1,
          alias: "issues",
          transaction: "/api/issues/",
          orgSlug: "test-org",
          projectSlug: "old-project",
        },
      ],
      oldFingerprint
    );

    try {
      resolveTransaction("issues", {
        ...defaultOptions,
        project: "new-project",
      });
      expect.unreachable("Should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      const configError = error as ConfigError;
      expect(configError.message).toContain("different project");
    }
  });

  test("detects stale alias from different org", () => {
    const oldFingerprint = "old-org:test-project:7d";
    setTransactionAliases(
      [
        {
          idx: 1,
          alias: "issues",
          transaction: "/api/issues/",
          orgSlug: "old-org",
          projectSlug: "test-project",
        },
      ],
      oldFingerprint
    );

    try {
      resolveTransaction("issues", { ...defaultOptions, org: "new-org" });
      expect.unreachable("Should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      const configError = error as ConfigError;
      expect(configError.message).toContain("different organization");
    }
  });

  test("stale error includes refresh command suggestion", () => {
    const oldFingerprint = "test-org:test-project:7d";
    setTransactionAliases(
      [
        {
          idx: 1,
          alias: "i",
          transaction: "/api/issues/",
          orgSlug: "test-org",
          projectSlug: "test-project",
        },
      ],
      oldFingerprint
    );

    try {
      resolveTransaction("1", { ...defaultOptions, period: "24h" });
      expect.unreachable("Should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      const configError = error as ConfigError;
      expect(configError.suggestion).toContain("sentry profile list");
      expect(configError.suggestion).toContain("--period 24h");
    }
  });
});

// =============================================================================
// Edge Cases
// =============================================================================

describe("edge cases", () => {
  test("handles empty alias cache gracefully", () => {
    clearTransactionAliases();

    expect(() => resolveTransaction("1", defaultOptions)).toThrow(ConfigError);
    expect(() => resolveTransaction("i", defaultOptions)).toThrow(ConfigError);
  });

  test("multi-project fingerprint (null project)", () => {
    const multiProjectFp = "test-org:*:7d";
    setTransactionAliases(
      [
        {
          idx: 1,
          alias: "i",
          transaction: "/api/issues/",
          orgSlug: "test-org",
          projectSlug: "backend",
        },
      ],
      multiProjectFp
    );

    const result = resolveTransaction("1", {
      org: "test-org",
      project: null,
      period: "7d",
    });

    expect(result.transaction).toBe("/api/issues/");
    expect(result.projectSlug).toBe("backend");
  });

  test("numeric-looking full paths still pass through", () => {
    // Transaction name contains numbers but also has path separators
    const result = resolveTransaction("/api/0/test/", defaultOptions);
    expect(result.transaction).toBe("/api/0/test/");
  });

  test("dotted names with numbers pass through", () => {
    const result = resolveTransaction("celery.task.v2.run", defaultOptions);
    expect(result.transaction).toBe("celery.task.v2.run");
  });
});
