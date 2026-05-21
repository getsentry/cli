/**
 * Unit tests for local dev server formatters.
 *
 * Note: Core invariants (never-throw, sanitization round-trips, filter
 * emptiness) are tested via property-based tests in local.property.test.ts.
 * These tests focus on specific output formatting and edge cases.
 */

import { describe, expect, test } from "vitest";
import type { FilterValue } from "../../../src/lib/formatters/local.js";
import {
  formatErrorItem,
  formatItem,
  formatSingleLog,
  formatTime,
  formatTransactionItem,
  inferSource,
  isItemIncluded,
  itemTypeToFilterCategory,
} from "../../../src/lib/formatters/local.js";
import { stripAnsi } from "../../../src/lib/formatters/plain-detect.js";

describe("formatTime", () => {
  test("formats epoch seconds", () => {
    const result = formatTime(1_700_000_000);
    expect(result).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });

  test("formats ISO string", () => {
    const result = formatTime("2024-01-15T12:30:45Z");
    expect(result).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });

  test("returns current time for NaN (NaN is falsy)", () => {
    // NaN is falsy, so !timestamp is true → uses new Date()
    const result = formatTime(Number.NaN);
    expect(result).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });

  test("returns ??:??:?? for unparseable string", () => {
    expect(formatTime("not-a-date")).toBe("??:??:??");
  });

  test("returns current time when missing", () => {
    const result = formatTime();
    expect(result).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });

  test("returns current time for undefined", () => {
    const result = formatTime(undefined);
    expect(result).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });
});

describe("formatErrorItem", () => {
  const serverHeader = { sdk: { name: "sentry.node" } };

  test("formats error with exception values", () => {
    const event = {
      timestamp: 1_700_000_000,
      exception: {
        values: [{ type: "TypeError", value: "x is not a function" }],
      },
    };
    const result = stripAnsi(formatErrorItem(event, serverHeader));
    expect(result).toContain("[ERROR]");
    expect(result).toContain("TypeError: x is not a function");
  });

  test("falls back to message when no exception", () => {
    const event = {
      timestamp: 1_700_000_000,
      message: "Something went wrong",
    };
    const result = stripAnsi(formatErrorItem(event, serverHeader));
    expect(result).toContain("Error: Something went wrong");
  });

  test("falls back to Unknown error when no exception or message", () => {
    const event = { timestamp: 1_700_000_000 };
    const result = stripAnsi(formatErrorItem(event, serverHeader));
    expect(result).toContain("Error: Unknown error");
  });

  test("includes stack frame hint for in_app frame", () => {
    const event = {
      timestamp: 1_700_000_000,
      exception: {
        values: [
          {
            type: "Error",
            value: "boom",
            stacktrace: {
              frames: [
                { filename: "node_modules/lib.js", lineno: 10, in_app: false },
                {
                  filename: "src/handler.ts",
                  lineno: 42,
                  colno: 5,
                  function: "handleRequest",
                  in_app: true,
                },
              ],
            },
          },
        ],
      },
    };
    const result = stripAnsi(formatErrorItem(event, serverHeader));
    expect(result).toContain("[src/handler.ts:42:5]");
    expect(result).toContain("[handleRequest]");
  });

  test("prefers in_app frame over last frame", () => {
    const event = {
      timestamp: 1_700_000_000,
      exception: {
        values: [
          {
            type: "Error",
            value: "boom",
            stacktrace: {
              frames: [
                { filename: "src/app.ts", lineno: 10, in_app: true },
                { filename: "node_modules/lib.js", lineno: 99, in_app: false },
              ],
            },
          },
        ],
      },
    };
    const result = stripAnsi(formatErrorItem(event, serverHeader));
    expect(result).toContain("[src/app.ts:10]");
  });
});

describe("formatTransactionItem", () => {
  const browserHeader = { sdk: { name: "sentry.javascript.browser" } };

  test("formats transaction with op", () => {
    const event = {
      timestamp: 1_700_000_001,
      start_timestamp: 1_700_000_000,
      transaction: "GET /api/users",
      contexts: { trace: { op: "http.client", status: "ok" } },
    };
    const result = stripAnsi(formatTransactionItem(event, browserHeader));
    expect(result).toContain("[TRACE]");
    expect(result).toContain("[http.client]");
    expect(result).toContain("GET /api/users");
    expect(result).toContain("[1000ms]");
  });

  test("omits op when default", () => {
    const event = {
      timestamp: 1_700_000_001,
      start_timestamp: 1_700_000_000,
      transaction: "my-txn",
      contexts: { trace: { op: "default" } },
    };
    const result = stripAnsi(formatTransactionItem(event, browserHeader));
    expect(result).not.toContain("[default]");
    expect(result).toContain("my-txn");
  });

  test("shows non-ok status", () => {
    const event = {
      timestamp: 1_700_000_001,
      start_timestamp: 1_700_000_000,
      transaction: "POST /api",
      contexts: { trace: { op: "http.server", status: "internal_error" } },
    };
    const result = stripAnsi(formatTransactionItem(event, browserHeader));
    expect(result).toContain("[internal_error]");
  });

  test("shows span count", () => {
    const event = {
      timestamp: 1_700_000_001,
      start_timestamp: 1_700_000_000,
      transaction: "my-txn",
      contexts: { trace: { op: "http.server" } },
      spans: [{}, {}, {}],
    };
    const result = stripAnsi(formatTransactionItem(event, browserHeader));
    expect(result).toContain("[3 spans]");
  });

  test("uses singular span for count of 1", () => {
    const event = {
      timestamp: 1_700_000_001,
      start_timestamp: 1_700_000_000,
      transaction: "my-txn",
      contexts: { trace: { op: "http.server" } },
      spans: [{}],
    };
    const result = stripAnsi(formatTransactionItem(event, browserHeader));
    expect(result).toContain("[1 span]");
  });

  test("falls back to Transaction when no transaction name", () => {
    const event = {
      timestamp: 1_700_000_001,
      start_timestamp: 1_700_000_000,
      contexts: { trace: {} },
    };
    const result = stripAnsi(formatTransactionItem(event, browserHeader));
    expect(result).toContain("Transaction");
  });
});

describe("formatSingleLog", () => {
  test("formats log with body", () => {
    const result = stripAnsi(
      formatSingleLog(
        { level: "info", body: "User logged in", timestamp: 1_700_000_000 },
        "[SERVER]  "
      )
    );
    expect(result).toContain("[INFO]");
    expect(result).toContain("User logged in");
  });

  test("filters sentry.* attributes", () => {
    const result = stripAnsi(
      formatSingleLog(
        {
          level: "info",
          body: "hello",
          attributes: {
            "sentry.sdk.name": { value: "node" },
            user_id: { value: 42 },
          },
        },
        "[SERVER]  "
      )
    );
    expect(result).toContain("[user_id=42]");
    expect(result).not.toContain("sentry.sdk.name");
  });

  test("formats without body", () => {
    const result = stripAnsi(formatSingleLog({ level: "debug" }, "[SERVER]  "));
    expect(result).toContain("[DEBUG]");
  });

  test("defaults level to log when missing", () => {
    const result = stripAnsi(formatSingleLog({}, "[SERVER]  "));
    expect(result).toContain("[LOG]");
  });
});

describe("formatItem", () => {
  const header = { sdk: { name: "sentry.node" } };

  test("dispatches error type to error formatter", () => {
    const event = { timestamp: 1_700_000_000, message: "boom" };
    const lines = formatItem("error", event, header, "fallback");
    expect(lines).toHaveLength(1);
    expect(stripAnsi(lines[0])).toContain("[ERROR]");
  });

  test("dispatches event type to error formatter", () => {
    const event = { timestamp: 1_700_000_000, message: "boom" };
    const lines = formatItem("event", event, header, "fallback");
    expect(lines).toHaveLength(1);
    expect(stripAnsi(lines[0])).toContain("[ERROR]");
  });

  test("dispatches transaction type to transaction formatter", () => {
    const event = {
      timestamp: 1_700_000_001,
      start_timestamp: 1_700_000_000,
      transaction: "GET /",
      contexts: { trace: { op: "http.server" } },
    };
    const lines = formatItem("transaction", event, header, "fallback");
    expect(lines).toHaveLength(1);
    expect(stripAnsi(lines[0])).toContain("[TRACE]");
  });

  test("dispatches log type to log formatter", () => {
    const event = {
      items: [{ level: "info", body: "hello" }],
    };
    const lines = formatItem("log", event, header, "fallback");
    expect(lines).toHaveLength(1);
    expect(stripAnsi(lines[0])).toContain("[INFO]");
  });

  test("falls back for unknown types", () => {
    const lines = formatItem("attachment", {}, header, "attachment");
    expect(lines).toHaveLength(1);
    expect(stripAnsi(lines[0])).toContain("attachment");
  });

  test("falls back for undefined type", () => {
    const lines = formatItem(undefined, {}, header, "unknown");
    expect(lines).toHaveLength(1);
    expect(stripAnsi(lines[0])).toContain("unknown");
  });
});

describe("isItemIncluded", () => {
  test("empty filters includes everything", () => {
    const empty = new Set<FilterValue>();
    expect(isItemIncluded("error", empty)).toBe(true);
    expect(isItemIncluded("transaction", empty)).toBe(true);
    expect(isItemIncluded("log", empty)).toBe(true);
    expect(isItemIncluded("attachment", empty)).toBe(true);
    expect(isItemIncluded(undefined, empty)).toBe(true);
  });

  test("error filter matches error and event types", () => {
    const filters = new Set<FilterValue>(["error"]);
    expect(isItemIncluded("error", filters)).toBe(true);
    expect(isItemIncluded("event", filters)).toBe(true);
    expect(isItemIncluded("transaction", filters)).toBe(false);
    expect(isItemIncluded("log", filters)).toBe(false);
  });

  test("transaction filter matches only transaction", () => {
    const filters = new Set<FilterValue>(["transaction"]);
    expect(isItemIncluded("transaction", filters)).toBe(true);
    expect(isItemIncluded("error", filters)).toBe(false);
  });

  test("log filter matches only log", () => {
    const filters = new Set<FilterValue>(["log"]);
    expect(isItemIncluded("log", filters)).toBe(true);
    expect(isItemIncluded("error", filters)).toBe(false);
  });

  test("non-matching item type excluded with active filters", () => {
    const filters = new Set<FilterValue>(["error"]);
    expect(isItemIncluded("attachment", filters)).toBe(false);
    expect(isItemIncluded(undefined, filters)).toBe(false);
  });
});

describe("itemTypeToFilterCategory", () => {
  test("maps error types to error", () => {
    expect(itemTypeToFilterCategory("error")).toBe("error");
    expect(itemTypeToFilterCategory("event")).toBe("error");
  });

  test("maps transaction to transaction", () => {
    expect(itemTypeToFilterCategory("transaction")).toBe("transaction");
  });

  test("maps log to log", () => {
    expect(itemTypeToFilterCategory("log")).toBe("log");
  });

  test("returns undefined for unknown types", () => {
    expect(itemTypeToFilterCategory("attachment")).toBeUndefined();
    expect(itemTypeToFilterCategory("session")).toBeUndefined();
    expect(itemTypeToFilterCategory(undefined)).toBeUndefined();
  });
});

describe("inferSource", () => {
  test("detects mobile SDK (cocoa)", () => {
    const result = stripAnsi(inferSource({ sdk: { name: "sentry.cocoa" } }));
    expect(result).toContain("[MOBILE]");
  });

  test("detects mobile SDK (android)", () => {
    const result = stripAnsi(inferSource({ sdk: { name: "sentry.android" } }));
    expect(result).toContain("[MOBILE]");
  });

  test("detects mobile SDK (react-native)", () => {
    const result = stripAnsi(
      inferSource({ sdk: { name: "sentry.javascript.react-native" } })
    );
    expect(result).toContain("[MOBILE]");
  });

  test("detects mobile SDK (flutter)", () => {
    const result = stripAnsi(
      inferSource({ sdk: { name: "sentry.dart.flutter" } })
    );
    expect(result).toContain("[MOBILE]");
  });

  test("detects browser SDK", () => {
    const result = stripAnsi(
      inferSource({ sdk: { name: "sentry.javascript.browser" } })
    );
    expect(result).toContain("[BROWSER]");
  });

  test("detects server JS SDK (node)", () => {
    const result = stripAnsi(
      inferSource({ sdk: { name: "sentry.javascript.node" } })
    );
    expect(result).toContain("[SERVER]");
  });

  test("detects server JS SDK (nextjs)", () => {
    const result = stripAnsi(
      inferSource({ sdk: { name: "sentry.javascript.nextjs" } })
    );
    expect(result).toContain("[SERVER]");
  });

  test("defaults to server for unknown SDK", () => {
    const result = stripAnsi(inferSource({ sdk: { name: "sentry.python" } }));
    expect(result).toContain("[SERVER]");
  });

  test("defaults to server when no SDK", () => {
    const result = stripAnsi(inferSource({}));
    expect(result).toContain("[SERVER]");
  });
});
