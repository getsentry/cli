import { describe, expect, test } from "bun:test";
import {
  type OutputConfig,
  renderCommandOutput,
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
    // First chunk is the empty line separator
    expect(w.chunks[0]).toBe("\n");
    // Second chunk contains the hint text with trailing newline
    expect(w.chunks[1]).toContain("Some hint");
    expect(w.chunks[1]).toEndWith("\n");
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
      human: (d) => `${d.name}`,
    };
    renderCommandOutput(w, { id: 1, name: "Alice" }, config, { json: true });
    expect(JSON.parse(w.output)).toEqual({ id: 1, name: "Alice" });
  });

  test("renders human output when json=false", () => {
    const w = createTestWriter();
    const config: OutputConfig<{ name: string }> = {
      json: true,
      human: (d) => `Hello ${d.name}`,
    };
    renderCommandOutput(w, { name: "Alice" }, config, { json: false });
    expect(w.output).toBe("Hello Alice\n");
  });

  test("applies fields filtering in JSON mode", () => {
    const w = createTestWriter();
    const config: OutputConfig<{ id: number; name: string; secret: string }> = {
      json: true,
      human: () => "unused",
    };
    renderCommandOutput(w, { id: 1, name: "Alice", secret: "x" }, config, {
      json: true,
      fields: ["id", "name"],
    });
    expect(JSON.parse(w.output)).toEqual({ id: 1, name: "Alice" });
  });

  test("renders hint in human mode", () => {
    const w = createTestWriter();
    const config: OutputConfig<string> = {
      json: true,
      human: () => "Result",
    };
    renderCommandOutput(w, "data", config, {
      json: false,
      hint: "Detected from .env.local",
    });
    expect(w.output).toContain("Result\n");
    expect(w.output).toContain("Detected from .env.local");
  });

  test("suppresses hint in JSON mode", () => {
    const w = createTestWriter();
    const config: OutputConfig<string> = {
      json: true,
      human: () => "Result",
    };
    renderCommandOutput(w, "data", config, {
      json: true,
      hint: "Detected from .env.local",
    });
    expect(w.output).not.toContain(".env.local");
  });

  test("works without hint", () => {
    const w = createTestWriter();
    const config: OutputConfig<{ value: number }> = {
      json: true,
      human: (d) => `Value: ${d.value}`,
    };
    renderCommandOutput(w, { value: 42 }, config, { json: false });
    expect(w.output).toBe("Value: 42\n");
  });
});
