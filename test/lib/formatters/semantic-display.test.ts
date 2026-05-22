/**
 * Unit tests for OTel semantic attribute rendering.
 *
 * Tests cover the primary semantic formatters (GenAI, MCP, HTTP, DB, process)
 * and the integration helpers used by the local formatter.
 */

import { describe, expect, test } from "vitest";
import {
  type AttributeSource,
  formatDisplayPart,
  formatSemanticSpanDisplay,
  inferSemanticOp,
  mergeTransactionAttributes,
} from "../../../src/lib/formatters/semantic-display.js";

describe("formatSemanticSpanDisplay", () => {
  describe("GenAI spans", () => {
    test("renders gen_ai operation with model", () => {
      const attrs: AttributeSource = {
        "gen_ai.operation.name": "chat",
        "gen_ai.request.model": "claude-4-sonnet",
        "gen_ai.provider.name": "anthropic",
      };
      const result = formatSemanticSpanDisplay(attrs, "fallback");
      expect(result.label).toBe("chat anthropic/claude-4-sonnet");
      expect(result.metadata).toEqual([]);
    });

    test("renders gen_ai operation with tool name and model in metadata", () => {
      const attrs: AttributeSource = {
        "gen_ai.operation.name": "execute_tool",
        "gen_ai.tool.name": "search_files",
        "gen_ai.request.model": "gpt-4o",
      };
      const result = formatSemanticSpanDisplay(attrs, "fallback");
      expect(result.label).toBe("execute_tool search_files");
      expect(result.metadata).toContain("gpt-4o");
    });

    test("renders gen_ai agent name", () => {
      const attrs: AttributeSource = {
        "gen_ai.operation.name": "invoke_agent",
        "gen_ai.agent.name": "code-reviewer",
      };
      const result = formatSemanticSpanDisplay(attrs, "fallback");
      expect(result.label).toBe("invoke_agent code-reviewer");
    });

    test("renders model with provider prefix when no slash", () => {
      const attrs: AttributeSource = {
        "gen_ai.request.model": "gpt-4o",
        "gen_ai.provider.name": "openai",
      };
      const result = formatSemanticSpanDisplay(attrs, "fallback");
      expect(result.label).toBe("openai/gpt-4o");
    });

    test("does not double-prefix model that already has slash", () => {
      const attrs: AttributeSource = {
        "gen_ai.request.model": "anthropic/claude-4-sonnet",
        "gen_ai.provider.name": "anthropic",
      };
      const result = formatSemanticSpanDisplay(attrs, "fallback");
      expect(result.label).toBe("anthropic/claude-4-sonnet");
    });

    test("prefers response model over request model", () => {
      const attrs: AttributeSource = {
        "gen_ai.response.model": "gpt-4o-2026-05-13",
        "gen_ai.request.model": "gpt-4o",
      };
      const result = formatSemanticSpanDisplay(attrs, "fallback");
      expect(result.label).toBe("gpt-4o-2026-05-13");
    });

    test("shows error type in metadata", () => {
      const attrs: AttributeSource = {
        "gen_ai.operation.name": "chat",
        "gen_ai.request.model": "gpt-4o",
        "error.type": "RateLimitError",
      };
      const result = formatSemanticSpanDisplay(attrs, "fallback");
      expect(result.metadata).toContain("RateLimitError");
    });

    test("falls back when no gen_ai attributes present", () => {
      const attrs: AttributeSource = { "some.other": "value" };
      const result = formatSemanticSpanDisplay(attrs, "my-transaction");
      expect(result.label).toBe("my-transaction");
      expect(result.metadata).toEqual([]);
    });
  });

  describe("MCP spans", () => {
    test("renders MCP method with tool name", () => {
      const attrs: AttributeSource = {
        "mcp.method.name": "tools/call",
        "gen_ai.tool.name": "search_files",
      };
      const result = formatSemanticSpanDisplay(attrs, "fallback");
      expect(result.label).toBe("tools/call search_files");
    });

    test("renders MCP method with resource URI", () => {
      const attrs: AttributeSource = {
        "mcp.method.name": "resources/read",
        "mcp.resource.uri": "file:///src/main.ts?line=42",
      };
      const result = formatSemanticSpanDisplay(attrs, "fallback");
      expect(result.label).toBe("resources/read file:///src/main.ts");
    });

    test("MCP takes priority over HTTP transport attributes", () => {
      const attrs: AttributeSource = {
        "mcp.method.name": "tools/call",
        "gen_ai.tool.name": "search_files",
        "http.request.method": "POST",
        "url.full": "http://localhost:3000/mcp",
      };
      const result = formatSemanticSpanDisplay(attrs, "POST");
      expect(result.label).toBe("tools/call search_files");
    });
  });

  describe("HTTP spans", () => {
    test("renders HTTP method with URL target", () => {
      const attrs: AttributeSource = {
        "http.request.method": "get",
        "url.full": "https://api.example.com/v1/users?page=1",
      };
      const result = formatSemanticSpanDisplay(attrs, "fallback");
      expect(result.label).toBe("GET api.example.com/v1/users");
    });

    test("renders HTTP method with route", () => {
      const attrs: AttributeSource = {
        "http.request.method": "POST",
        "http.route": "/api/v1/messages",
      };
      const result = formatSemanticSpanDisplay(attrs, "fallback");
      expect(result.label).toBe("POST /api/v1/messages");
    });

    test("shows status code in metadata", () => {
      const attrs: AttributeSource = {
        "http.request.method": "GET",
        "http.response.status_code": "200",
        "server.address": "api.openai.com",
      };
      const result = formatSemanticSpanDisplay(attrs, "fallback");
      expect(result.metadata).toContain("200");
    });

    test("shows server address with port", () => {
      const attrs: AttributeSource = {
        "http.request.method": "POST",
        "server.address": "api.anthropic.com",
        "server.port": "443",
      };
      const result = formatSemanticSpanDisplay(attrs, "fallback");
      expect(result.label).toBe("POST api.anthropic.com:443");
    });
  });

  describe("Database spans", () => {
    test("renders DB query summary", () => {
      const attrs: AttributeSource = {
        "db.system.name": "postgresql",
        "db.query.summary": "SELECT users",
      };
      const result = formatSemanticSpanDisplay(attrs, "fallback");
      expect(result.label).toBe("SELECT users");
      expect(result.metadata).toContain("postgresql");
    });

    test("renders DB operation with collection", () => {
      const attrs: AttributeSource = {
        "db.system.name": "redis",
        "db.operation.name": "GET",
        "db.collection.name": "sessions",
      };
      const result = formatSemanticSpanDisplay(attrs, "fallback");
      expect(result.label).toBe("GET sessions");
      expect(result.metadata).toContain("redis");
    });

    test("parameterizes DB query text", () => {
      const attrs: AttributeSource = {
        "db.system.name": "mysql",
        "db.query.text": "SELECT * FROM users WHERE id = 42 AND name = 'Alice'",
      };
      const result = formatSemanticSpanDisplay(attrs, "fallback");
      expect(result.label).toBe(
        "SELECT * FROM users WHERE id = ? AND name = ?"
      );
    });
  });

  describe("Process spans", () => {
    test("renders process command with exit code", () => {
      const attrs: AttributeSource = {
        "process.executable.name": "git",
        "process.exit.code": "0",
      };
      const result = formatSemanticSpanDisplay(attrs, "fallback");
      expect(result.label).toBe("git");
      expect(result.metadata).toContain("exit:0");
    });

    test("renders non-zero exit code", () => {
      const attrs: AttributeSource = {
        "process.executable.name": "npm",
        "process.exit.code": "1",
      };
      const result = formatSemanticSpanDisplay(attrs, "fallback");
      expect(result.label).toBe("npm");
      expect(result.metadata).toContain("exit:1");
    });
  });

  describe("FaaS spans", () => {
    test("renders FaaS invocation with coldstart", () => {
      const attrs: AttributeSource = {
        "faas.trigger": "http",
        "faas.invoked_name": "processOrder",
        "faas.invoked_provider": "aws",
        "faas.coldstart": "true",
      };
      const result = formatSemanticSpanDisplay(attrs, "fallback");
      expect(result.label).toBe("http processOrder");
      expect(result.metadata).toContain("aws");
      expect(result.metadata).toContain("coldstart");
    });

    test("ignores faas.coldstart=false", () => {
      const attrs: AttributeSource = {
        "faas.trigger": "http",
        "faas.invoked_name": "handler",
        "faas.coldstart": "false",
      };
      const result = formatSemanticSpanDisplay(attrs, "fallback");
      expect(result.label).toBe("http handler");
      expect(result.metadata).not.toContain("coldstart");
    });
  });

  describe("Error/exception spans", () => {
    test("renders error type as metadata", () => {
      const attrs: AttributeSource = {
        "error.type": "TimeoutError",
      };
      const result = formatSemanticSpanDisplay(attrs, "my-transaction");
      expect(result.label).toBe("my-transaction");
      expect(result.metadata).toContain("TimeoutError");
    });

    test("renders exception type for unnamed spans", () => {
      const attrs: AttributeSource = {
        "exception.type": "ValueError",
        "exception.message": "invalid input",
      };
      const result = formatSemanticSpanDisplay(attrs, "unnamed");
      expect(result.label).toBe("ValueError");
    });

    test("shows exception type as metadata for named spans", () => {
      const attrs: AttributeSource = {
        "exception.type": "IOError",
      };
      const result = formatSemanticSpanDisplay(attrs, "read-file");
      expect(result.label).toBe("read-file");
      expect(result.metadata).toContain("IOError");
    });
  });

  describe("fallback behavior", () => {
    test("returns fallback label for empty attributes", () => {
      const result = formatSemanticSpanDisplay({}, "GET /api/users");
      expect(result.label).toBe("GET /api/users");
      expect(result.metadata).toEqual([]);
    });

    test("truncates very long labels", () => {
      const attrs: AttributeSource = {
        "gen_ai.operation.name": "a".repeat(200),
      };
      const result = formatSemanticSpanDisplay(attrs, "fallback");
      expect(result.label.length).toBeLessThanOrEqual(123); // 120 + "..."
    });
  });
});

describe("inferSemanticOp", () => {
  test("returns gen_ai for GenAI attributes", () => {
    expect(inferSemanticOp({ "gen_ai.operation.name": "chat" })).toBe("gen_ai");
  });

  test("returns gen_ai for tool name", () => {
    expect(inferSemanticOp({ "gen_ai.tool.name": "search" })).toBe("gen_ai");
  });

  test("returns gen_ai for agent name", () => {
    expect(inferSemanticOp({ "gen_ai.agent.name": "coder" })).toBe("gen_ai");
  });

  test("returns mcp for MCP attributes", () => {
    expect(inferSemanticOp({ "mcp.method.name": "tools/call" })).toBe("mcp");
  });

  test("returns db for database attributes", () => {
    expect(inferSemanticOp({ "db.system.name": "postgresql" })).toBe("db");
  });

  test("returns undefined for HTTP (keeps original op)", () => {
    expect(inferSemanticOp({ "http.request.method": "GET" })).toBeUndefined();
  });

  test("returns undefined for no attributes", () => {
    expect(inferSemanticOp({})).toBeUndefined();
  });

  test("returns process for process attributes", () => {
    expect(inferSemanticOp({ "process.executable.name": "git" })).toBe(
      "process"
    );
  });

  test("returns rpc for RPC attributes", () => {
    expect(inferSemanticOp({ "rpc.system.name": "grpc" })).toBe("rpc");
  });

  test("returns messaging for messaging attributes", () => {
    expect(inferSemanticOp({ "messaging.system": "kafka" })).toBe("messaging");
  });
});

describe("mergeTransactionAttributes", () => {
  test("extracts attributes from contexts.trace.data", () => {
    const event = {
      contexts: {
        trace: {
          data: {
            "gen_ai.operation.name": "chat",
            "gen_ai.request.model": "gpt-4o",
          },
        },
      },
    };
    const attrs = mergeTransactionAttributes(event);
    expect(attrs["gen_ai.operation.name"]).toBe("chat");
    expect(attrs["gen_ai.request.model"]).toBe("gpt-4o");
  });

  test("returns empty object when no data", () => {
    expect(mergeTransactionAttributes({})).toEqual({});
    expect(mergeTransactionAttributes({ contexts: {} })).toEqual({});
    expect(mergeTransactionAttributes({ contexts: { trace: {} } })).toEqual({});
  });
});

describe("formatDisplayPart", () => {
  test("formats string values", () => {
    expect(formatDisplayPart("hello", 64)).toBe("hello");
  });

  test("formats numeric values", () => {
    expect(formatDisplayPart(200, 64)).toBe("200");
  });

  test("formats boolean values", () => {
    expect(formatDisplayPart(true, 64)).toBe("true");
  });

  test("returns undefined for null/undefined", () => {
    expect(formatDisplayPart(null, 64)).toBeUndefined();
    expect(formatDisplayPart(undefined, 64)).toBeUndefined();
  });

  test("returns undefined for empty string", () => {
    expect(formatDisplayPart("", 64)).toBeUndefined();
    expect(formatDisplayPart("   ", 64)).toBeUndefined();
  });

  test("truncates long values", () => {
    const long = "a".repeat(100);
    const result = formatDisplayPart(long, 20);
    expect(result).toBe(`${"a".repeat(17)}...`);
  });

  test("collapses whitespace", () => {
    expect(formatDisplayPart("hello  \n  world", 64)).toBe("hello world");
  });
});
