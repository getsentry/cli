import { describe, expect, test } from "bun:test";
import {
  type OutputConfig,
  renderCommandOutput,
  stateless,
  writeFooter,
  writeOutput,
} from "../../../src/lib/formatters/output.js";

/** Collect all writes to a string array for assertions. */
function createTestWriter() {
  const chunks: string[] = [];
  return {
    write(data: string) {
      chunks.push(data);
      return true;
    },
    chunks,
    /** Full concatenated output */
    get output() {
      return chunks.join("");
    },
  };
}

/**
 * Test helper: calls renderCommandOutput with a fresh renderer resolved
 * from the config. Mirrors the real wrapper's per-invocation resolve.
 */
function render(
  w: ReturnType<typeof createTestWriter>,
  data: unknown,
  config: OutputConfig<any>,
  ctx: { json: boolean; fields?: string[] }
) {
  const renderer = config.human();
  renderCommandOutput(w, data, config, renderer, ctx);
}

describe("writeOutput", () => {
  describe("json mode", () => {
    test("writes JSON with fields filtering", () => {
      const w = createTestWriter();
      writeOutput(
        w,
        { id: 1, name: "Alice", secret: "x" },
        {
          json: true,
          fields: ["id", "name"],
          formatHuman: () => "should not be called",
        }
      );
      const parsed = JSON.parse(w.output);
      expect(parsed).toEqual({ id: 1, name: "Alice" });
    });

    test("writes full JSON when no fields specified", () => {
      const w = createTestWriter();
      writeOutput(
        w,
        { a: 1, b: 2 },
        {
          json: true,
          formatHuman: () => "unused",
        }
      );
      expect(JSON.parse(w.output)).toEqual({ a: 1, b: 2 });
    });

    test("does not call formatHuman in json mode", () => {
      const w = createTestWriter();
      let called = false;
      writeOutput(
        w,
        { x: 1 },
        {
          json: true,
          formatHuman: () => {
            called = true;
            return "nope";
          },
        }
      );
      expect(called).toBe(false);
    });

    test("does not write footer in json mode", () => {
      const w = createTestWriter();
      writeOutput(
        w,
        { x: 1 },
        {
          json: true,
          formatHuman: () => "unused",
          footer: "Should not appear",
        }
      );
      expect(w.output).not.toContain("Should not appear");
    });

    test("does not write hint in json mode", () => {
      const w = createTestWriter();
      writeOutput(
        w,
        { x: 1 },
        {
          json: true,
          formatHuman: () => "unused",
          hint: "Detected from .env",
        }
      );
      expect(w.output).not.toContain(".env");
    });
  });

  describe("human mode", () => {
    test("calls formatHuman and writes with trailing newline", () => {
      const w = createTestWriter();
      writeOutput(
        w,
        { name: "Alice" },
        {
          json: false,
          formatHuman: (data) => `Hello ${data.name}`,
        }
      );
      expect(w.output).toBe("Hello Alice\n");
    });

    test("appends hint when provided", () => {
      const w = createTestWriter();
      writeOutput(w, "data", {
        json: false,
        formatHuman: () => "Result",
        hint: "Detected from .env.local",
      });
      expect(w.output).toContain("Result\n");
      expect(w.output).toContain("Detected from .env.local");
    });

    test("appends footer when provided", () => {
      const w = createTestWriter();
      writeOutput(w, "data", {
        json: false,
        formatHuman: () => "Main output",
        footer: "Tip: try something",
      });
      expect(w.output).toContain("Main output\n");
      expect(w.output).toContain("Tip: try something");
    });

    test("writes hint before footer", () => {
      const w = createTestWriter();
      writeOutput(w, "data", {
        json: false,
        formatHuman: () => "Body",
        hint: "Detected from DSN",
        footer: "Hint",
      });
      const hintIdx = w.output.indexOf("Detected from DSN");
      const footerIdx = w.output.indexOf("Hint");
      expect(hintIdx).toBeGreaterThan(-1);
      expect(footerIdx).toBeGreaterThan(hintIdx);
    });

    test("omits hint when not provided", () => {
      const w = createTestWriter();
      writeOutput(w, 42, {
        json: false,
        formatHuman: (n) => `Number: ${n}`,
      });
      expect(w.output).toBe("Number: 42\n");
      expect(w.output).not.toContain("Detected from");
    });

    test("omits footer when not provided", () => {
      const w = createTestWriter();
      writeOutput(w, 42, {
        json: false,
        formatHuman: (n) => `Number: ${n}`,
      });
      // Only the main output + newline
      expect(w.chunks).toHaveLength(1);
    });
  });
});

describe("writeFooter", () => {
  test("writes empty line followed by muted text", () => {
    const w = createTestWriter();
    writeFooter(w, "Some hint");
    const output = w.chunks.join("");
    expect(output).toStartWith("\n");
    expect(output).toContain("Some hint");
    expect(output).toEndWith("\n");
  });
});

// ---------------------------------------------------------------------------
// Return-based output (renderCommandOutput)
// ---------------------------------------------------------------------------

describe("renderCommandOutput", () => {
  test("renders JSON when json=true", () => {
    const w = createTestWriter();
    const config: OutputConfig<{ id: number; name: string }> = {
      json: true,
      human: stateless((d) => `${d.name}`),
    };
    render(w, { id: 1, name: "Alice" }, config, { json: true });
    expect(JSON.parse(w.output)).toEqual({ id: 1, name: "Alice" });
  });

  test("renders human output when json=false", () => {
    const w = createTestWriter();
    const config: OutputConfig<{ name: string }> = {
      json: true,
      human: stateless((d) => `Hello ${d.name}`),
    };
    render(w, { name: "Alice" }, config, { json: false });
    expect(w.output).toBe("Hello Alice\n");
  });

  test("applies fields filtering in JSON mode", () => {
    const w = createTestWriter();
    const config: OutputConfig<{ id: number; name: string; secret: string }> = {
      json: true,
      human: stateless(() => "unused"),
    };
    render(w, { id: 1, name: "Alice", secret: "x" }, config, {
      json: true,
      fields: ["id", "name"],
    });
    expect(JSON.parse(w.output)).toEqual({ id: 1, name: "Alice" });
  });

  test("does not render hints (hints are rendered by the wrapper after generator completes)", () => {
    const w = createTestWriter();
    const config: OutputConfig<string> = {
      json: true,
      human: stateless(() => "Result"),
    };
    // renderCommandOutput only renders data — hints are handled by
    // buildCommand's wrapper via the generator return value
    render(w, "data", config, { json: false });
    expect(w.output).toBe("Result\n");
  });

  test("works without hint", () => {
    const w = createTestWriter();
    const config: OutputConfig<{ value: number }> = {
      json: true,
      human: stateless((d) => `Value: ${d.value}`),
    };
    render(w, { value: 42 }, config, { json: false });
    expect(w.output).toBe("Value: 42\n");
  });

  test("jsonExclude strips fields from JSON output", () => {
    const w = createTestWriter();
    const config: OutputConfig<{
      id: number;
      name: string;
      spanTreeLines?: string[];
    }> = {
      json: true,
      human: stateless((d) => `${d.id}: ${d.name}`),
      jsonExclude: ["spanTreeLines"],
    };
    render(
      w,
      { id: 1, name: "Alice", spanTreeLines: ["line1", "line2"] },
      config,
      { json: true }
    );
    const parsed = JSON.parse(w.output);
    expect(parsed).toEqual({ id: 1, name: "Alice" });
    expect(parsed).not.toHaveProperty("spanTreeLines");
  });

  test("jsonExclude does not affect human output", () => {
    const w = createTestWriter();
    const config: OutputConfig<{
      id: number;
      spanTreeLines?: string[];
    }> = {
      json: true,
      human: stateless(
        (d) => `${d.id}\n${d.spanTreeLines ? d.spanTreeLines.join("\n") : ""}`
      ),
      jsonExclude: ["spanTreeLines"],
    };
    render(w, { id: 1, spanTreeLines: ["line1", "line2"] }, config, {
      json: false,
    });
    expect(w.output).toContain("line1");
    expect(w.output).toContain("line2");
  });

  test("jsonExclude with empty array is a no-op", () => {
    const w = createTestWriter();
    const config: OutputConfig<{ id: number; extra: string }> = {
      json: true,
      human: stateless((d) => `${d.id}`),
      jsonExclude: [],
    };
    render(w, { id: 1, extra: "keep" }, config, { json: true });
    const parsed = JSON.parse(w.output);
    expect(parsed).toEqual({ id: 1, extra: "keep" });
  });

  test("jsonExclude strips fields from array elements", () => {
    const w = createTestWriter();
    const config: OutputConfig<any> = {
      json: true,
      human: stateless((d: { id: number; name: string }[]) =>
        d.map((e) => e.name).join(", ")
      ),
      jsonExclude: ["detectedFrom"],
    };
    render(
      w,
      [
        { id: 1, name: "a", detectedFrom: "dsn" },
        { id: 2, name: "b" },
      ],
      config,
      { json: true }
    );
    const parsed = JSON.parse(w.output);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toEqual([
      { id: 1, name: "a" },
      { id: 2, name: "b" },
    ]);
  });

  test("jsonTransform reshapes data for JSON output", () => {
    const w = createTestWriter();
    type ListResult = {
      items: { id: number; name: string }[];
      hasMore: boolean;
      org: string;
    };
    const config: OutputConfig<ListResult> = {
      json: true,
      human: stateless((d) => d.items.map((i) => i.name).join(", ")),
      jsonTransform: (data) => ({
        data: data.items,
        hasMore: data.hasMore,
      }),
    };
    render(
      w,
      { items: [{ id: 1, name: "Alice" }], hasMore: true, org: "test-org" },
      config,
      { json: true }
    );
    const parsed = JSON.parse(w.output);
    expect(parsed).toEqual({
      data: [{ id: 1, name: "Alice" }],
      hasMore: true,
    });
    // org should not appear (transform omits it)
    expect(parsed).not.toHaveProperty("org");
  });

  test("jsonTransform receives fields for per-element filtering", () => {
    const w = createTestWriter();
    type ListResult = {
      items: { id: number; name: string; secret: string }[];
      hasMore: boolean;
    };
    const config: OutputConfig<ListResult> = {
      json: true,
      human: stateless(() => "unused"),
      jsonTransform: (data, fields) => ({
        data:
          fields && fields.length > 0
            ? data.items.map((item) => {
                const filtered: Record<string, unknown> = {};
                for (const f of fields) {
                  if (f in item) {
                    filtered[f] = (item as Record<string, unknown>)[f];
                  }
                }
                return filtered;
              })
            : data.items,
        hasMore: data.hasMore,
      }),
    };
    render(
      w,
      {
        items: [{ id: 1, name: "Alice", secret: "x" }],
        hasMore: false,
      },
      config,
      { json: true, fields: ["id", "name"] }
    );
    const parsed = JSON.parse(w.output);
    expect(parsed.data[0]).toEqual({ id: 1, name: "Alice" });
    expect(parsed.data[0]).not.toHaveProperty("secret");
  });

  test("jsonTransform is ignored in human mode", () => {
    const w = createTestWriter();
    const config: OutputConfig<{ items: string[]; org: string }> = {
      json: true,
      human: stateless((d) => `${d.org}: ${d.items.join(", ")}`),
      jsonTransform: (data) => ({ data: data.items }),
    };
    render(w, { items: ["a", "b"], org: "test-org" }, config, {
      json: false,
    });
    expect(w.output).toBe("test-org: a, b\n");
  });

  test("jsonTransform takes precedence over jsonExclude", () => {
    const w = createTestWriter();
    const config: OutputConfig<{ id: number; name: string; extra: string }> = {
      json: true,
      human: stateless(() => "unused"),
      jsonExclude: ["extra"],
      jsonTransform: (data) => ({ transformed: true, id: data.id }),
    };
    render(w, { id: 1, name: "Alice", extra: "kept-by-transform" }, config, {
      json: true,
    });
    const parsed = JSON.parse(w.output);
    // jsonTransform output, not jsonExclude
    expect(parsed).toEqual({ transformed: true, id: 1 });
  });
});
