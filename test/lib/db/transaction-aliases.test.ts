/**
 * Transaction Aliases Database Layer Tests
 *
 * Tests for SQLite storage of transaction aliases from profile list commands.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  buildTransactionFingerprint,
  clearTransactionAliases,
  getStaleFingerprint,
  getStaleIndexFingerprint,
  getTransactionAliases,
  getTransactionByAlias,
  getTransactionByIndex,
  setTransactionAliases,
} from "../../../src/lib/db/transaction-aliases.js";
import type { TransactionAliasEntry } from "../../../src/types/index.js";
import { cleanupTestDir, createTestConfigDir } from "../../helpers.js";

let testConfigDir: string;

beforeEach(async () => {
  testConfigDir = await createTestConfigDir("test-transaction-aliases-");
  process.env.SENTRY_CLI_CONFIG_DIR = testConfigDir;
});

afterEach(async () => {
  delete process.env.SENTRY_CLI_CONFIG_DIR;
  await cleanupTestDir(testConfigDir);
});

// =============================================================================
// buildTransactionFingerprint
// =============================================================================

describe("buildTransactionFingerprint", () => {
  test("builds fingerprint with org, project, and period", () => {
    const fp = buildTransactionFingerprint("my-org", "my-project", "7d");
    expect(fp).toBe("my-org:my-project:7d");
  });

  test("uses * for null project (multi-project)", () => {
    const fp = buildTransactionFingerprint("my-org", null, "24h");
    expect(fp).toBe("my-org:*:24h");
  });

  test("handles various period formats", () => {
    expect(buildTransactionFingerprint("o", "p", "1h")).toBe("o:p:1h");
    expect(buildTransactionFingerprint("o", "p", "24h")).toBe("o:p:24h");
    expect(buildTransactionFingerprint("o", "p", "7d")).toBe("o:p:7d");
    expect(buildTransactionFingerprint("o", "p", "30d")).toBe("o:p:30d");
  });
});

// =============================================================================
// setTransactionAliases / getTransactionAliases
// =============================================================================

describe("setTransactionAliases", () => {
  const fingerprint = "test-org:test-project:7d";

  const createEntry = (idx: number, alias: string): TransactionAliasEntry => ({
    idx,
    alias,
    transaction: `/api/0/${alias}/`,
    orgSlug: "test-org",
    projectSlug: "test-project",
  });

  test("stores and retrieves aliases", () => {
    const aliases: TransactionAliasEntry[] = [
      createEntry(1, "issues"),
      createEntry(2, "events"),
      createEntry(3, "releases"),
    ];

    setTransactionAliases(aliases, fingerprint);

    const result = getTransactionAliases(fingerprint);
    expect(result).toHaveLength(3);
    expect(result[0]?.alias).toBe("issues");
    expect(result[1]?.alias).toBe("events");
    expect(result[2]?.alias).toBe("releases");
  });

  test("replaces existing aliases with same fingerprint", () => {
    setTransactionAliases([createEntry(1, "old")], fingerprint);
    setTransactionAliases([createEntry(1, "new")], fingerprint);

    const result = getTransactionAliases(fingerprint);
    expect(result).toHaveLength(1);
    expect(result[0]?.alias).toBe("new");
  });

  test("keeps aliases with different fingerprints separate", () => {
    const fp1 = "org1:proj1:7d";
    const fp2 = "org2:proj2:7d";

    setTransactionAliases([createEntry(1, "first")], fp1);
    setTransactionAliases([createEntry(1, "second")], fp2);

    const result1 = getTransactionAliases(fp1);
    const result2 = getTransactionAliases(fp2);

    expect(result1).toHaveLength(1);
    expect(result1[0]?.alias).toBe("first");
    expect(result2).toHaveLength(1);
    expect(result2[0]?.alias).toBe("second");
  });

  test("stores empty array", () => {
    setTransactionAliases([], fingerprint);

    const result = getTransactionAliases(fingerprint);
    expect(result).toHaveLength(0);
  });

  test("normalizes aliases to lowercase", () => {
    const entry: TransactionAliasEntry = {
      idx: 1,
      alias: "UPPERCASE",
      transaction: "/api/test/",
      orgSlug: "org",
      projectSlug: "proj",
    };

    setTransactionAliases([entry], fingerprint);

    const result = getTransactionAliases(fingerprint);
    expect(result[0]?.alias).toBe("uppercase");
  });
});

// =============================================================================
// getTransactionByIndex
// =============================================================================

describe("getTransactionByIndex", () => {
  const fingerprint = "test-org:test-project:7d";

  beforeEach(() => {
    const aliases: TransactionAliasEntry[] = [
      {
        idx: 1,
        alias: "i",
        transaction: "/api/0/issues/",
        orgSlug: "test-org",
        projectSlug: "test-project",
      },
      {
        idx: 2,
        alias: "e",
        transaction: "/api/0/events/",
        orgSlug: "test-org",
        projectSlug: "test-project",
      },
    ];
    setTransactionAliases(aliases, fingerprint);
  });

  test("returns entry for valid index", () => {
    const result = getTransactionByIndex(1, fingerprint);
    expect(result).toBeDefined();
    expect(result?.transaction).toBe("/api/0/issues/");
    expect(result?.alias).toBe("i");
  });

  test("returns null for non-existent index", () => {
    const result = getTransactionByIndex(99, fingerprint);
    expect(result).toBeNull();
  });

  test("returns null for wrong fingerprint", () => {
    const result = getTransactionByIndex(1, "different:fingerprint:7d");
    expect(result).toBeNull();
  });

  test("returns null for index 0", () => {
    const result = getTransactionByIndex(0, fingerprint);
    expect(result).toBeNull();
  });
});

// =============================================================================
// getTransactionByAlias
// =============================================================================

describe("getTransactionByAlias", () => {
  const fingerprint = "test-org:test-project:7d";

  beforeEach(() => {
    const aliases: TransactionAliasEntry[] = [
      {
        idx: 1,
        alias: "issues",
        transaction: "/api/0/organizations/{org}/issues/",
        orgSlug: "test-org",
        projectSlug: "test-project",
      },
      {
        idx: 2,
        alias: "events",
        transaction: "/api/0/projects/{org}/{proj}/events/",
        orgSlug: "test-org",
        projectSlug: "test-project",
      },
    ];
    setTransactionAliases(aliases, fingerprint);
  });

  test("returns entry for valid alias", () => {
    const result = getTransactionByAlias("issues", fingerprint);
    expect(result).toBeDefined();
    expect(result?.transaction).toBe("/api/0/organizations/{org}/issues/");
    expect(result?.idx).toBe(1);
  });

  test("returns null for non-existent alias", () => {
    const result = getTransactionByAlias("unknown", fingerprint);
    expect(result).toBeNull();
  });

  test("returns null for wrong fingerprint", () => {
    const result = getTransactionByAlias("issues", "different:fingerprint:7d");
    expect(result).toBeNull();
  });

  test("alias lookup is case-insensitive", () => {
    const lower = getTransactionByAlias("issues", fingerprint);
    const upper = getTransactionByAlias("ISSUES", fingerprint);
    const mixed = getTransactionByAlias("Issues", fingerprint);

    expect(lower?.transaction).toBe(upper?.transaction);
    expect(lower?.transaction).toBe(mixed?.transaction);
  });
});

// =============================================================================
// getStaleFingerprint / getStaleIndexFingerprint
// =============================================================================

describe("stale detection", () => {
  test("getStaleFingerprint returns fingerprint when alias exists in different context", () => {
    const oldFp = "old-org:old-project:7d";
    const currentFp = "new-org:new-project:24h";
    setTransactionAliases(
      [
        {
          idx: 1,
          alias: "issues",
          transaction: "/api/issues/",
          orgSlug: "old-org",
          projectSlug: "old-project",
        },
      ],
      oldFp
    );

    const stale = getStaleFingerprint("issues", currentFp);
    expect(stale).toBe(oldFp);
  });

  test("getStaleFingerprint excludes current fingerprint", () => {
    clearTransactionAliases();
    const fp = "my-org:my-project:7d";
    setTransactionAliases(
      [
        {
          idx: 1,
          alias: "issues",
          transaction: "/api/issues/",
          orgSlug: "my-org",
          projectSlug: "my-project",
        },
      ],
      fp
    );

    // Searching with the same fingerprint should return null (not stale)
    const stale = getStaleFingerprint("issues", fp);
    expect(stale).toBeNull();
  });

  test("getStaleFingerprint returns null when alias doesn't exist", () => {
    const stale = getStaleFingerprint("nonexistent", "any:fp:here");
    expect(stale).toBeNull();
  });

  test("getStaleIndexFingerprint returns fingerprint when index exists in different context", () => {
    const oldFp = "old-org:old-project:7d";
    const currentFp = "new-org:new-project:24h";
    setTransactionAliases(
      [
        {
          idx: 5,
          alias: "test",
          transaction: "/api/test/",
          orgSlug: "old-org",
          projectSlug: "old-project",
        },
      ],
      oldFp
    );

    const stale = getStaleIndexFingerprint(5, currentFp);
    expect(stale).toBe(oldFp);
  });

  test("getStaleIndexFingerprint excludes current fingerprint", () => {
    clearTransactionAliases();
    const fp = "my-org:my-project:7d";
    setTransactionAliases(
      [
        {
          idx: 5,
          alias: "test",
          transaction: "/api/test/",
          orgSlug: "my-org",
          projectSlug: "my-project",
        },
      ],
      fp
    );

    // Searching with the same fingerprint should return null (not stale)
    const stale = getStaleIndexFingerprint(5, fp);
    expect(stale).toBeNull();
  });

  test("getStaleIndexFingerprint returns null when index doesn't exist", () => {
    const stale = getStaleIndexFingerprint(999, "any:fp:here");
    expect(stale).toBeNull();
  });
});

// =============================================================================
// clearTransactionAliases
// =============================================================================

describe("clearTransactionAliases", () => {
  test("removes all transaction aliases", () => {
    const fp1 = "org1:proj1:7d";
    const fp2 = "org2:proj2:7d";

    setTransactionAliases(
      [
        {
          idx: 1,
          alias: "a",
          transaction: "/a/",
          orgSlug: "org1",
          projectSlug: "proj1",
        },
      ],
      fp1
    );
    setTransactionAliases(
      [
        {
          idx: 1,
          alias: "b",
          transaction: "/b/",
          orgSlug: "org2",
          projectSlug: "proj2",
        },
      ],
      fp2
    );

    clearTransactionAliases();

    expect(getTransactionAliases(fp1)).toHaveLength(0);
    expect(getTransactionAliases(fp2)).toHaveLength(0);
  });

  test("safe to call when no aliases exist", () => {
    // Should not throw
    clearTransactionAliases();
    expect(getTransactionAliases("any:fingerprint:7d")).toHaveLength(0);
  });
});
