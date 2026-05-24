import { describe, expect, test } from "vitest";
import {
  buildTranscriptResult,
  extractTurns,
  formatConversationTable,
  formatTranscriptResult,
  type TranscriptResult,
} from "../../../src/lib/formatters/conversation.js";
import type {
  AIConversationSpan,
  ConversationListItem,
} from "../../../src/types/conversation.js";

function makeListItem(
  overrides: Partial<ConversationListItem> = {}
): ConversationListItem {
  return {
    conversationId: "conv-abc-123",
    startTimestamp: 1_716_500_000,
    totalTokens: 500,
    toolCalls: 3,
    errors: 0,
    firstInput: "Hello world",
    user: { email: "test@example.com" },
    ...overrides,
  };
}

function makeSpan(
  overrides: Partial<AIConversationSpan> = {}
): AIConversationSpan {
  return {
    span_id: "aabb112233445566",
    trace: "00112233445566778899aabbccddeeff",
    project: "my-project",
    "span.name": "gen_ai.invoke_agent",
    "span.status": "ok",
    "precise.start_ts": 1_716_500_000,
    "precise.finish_ts": 1_716_500_010,
    "gen_ai.operation.type": "ai_client",
    "gen_ai.input.messages": '{"messages":[{"role":"user","content":"hi"}]}',
    "gen_ai.output.messages":
      '{"messages":[{"role":"assistant","content":"hello"}]}',
    "gen_ai.usage.total_tokens": "100",
    "gen_ai.request.model": "gpt-4",
    "gen_ai.response.model": "gpt-4",
    ...overrides,
  };
}

describe("formatConversationTable", () => {
  test("renders a table with conversation data", () => {
    const items = [makeListItem()];
    const result = formatConversationTable(items);
    expect(result).toContain("conv-abc-123");
    expect(result).toContain("test@example.com");
    expect(result).toContain("Hello world");
    expect(result).toContain("500");
  });

  test("handles missing user and input", () => {
    const items = [makeListItem({ user: undefined, firstInput: undefined })];
    const result = formatConversationTable(items);
    expect(result).toContain("—");
  });

  test("truncates long conversation IDs", () => {
    const longId = "a".repeat(60);
    const items = [makeListItem({ conversationId: longId })];
    const result = formatConversationTable(items);
    expect(result).not.toContain(longId);
    expect(result).toContain("…");
  });

  test("formats timestamps correctly (not 1970)", () => {
    const items = [makeListItem({ startTimestamp: 1_716_500_000 })];
    const result = formatConversationTable(items);
    expect(result).not.toContain("1970");
  });

  test("shows dash for zero timestamp", () => {
    const items = [makeListItem({ startTimestamp: 0 })];
    const result = formatConversationTable(items);
    expect(result).toContain("—");
  });
});

describe("extractTurns", () => {
  test("extracts turns from ai_client spans", () => {
    const spans = [makeSpan()];
    const turns = extractTurns(spans);
    expect(turns).toHaveLength(1);
    expect(turns[0].turn).toBe(1);
    expect(turns[0].userContent).toBe("hi");
    expect(turns[0].assistantContent).toBe("hello");
    expect(turns[0].model).toBe("gpt-4");
  });

  test("associates tool calls with the correct turn", () => {
    const aiSpan = makeSpan({
      "precise.start_ts": 100,
      "precise.finish_ts": 110,
    });
    const toolSpan = makeSpan({
      span_id: "tool111122223333",
      "gen_ai.operation.type": "tool",
      "span.name": "gen_ai.execute_tool",
      "gen_ai.tool.name": "search",
      "precise.start_ts": 105,
      "precise.finish_ts": 106,
    });
    const turns = extractTurns([aiSpan, toolSpan]);
    expect(turns).toHaveLength(1);
    expect(turns[0].toolCalls).toHaveLength(1);
    expect(turns[0].toolCalls[0].name).toBe("search");
  });

  test("returns empty array for no spans", () => {
    expect(extractTurns([])).toEqual([]);
  });

  test("sorts spans by start timestamp", () => {
    const span1 = makeSpan({
      span_id: "aaaa111122223333",
      "precise.start_ts": 200,
      "precise.finish_ts": 210,
    });
    const span2 = makeSpan({
      span_id: "bbbb111122223333",
      "precise.start_ts": 100,
      "precise.finish_ts": 110,
    });
    const turns = extractTurns([span1, span2]);
    expect(turns[0].started).toBe(100);
    expect(turns[1].started).toBe(200);
  });

  test("handles filtered content", () => {
    const span = makeSpan({
      "gen_ai.input.messages": "[Filtered]",
      "gen_ai.output.messages": "[Filtered]",
    });
    const turns = extractTurns([span]);
    expect(turns[0].userContent).toBe("[Filtered]");
    expect(turns[0].assistantContent).toBe("[Filtered]");
  });

  test("handles null content messages gracefully", () => {
    const span = makeSpan({
      "gen_ai.input.messages": JSON.stringify({
        messages: [{ role: "assistant", content: null }],
      }),
    });
    const turns = extractTurns([span]);
    expect(turns[0].userContent).toBeNull();
  });
});

describe("buildTranscriptResult", () => {
  test("builds result with span data", () => {
    const spans = [makeSpan()];
    const result = buildTranscriptResult("conv-123", "my-org", spans);
    expect(result.conversationId).toBe("conv-123");
    expect(result.org).toBe("my-org");
    expect(result.spanCount).toBe(1);
    expect(result.totalTokens).toBe(100);
    expect(result.projects).toEqual(["my-project"]);
    expect(result.startTimestamp).toBe(1_716_500_000);
    expect(result.endTimestamp).toBe(1_716_500_010);
  });

  test("returns zero timestamps for empty spans", () => {
    const result = buildTranscriptResult("conv-123", "my-org", []);
    expect(result.startTimestamp).toBe(0);
    expect(result.endTimestamp).toBe(0);
    expect(result.spanCount).toBe(0);
  });

  test("deduplicates and sorts projects", () => {
    const spans = [
      makeSpan({ project: "b-project" }),
      makeSpan({ span_id: "cc11223344556677", project: "a-project" }),
      makeSpan({ span_id: "dd11223344556677", project: "b-project" }),
    ];
    const result = buildTranscriptResult("conv-123", "my-org", spans);
    expect(result.projects).toEqual(["a-project", "b-project"]);
  });
});

describe("formatTranscriptResult", () => {
  test("shows empty message when no spans found", () => {
    const result: TranscriptResult = {
      conversationId: "conv-123",
      org: "my-org",
      turns: [],
      totalTokens: 0,
      spanCount: 0,
      projects: [],
      startTimestamp: 0,
      endTimestamp: 0,
    };
    const output = formatTranscriptResult(result);
    expect(output).toContain("No spans found");
    expect(output).toContain("conv-123");
  });

  test("renders transcript header and turns", () => {
    const spans = [makeSpan()];
    const transcript = buildTranscriptResult("conv-123", "my-org", spans);
    const output = formatTranscriptResult(transcript);
    expect(output).toContain("AI Conversation: conv-123");
    expect(output).toContain("my-org");
    expect(output).toContain("my-project");
    expect(output).toContain("[user]");
    expect(output).toContain("[assistant]");
    expect(output).toContain("Turn 1");
  });

  test("shows truncation warning", () => {
    const result: TranscriptResult = {
      conversationId: "conv-123",
      org: "my-org",
      turns: [],
      totalTokens: 0,
      spanCount: 1,
      projects: [],
      startTimestamp: 100,
      endTimestamp: 200,
      truncated: true,
    };
    const output = formatTranscriptResult(result);
    expect(output).toContain("truncated");
  });

  test("preserves newlines in multi-line content", () => {
    const span = makeSpan({
      "gen_ai.output.messages": JSON.stringify({
        messages: [
          { role: "assistant", content: "line one\nline two\nline three" },
        ],
      }),
    });
    const transcript = buildTranscriptResult("conv-123", "my-org", [span]);
    const output = formatTranscriptResult(transcript);
    expect(output).toContain("line one");
    expect(output).toContain("line two");
    expect(output).toContain("line three");
  });
});
