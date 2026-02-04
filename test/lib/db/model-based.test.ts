/**
 * Model-Based Testing for SQLite Database Layer
 *
 * Uses fast-check to generate random sequences of database operations
 * and verify the system behaves correctly against a simplified model.
 *
 * This catches edge cases that handwritten tests miss, such as:
 * - Unexpected state transitions
 * - Race conditions in caching logic
 * - Invariant violations (e.g., clearAuth also clears regions)
 */

// biome-ignore-all lint/suspicious/noMisplacedAssertion: Model-based testing uses expect() inside command classes, not directly in test() functions. This is the standard fast-check pattern for stateful testing.

import { describe, expect, test } from "bun:test";
import {
  type AsyncCommand,
  array,
  asyncModelRun,
  asyncProperty,
  boolean,
  commands,
  constant,
  constantFrom,
  assert as fcAssert,
  integer,
  nat,
  option,
  property,
  string,
  tuple,
} from "fast-check";
import {
  clearAuth,
  getAuthConfig,
  getAuthToken,
  isAuthenticated,
  setAuthToken,
} from "../../../src/lib/db/auth.js";
import {
  clearProjectAliases,
  getProjectAliases,
  getProjectByAlias,
  setProjectAliases,
} from "../../../src/lib/db/project-aliases.js";
import {
  clearOrgRegions,
  getAllOrgRegions,
  getOrgRegion,
  setOrgRegion,
  setOrgRegions,
} from "../../../src/lib/db/regions.js";
import {
  getVersionCheckInfo,
  setVersionCheckInfo,
} from "../../../src/lib/db/version-check.js";
import {
  createIsolatedDbContext,
  DEFAULT_NUM_RUNS,
} from "../../model-based/helpers.js";

/**
 * Model representing the expected state of the database.
 * This is a simplified version of the real database state.
 */
type DbModel = {
  auth: {
    token: string | null;
    refreshToken: string | null;
    expiresAt: number | null;
    issuedAt: number | null;
  };
  regions: Map<string, string>;
  aliases: {
    entries: Map<string, { orgSlug: string; projectSlug: string }>;
    fingerprint: string | null;
  };
  versionCheck: {
    lastChecked: number | null;
    latestVersion: string | null;
  };
};

/** Real database handle (we just use the module functions directly) */
type RealDb = Record<string, never>;

/** Create initial empty model */
function createEmptyModel(): DbModel {
  return {
    auth: {
      token: null,
      refreshToken: null,
      expiresAt: null,
      issuedAt: null,
    },
    regions: new Map(),
    aliases: {
      entries: new Map(),
      fingerprint: null,
    },
    versionCheck: {
      lastChecked: null,
      latestVersion: null,
    },
  };
}

// Auth Commands (All async for asyncModelRun compatibility)

class SetAuthTokenCommand implements AsyncCommand<DbModel, RealDb> {
  readonly token: string;
  readonly expiresIn: number | undefined;
  readonly refreshToken: string | undefined;

  constructor(
    token: string,
    expiresIn: number | undefined,
    refreshToken: string | undefined
  ) {
    this.token = token;
    this.expiresIn = expiresIn;
    this.refreshToken = refreshToken;
  }

  check = () => true;

  async run(model: DbModel, _real: RealDb): Promise<void> {
    const now = Date.now();

    // Apply to real system
    setAuthToken(this.token, this.expiresIn, this.refreshToken);

    // Update model
    model.auth.token = this.token;
    model.auth.refreshToken = this.refreshToken ?? null;

    // Use truthy check to match real setAuthToken behavior (0 is treated as no expiry)
    if (this.expiresIn) {
      model.auth.expiresAt = now + this.expiresIn * 1000;
      model.auth.issuedAt = now;
    } else {
      model.auth.expiresAt = null;
      model.auth.issuedAt = null;
    }
  }

  toString(): string {
    return `setAuthToken("${this.token}", ${this.expiresIn}, ${this.refreshToken ? `"${this.refreshToken}"` : undefined})`;
  }
}

class GetAuthTokenCommand implements AsyncCommand<DbModel, RealDb> {
  check = () => true;

  async run(model: DbModel, _real: RealDb): Promise<void> {
    const realToken = getAuthToken();

    // Token should be undefined if:
    // 1. No token set
    // 2. Token is expired (expiresAt < now)
    const now = Date.now();
    const expectedToken =
      model.auth.token &&
      (model.auth.expiresAt === null || model.auth.expiresAt > now)
        ? model.auth.token
        : undefined;

    expect(realToken).toBe(expectedToken);
  }

  toString = () => "getAuthToken()";
}

class GetAuthConfigCommand implements AsyncCommand<DbModel, RealDb> {
  check = () => true;

  async run(model: DbModel, _real: RealDb): Promise<void> {
    const realConfig = getAuthConfig();

    if (model.auth.token === null) {
      expect(realConfig).toBeUndefined();
    } else {
      expect(realConfig).toBeDefined();
      expect(realConfig?.token).toBe(model.auth.token);
      expect(realConfig?.refreshToken).toBe(
        model.auth.refreshToken ?? undefined
      );
      // Note: expiresAt/issuedAt may have slight timing differences, so we check presence
      if (model.auth.expiresAt !== null) {
        expect(realConfig?.expiresAt).toBeDefined();
      }
    }
  }

  toString = () => "getAuthConfig()";
}

class ClearAuthCommand implements AsyncCommand<DbModel, RealDb> {
  check = () => true;

  async run(model: DbModel, _real: RealDb): Promise<void> {
    clearAuth();

    // Clear auth state
    model.auth.token = null;
    model.auth.refreshToken = null;
    model.auth.expiresAt = null;
    model.auth.issuedAt = null;

    // KEY INVARIANT: clearAuth also clears org regions!
    // This is specified in auth.ts lines 101-103
    model.regions.clear();
  }

  toString = () => "clearAuth()";
}

class IsAuthenticatedCommand implements AsyncCommand<DbModel, RealDb> {
  check = () => true;

  async run(model: DbModel, _real: RealDb): Promise<void> {
    const realResult = await isAuthenticated();

    // Should be authenticated if we have a valid, non-expired token
    const now = Date.now();
    const expectedResult =
      model.auth.token !== null &&
      (model.auth.expiresAt === null || model.auth.expiresAt > now);

    expect(realResult).toBe(expectedResult);
  }

  toString = () => "isAuthenticated()";
}

// Region Commands

class SetOrgRegionCommand implements AsyncCommand<DbModel, RealDb> {
  readonly orgSlug: string;
  readonly regionUrl: string;

  constructor(orgSlug: string, regionUrl: string) {
    this.orgSlug = orgSlug;
    this.regionUrl = regionUrl;
  }

  check = () => true;

  async run(model: DbModel, _real: RealDb): Promise<void> {
    await setOrgRegion(this.orgSlug, this.regionUrl);
    model.regions.set(this.orgSlug, this.regionUrl);
  }

  toString(): string {
    return `setOrgRegion("${this.orgSlug}", "${this.regionUrl}")`;
  }
}

class GetOrgRegionCommand implements AsyncCommand<DbModel, RealDb> {
  readonly orgSlug: string;

  constructor(orgSlug: string) {
    this.orgSlug = orgSlug;
  }

  check = () => true;

  async run(model: DbModel, _real: RealDb): Promise<void> {
    const realRegion = await getOrgRegion(this.orgSlug);
    const expectedRegion = model.regions.get(this.orgSlug);

    expect(realRegion).toBe(expectedRegion);
  }

  toString(): string {
    return `getOrgRegion("${this.orgSlug}")`;
  }
}

class SetOrgRegionsCommand implements AsyncCommand<DbModel, RealDb> {
  readonly entries: [string, string][];

  constructor(entries: [string, string][]) {
    this.entries = entries;
  }

  check = () => true;

  async run(model: DbModel, _real: RealDb): Promise<void> {
    await setOrgRegions(this.entries);

    for (const [orgSlug, regionUrl] of this.entries) {
      model.regions.set(orgSlug, regionUrl);
    }
  }

  toString(): string {
    return `setOrgRegions([${this.entries.map(([o, r]) => `["${o}", "${r}"]`).join(", ")}])`;
  }
}

class GetAllOrgRegionsCommand implements AsyncCommand<DbModel, RealDb> {
  check = () => true;

  async run(model: DbModel, _real: RealDb): Promise<void> {
    const realRegions = await getAllOrgRegions();

    expect(realRegions.size).toBe(model.regions.size);

    for (const [orgSlug, regionUrl] of model.regions) {
      expect(realRegions.get(orgSlug)).toBe(regionUrl);
    }
  }

  toString = () => "getAllOrgRegions()";
}

class ClearOrgRegionsCommand implements AsyncCommand<DbModel, RealDb> {
  check = () => true;

  async run(model: DbModel, _real: RealDb): Promise<void> {
    await clearOrgRegions();
    model.regions.clear();
  }

  toString = () => "clearOrgRegions()";
}

// Alias Commands

class SetProjectAliasesCommand implements AsyncCommand<DbModel, RealDb> {
  readonly aliases: Record<string, { orgSlug: string; projectSlug: string }>;
  readonly fingerprint: string | undefined;

  constructor(
    aliases: Record<string, { orgSlug: string; projectSlug: string }>,
    fingerprint: string | undefined
  ) {
    this.aliases = aliases;
    this.fingerprint = fingerprint;
  }

  check = () => true;

  async run(model: DbModel, _real: RealDb): Promise<void> {
    await setProjectAliases(this.aliases, this.fingerprint);

    // Clear and replace all aliases (this is the documented behavior)
    model.aliases.entries.clear();
    for (const [alias, entry] of Object.entries(this.aliases)) {
      // Aliases are stored lowercase
      model.aliases.entries.set(alias.toLowerCase(), entry);
    }
    model.aliases.fingerprint = this.fingerprint ?? null;
  }

  toString(): string {
    const aliasStr = Object.entries(this.aliases)
      .map(
        ([a, e]) => `"${a}": {org: "${e.orgSlug}", project: "${e.projectSlug}"}`
      )
      .join(", ");
    return `setProjectAliases({${aliasStr}}, ${this.fingerprint ? `"${this.fingerprint}"` : undefined})`;
  }
}

class GetProjectAliasesCommand implements AsyncCommand<DbModel, RealDb> {
  check = () => true;

  async run(model: DbModel, _real: RealDb): Promise<void> {
    const realAliases = await getProjectAliases();

    if (model.aliases.entries.size === 0) {
      expect(realAliases).toBeUndefined();
    } else {
      expect(realAliases).toBeDefined();
      expect(Object.keys(realAliases!).length).toBe(model.aliases.entries.size);

      for (const [alias, entry] of model.aliases.entries) {
        expect(realAliases![alias]).toEqual(entry);
      }
    }
  }

  toString = () => "getProjectAliases()";
}

class GetProjectByAliasCommand implements AsyncCommand<DbModel, RealDb> {
  readonly alias: string;
  readonly currentFingerprint: string | undefined;

  constructor(alias: string, currentFingerprint: string | undefined) {
    this.alias = alias;
    this.currentFingerprint = currentFingerprint;
  }

  check = () => true;

  async run(model: DbModel, _real: RealDb): Promise<void> {
    const realProject = await getProjectByAlias(
      this.alias,
      this.currentFingerprint
    );

    // Lookup is case-insensitive
    const modelEntry = model.aliases.entries.get(this.alias.toLowerCase());

    if (!modelEntry) {
      expect(realProject).toBeUndefined();
      return;
    }

    // Fingerprint validation logic (from project-aliases.ts lines 103-109):
    // - If currentFingerprint is undefined, skip validation (return entry)
    // - If stored fingerprint is null, skip validation (legacy cache)
    // - If both are defined, they must match exactly
    const storedFp = model.aliases.fingerprint;
    const currentFp = this.currentFingerprint;

    const shouldReject =
      currentFp !== undefined && storedFp !== null && currentFp !== storedFp;

    if (shouldReject) {
      expect(realProject).toBeUndefined();
    } else {
      expect(realProject).toEqual(modelEntry);
    }
  }

  toString(): string {
    return `getProjectByAlias("${this.alias}", ${this.currentFingerprint ? `"${this.currentFingerprint}"` : undefined})`;
  }
}

class ClearProjectAliasesCommand implements AsyncCommand<DbModel, RealDb> {
  check = () => true;

  async run(model: DbModel, _real: RealDb): Promise<void> {
    await clearProjectAliases();
    model.aliases.entries.clear();
    model.aliases.fingerprint = null;
  }

  toString = () => "clearProjectAliases()";
}

// Version Check Commands

class SetVersionCheckCommand implements AsyncCommand<DbModel, RealDb> {
  readonly latestVersion: string;

  constructor(latestVersion: string) {
    this.latestVersion = latestVersion;
  }

  check = () => true;

  async run(model: DbModel, _real: RealDb): Promise<void> {
    const now = Date.now();
    setVersionCheckInfo(this.latestVersion);

    model.versionCheck.lastChecked = now;
    model.versionCheck.latestVersion = this.latestVersion;
  }

  toString(): string {
    return `setVersionCheckInfo("${this.latestVersion}")`;
  }
}

class GetVersionCheckCommand implements AsyncCommand<DbModel, RealDb> {
  check = () => true;

  async run(model: DbModel, _real: RealDb): Promise<void> {
    const realInfo = getVersionCheckInfo();

    expect(realInfo.latestVersion).toBe(model.versionCheck.latestVersion);

    // lastChecked timing may vary slightly, so check presence
    if (model.versionCheck.lastChecked !== null) {
      expect(realInfo.lastChecked).not.toBeNull();
      // Should be within 1 second of expected
      expect(
        Math.abs(realInfo.lastChecked! - model.versionCheck.lastChecked)
      ).toBeLessThan(1000);
    } else {
      expect(realInfo.lastChecked).toBeNull();
    }
  }

  toString = () => "getVersionCheckInfo()";
}

// Arbitraries (Random Data Generators)

/** Generate valid token strings */
const tokenArb = string({ minLength: 1, maxLength: 64 });

/** Generate org/project slugs (alphanumeric with hyphens) */
const slugChars = "abcdefghijklmnopqrstuvwxyz0123456789";
const slugArb = array(constantFrom(...slugChars.split("")), {
  minLength: 1,
  maxLength: 16,
}).map((chars) => chars.join(""));

/** Generate region URLs */
const regionUrlArb = constantFrom(
  "https://us.sentry.io",
  "https://de.sentry.io",
  "https://eu.sentry.io",
  "https://sentry.io"
);

/** Generate alias (single letter) */
const aliasChars = "abcdefghijklmnopqrstuvwxyz";
const aliasArb = constantFrom(...aliasChars.split(""));

/** Generate alias with optional uppercase */
const aliasWithCaseArb = tuple(aliasArb, boolean()).map(([alias, upper]) =>
  upper ? alias.toUpperCase() : alias
);

/** Generate DSN fingerprint */
const fingerprintArb = option(
  tuple(nat(1000), nat(1000)).map(([a, b]) => `${a}:${b}`),
  { nil: undefined }
);

/** Generate version string */
const versionArb = tuple(nat(10), nat(20), nat(100)).map(
  ([major, minor, patch]) => `${major}.${minor}.${patch}`
);

/** Generate expiresIn (seconds) - can be negative for testing expiry */
const expiresInArb = option(integer({ min: -10, max: 7200 }), {
  nil: undefined,
});

// Command Arbitraries

const setAuthTokenCmdArb = tuple(
  tokenArb,
  expiresInArb,
  option(tokenArb, { nil: undefined })
).map(
  ([token, expiresIn, refreshToken]) =>
    new SetAuthTokenCommand(token, expiresIn, refreshToken)
);

const getAuthTokenCmdArb = constant(new GetAuthTokenCommand());

const getAuthConfigCmdArb = constant(new GetAuthConfigCommand());

const clearAuthCmdArb = constant(new ClearAuthCommand());

const isAuthenticatedCmdArb = constant(new IsAuthenticatedCommand());

const setOrgRegionCmdArb = tuple(slugArb, regionUrlArb).map(
  ([org, url]) => new SetOrgRegionCommand(org, url)
);

const getOrgRegionCmdArb = slugArb.map((org) => new GetOrgRegionCommand(org));

const setOrgRegionsCmdArb = array(tuple(slugArb, regionUrlArb), {
  minLength: 0,
  maxLength: 5,
}).map((entries) => new SetOrgRegionsCommand(entries));

const getAllOrgRegionsCmdArb = constant(new GetAllOrgRegionsCommand());

const clearOrgRegionsCmdArb = constant(new ClearOrgRegionsCommand());

const setProjectAliasesCmdArb = tuple(
  array(tuple(aliasArb, slugArb, slugArb), { minLength: 0, maxLength: 5 }),
  fingerprintArb
).map(([entries, fp]) => {
  const aliases: Record<string, { orgSlug: string; projectSlug: string }> = {};
  for (const [alias, org, project] of entries) {
    aliases[alias] = { orgSlug: org, projectSlug: project };
  }
  return new SetProjectAliasesCommand(aliases, fp);
});

const getProjectAliasesCmdArb = constant(new GetProjectAliasesCommand());

const getProjectByAliasCmdArb = tuple(aliasWithCaseArb, fingerprintArb).map(
  ([alias, fp]) => new GetProjectByAliasCommand(alias, fp)
);

const clearProjectAliasesCmdArb = constant(new ClearProjectAliasesCommand());

const setVersionCheckCmdArb = versionArb.map(
  (v) => new SetVersionCheckCommand(v)
);

const getVersionCheckCmdArb = constant(new GetVersionCheckCommand());

// All Commands Combined

const allCommands = [
  // Auth commands
  setAuthTokenCmdArb,
  getAuthTokenCmdArb,
  getAuthConfigCmdArb,
  clearAuthCmdArb,
  isAuthenticatedCmdArb,
  // Region commands
  setOrgRegionCmdArb,
  getOrgRegionCmdArb,
  setOrgRegionsCmdArb,
  getAllOrgRegionsCmdArb,
  clearOrgRegionsCmdArb,
  // Alias commands
  setProjectAliasesCmdArb,
  getProjectAliasesCmdArb,
  getProjectByAliasCmdArb,
  clearProjectAliasesCmdArb,
  // Version check commands
  setVersionCheckCmdArb,
  getVersionCheckCmdArb,
];

// Tests

describe("model-based: database layer", () => {
  test("random sequences of database operations maintain consistency", () => {
    fcAssert(
      asyncProperty(commands(allCommands, { size: "+1" }), async (cmds) => {
        const cleanup = createIsolatedDbContext();
        try {
          const setup = () => ({
            model: createEmptyModel(),
            real: {} as RealDb,
          });

          await asyncModelRun(setup, cmds);
        } finally {
          cleanup();
        }
      }),
      {
        numRuns: DEFAULT_NUM_RUNS,
        verbose: false, // Set to true for debugging
      }
    );
  });

  test("clearAuth also clears org regions (key invariant)", () => {
    fcAssert(
      asyncProperty(
        array(tuple(slugArb, regionUrlArb), { minLength: 1, maxLength: 5 }),
        async (entries) => {
          const cleanup = createIsolatedDbContext();
          try {
            // Set up auth and some regions
            setAuthToken("test-token");
            await setOrgRegions(entries);

            // Verify regions were set (use unique count since setOrgRegions uses upsert)
            const regionsBefore = await getAllOrgRegions();
            const uniqueOrgSlugs = new Set(entries.map(([org]) => org));
            expect(regionsBefore.size).toBe(uniqueOrgSlugs.size);

            // Clear auth
            clearAuth();

            // Verify regions were also cleared (this is the invariant!)
            const regionsAfter = await getAllOrgRegions();
            expect(regionsAfter.size).toBe(0);
          } finally {
            cleanup();
          }
        }
      ),
      { numRuns: 50 }
    );
  });

  test("alias lookup is case-insensitive", () => {
    fcAssert(
      asyncProperty(
        tuple(aliasArb, slugArb, slugArb),
        async ([alias, org, project]) => {
          const cleanup = createIsolatedDbContext();
          try {
            // Set alias (stored lowercase)
            await setProjectAliases({
              [alias]: { orgSlug: org, projectSlug: project },
            });

            // Lookup with uppercase
            const upper = await getProjectByAlias(alias.toUpperCase());
            // Lookup with lowercase
            const lower = await getProjectByAlias(alias.toLowerCase());
            // Lookup with original
            const original = await getProjectByAlias(alias);

            // All should return the same result
            expect(upper).toEqual(lower);
            expect(lower).toEqual(original);
            expect(upper?.orgSlug).toBe(org);
            expect(upper?.projectSlug).toBe(project);
          } finally {
            cleanup();
          }
        }
      ),
      { numRuns: 50 }
    );
  });

  test("expired tokens return undefined", () => {
    fcAssert(
      property(tokenArb, (token) => {
        const cleanup = createIsolatedDbContext();
        try {
          // Set token that expires immediately (negative expiresIn)
          setAuthToken(token, -1);

          // Token should be undefined because it's expired
          const retrieved = getAuthToken();
          expect(retrieved).toBeUndefined();

          // But auth config should still have the token stored
          const config = getAuthConfig();
          expect(config?.token).toBe(token);
        } finally {
          cleanup();
        }
      }),
      { numRuns: 50 }
    );
  });

  test("fingerprint mismatch rejects alias lookup", () => {
    // Combine all parameters into a single tuple to avoid parameter limit
    const paramsArb = tuple(
      aliasArb,
      slugArb,
      slugArb,
      nat(1000),
      nat(1000),
      nat(1000),
      nat(1000)
    );

    fcAssert(
      asyncProperty(paramsArb, async ([alias, org, project, a, b, c, d]) => {
        // Ensure fingerprints are different
        const fp1 = `${a}:${b}`;
        const fp2 = `${c}:${d}`;
        if (fp1 === fp2) return; // Skip if same (unlikely)

        const cleanup = createIsolatedDbContext();
        try {
          // Set alias with fingerprint 1
          await setProjectAliases(
            { [alias]: { orgSlug: org, projectSlug: project } },
            fp1
          );

          // Lookup with fingerprint 2 should fail
          const result = await getProjectByAlias(alias, fp2);
          expect(result).toBeUndefined();

          // Lookup with matching fingerprint should succeed
          const matchingResult = await getProjectByAlias(alias, fp1);
          expect(matchingResult?.orgSlug).toBe(org);
        } finally {
          cleanup();
        }
      }),
      { numRuns: 50 }
    );
  });

  test("setProjectAliases replaces all existing aliases", () => {
    const aliasEntryArb = array(tuple(aliasArb, slugArb, slugArb), {
      minLength: 1,
      maxLength: 3,
    });

    fcAssert(
      asyncProperty(
        tuple(aliasEntryArb, aliasEntryArb),
        async ([first, second]) => {
          const cleanup = createIsolatedDbContext();
          try {
            // Set first batch
            const aliases1: Record<
              string,
              { orgSlug: string; projectSlug: string }
            > = {};
            for (const [a, o, p] of first) {
              aliases1[a] = { orgSlug: o, projectSlug: p };
            }
            await setProjectAliases(aliases1);

            // Set second batch (should replace all)
            const aliases2: Record<
              string,
              { orgSlug: string; projectSlug: string }
            > = {};
            for (const [a, o, p] of second) {
              aliases2[a] = { orgSlug: o, projectSlug: p };
            }
            await setProjectAliases(aliases2);

            // Only second batch should exist
            const result = await getProjectAliases();
            expect(result).toBeDefined();
            expect(Object.keys(result!).length).toBe(
              Object.keys(aliases2).length
            );

            // Check second batch aliases are present
            for (const [alias, entry] of Object.entries(aliases2)) {
              expect(result![alias.toLowerCase()]).toEqual(entry);
            }

            // Check first batch aliases that aren't in second batch are gone
            for (const alias of Object.keys(aliases1)) {
              if (!(alias in aliases2)) {
                expect(result![alias.toLowerCase()]).toBeUndefined();
              }
            }
          } finally {
            cleanup();
          }
        }
      ),
      { numRuns: 50 }
    );
  });
});
