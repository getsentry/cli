/**
 * Model-Based Tests for Pagination Cursor Storage
 *
 * Uses fast-check to generate random sequences of get/set/clear operations
 * and verifies behavior against a simplified model, including TTL expiry
 * and composite primary key semantics.
 */

// biome-ignore-all lint/suspicious/noMisplacedAssertion: Model-based testing uses expect() inside command classes, not directly in test() functions. This is the standard fast-check pattern for stateful testing.

import { describe, expect, test } from "bun:test";
import {
  type AsyncCommand,
  asyncModelRun,
  asyncProperty,
  commands,
  constantFrom,
  assert as fcAssert,
  integer,
  property,
  tuple,
} from "fast-check";
import {
  clearPaginationCursor,
  getPaginationCursor,
  setPaginationCursor,
} from "../../../src/lib/db/pagination.js";
import {
  createIsolatedDbContext,
  DEFAULT_NUM_RUNS,
} from "../../model-based/helpers.js";

/**
 * Model representing expected pagination cursor state.
 * Maps composite key `${commandKey}::${context}` to cursor info.
 */
type PaginationModel = {
  cursors: Map<string, { cursor: string; expiresAt: number }>;
};

/** Real system (we use module functions directly) */
type RealDb = Record<string, never>;

/** Composite key for the model */
function compositeKey(commandKey: string, context: string): string {
  return `${commandKey}::${context}`;
}

/** Create initial empty model */
function createEmptyModel(): PaginationModel {
  return { cursors: new Map() };
}

// Command classes

class SetPaginationCursorCommand
  implements AsyncCommand<PaginationModel, RealDb>
{
  readonly commandKey: string;
  readonly context: string;
  readonly cursor: string;
  readonly ttlMs: number;

  constructor(
    commandKey: string,
    context: string,
    cursor: string,
    ttlMs: number
  ) {
    this.commandKey = commandKey;
    this.context = context;
    this.cursor = cursor;
    this.ttlMs = ttlMs;
  }

  check = () => true;

  async run(model: PaginationModel, _real: RealDb): Promise<void> {
    const now = Date.now();
    setPaginationCursor(this.commandKey, this.context, this.cursor, this.ttlMs);

    const key = compositeKey(this.commandKey, this.context);
    model.cursors.set(key, {
      cursor: this.cursor,
      expiresAt: now + this.ttlMs,
    });
  }

  toString(): string {
    return `setPaginationCursor("${this.commandKey}", "${this.context}", "${this.cursor}", ${this.ttlMs})`;
  }
}

class GetPaginationCursorCommand
  implements AsyncCommand<PaginationModel, RealDb>
{
  readonly commandKey: string;
  readonly context: string;

  constructor(commandKey: string, context: string) {
    this.commandKey = commandKey;
    this.context = context;
  }

  check = () => true;

  async run(model: PaginationModel, _real: RealDb): Promise<void> {
    const realCursor = getPaginationCursor(this.commandKey, this.context);
    const key = compositeKey(this.commandKey, this.context);
    const entry = model.cursors.get(key);

    if (!entry) {
      expect(realCursor).toBeUndefined();
      return;
    }

    const now = Date.now();
    if (entry.expiresAt <= now) {
      // Expired — real system should return undefined and delete the row
      expect(realCursor).toBeUndefined();
      model.cursors.delete(key);
    } else {
      expect(realCursor).toBe(entry.cursor);
    }
  }

  toString(): string {
    return `getPaginationCursor("${this.commandKey}", "${this.context}")`;
  }
}

class ClearPaginationCursorCommand
  implements AsyncCommand<PaginationModel, RealDb>
{
  readonly commandKey: string;
  readonly context: string;

  constructor(commandKey: string, context: string) {
    this.commandKey = commandKey;
    this.context = context;
  }

  check = () => true;

  async run(model: PaginationModel, _real: RealDb): Promise<void> {
    clearPaginationCursor(this.commandKey, this.context);
    const key = compositeKey(this.commandKey, this.context);
    model.cursors.delete(key);
  }

  toString(): string {
    return `clearPaginationCursor("${this.commandKey}", "${this.context}")`;
  }
}

// Arbitraries

const commandKeyArb = constantFrom("project-list", "issue-list", "log-list");
const contextArb = constantFrom(
  "org:sentry",
  "org:acme",
  "org:getsentry",
  "auto",
  "org:sentry|platform:python"
);
const cursorArb = constantFrom(
  "1735689600000:0:0",
  "1735689600000:100:0",
  "1735689600000:200:0",
  "9999999999999:50:1"
);

/** TTL that won't expire during test (5 minutes) */
const longTtlArb = integer({ min: 60_000, max: 300_000 });

// Command arbitraries

const setCmdArb = tuple(commandKeyArb, contextArb, cursorArb, longTtlArb).map(
  ([ck, ctx, cur, ttl]) => new SetPaginationCursorCommand(ck, ctx, cur, ttl)
);

const getCmdArb = tuple(commandKeyArb, contextArb).map(
  ([ck, ctx]) => new GetPaginationCursorCommand(ck, ctx)
);

const clearCmdArb = tuple(commandKeyArb, contextArb).map(
  ([ck, ctx]) => new ClearPaginationCursorCommand(ck, ctx)
);

const allCommands = [setCmdArb, getCmdArb, clearCmdArb];

// Tests

describe("model-based: pagination cursor storage", () => {
  test("random sequences of pagination operations maintain consistency", () => {
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
      { numRuns: DEFAULT_NUM_RUNS, verbose: false }
    );
  });

  test("composite key: different contexts are independent", () => {
    fcAssert(
      property(
        tuple(commandKeyArb, cursorArb, cursorArb),
        ([commandKey, cursor1, cursor2]) => {
          const cleanup = createIsolatedDbContext();
          try {
            const ctx1 = "org:sentry";
            const ctx2 = "org:acme";

            // Set cursors for two different contexts
            setPaginationCursor(commandKey, ctx1, cursor1, 300_000);
            setPaginationCursor(commandKey, ctx2, cursor2, 300_000);

            // Each returns its own cursor
            expect(getPaginationCursor(commandKey, ctx1)).toBe(cursor1);
            expect(getPaginationCursor(commandKey, ctx2)).toBe(cursor2);

            // Clear one, the other remains
            clearPaginationCursor(commandKey, ctx1);
            expect(getPaginationCursor(commandKey, ctx1)).toBeUndefined();
            expect(getPaginationCursor(commandKey, ctx2)).toBe(cursor2);
          } finally {
            cleanup();
          }
        }
      ),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("composite key: different command keys are independent", () => {
    fcAssert(
      property(
        tuple(contextArb, cursorArb, cursorArb),
        ([context, cursor1, cursor2]) => {
          const cleanup = createIsolatedDbContext();
          try {
            const cmd1 = "project-list";
            const cmd2 = "issue-list";

            setPaginationCursor(cmd1, context, cursor1, 300_000);
            setPaginationCursor(cmd2, context, cursor2, 300_000);

            expect(getPaginationCursor(cmd1, context)).toBe(cursor1);
            expect(getPaginationCursor(cmd2, context)).toBe(cursor2);

            clearPaginationCursor(cmd1, context);
            expect(getPaginationCursor(cmd1, context)).toBeUndefined();
            expect(getPaginationCursor(cmd2, context)).toBe(cursor2);
          } finally {
            cleanup();
          }
        }
      ),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("expired cursors return undefined and are deleted", () => {
    fcAssert(
      property(
        tuple(commandKeyArb, contextArb, cursorArb),
        ([commandKey, context, cursor]) => {
          const cleanup = createIsolatedDbContext();
          try {
            // Set with immediately-expired TTL
            setPaginationCursor(commandKey, context, cursor, -1000);

            // Should return undefined
            const result = getPaginationCursor(commandKey, context);
            expect(result).toBeUndefined();

            // Second get should also return undefined (row was deleted on first get)
            const result2 = getPaginationCursor(commandKey, context);
            expect(result2).toBeUndefined();
          } finally {
            cleanup();
          }
        }
      ),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("upsert: setting same key twice updates the cursor", () => {
    fcAssert(
      property(
        tuple(commandKeyArb, contextArb, cursorArb, cursorArb),
        ([commandKey, context, cursor1, cursor2]) => {
          const cleanup = createIsolatedDbContext();
          try {
            setPaginationCursor(commandKey, context, cursor1, 300_000);
            expect(getPaginationCursor(commandKey, context)).toBe(cursor1);

            setPaginationCursor(commandKey, context, cursor2, 300_000);
            expect(getPaginationCursor(commandKey, context)).toBe(cursor2);
          } finally {
            cleanup();
          }
        }
      ),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("get on empty table returns undefined", () => {
    fcAssert(
      property(tuple(commandKeyArb, contextArb), ([commandKey, context]) => {
        const cleanup = createIsolatedDbContext();
        try {
          expect(getPaginationCursor(commandKey, context)).toBeUndefined();
        } finally {
          cleanup();
        }
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("clear on non-existent key is a no-op", () => {
    fcAssert(
      property(tuple(commandKeyArb, contextArb), ([commandKey, context]) => {
        const cleanup = createIsolatedDbContext();
        try {
          // Should not throw
          clearPaginationCursor(commandKey, context);
          expect(getPaginationCursor(commandKey, context)).toBeUndefined();
        } finally {
          cleanup();
        }
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });
});
