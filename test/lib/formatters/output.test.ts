import { describe, expect, test } from "bun:test";
import {
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

    test("does not write detectedFrom in json mode", () => {
      const w = createTestWriter();
      writeOutput(
        w,
        { x: 1 },
        {
          json: true,
          formatHuman: () => "unused",
          detectedFrom: ".env",
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

    test("appends detectedFrom when provided", () => {
      const w = createTestWriter();
      writeOutput(w, "data", {
        json: false,
        formatHuman: () => "Result",
        detectedFrom: ".env.local",
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

    test("writes detectedFrom before footer", () => {
      const w = createTestWriter();
      writeOutput(w, "data", {
        json: false,
        formatHuman: () => "Body",
        detectedFrom: "DSN",
        footer: "Hint",
      });
      const detectedIdx = w.output.indexOf("Detected from DSN");
      const footerIdx = w.output.indexOf("Hint");
      expect(detectedIdx).toBeGreaterThan(-1);
      expect(footerIdx).toBeGreaterThan(detectedIdx);
    });

    test("omits detectedFrom when not provided", () => {
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

  describe("jsonData (divergent data)", () => {
    test("uses jsonData for JSON output instead of data", () => {
      const w = createTestWriter();
      const fullUser = { id: 1, name: "Alice", internalSecret: "s3cret" };
      writeOutput(w, fullUser, {
        json: true,
        jsonData: { id: fullUser.id, name: fullUser.name },
        formatHuman: () => "unused",
      });
      const parsed = JSON.parse(w.output);
      expect(parsed).toEqual({ id: 1, name: "Alice" });
      expect(w.output).not.toContain("s3cret");
    });

    test("uses data for formatHuman even when jsonData is provided", () => {
      const w = createTestWriter();
      const fullUser = { id: 1, name: "Alice", role: "admin" };
      writeOutput(w, fullUser, {
        json: false,
        jsonData: { id: fullUser.id },
        formatHuman: (user) => `${user.name} (${user.role})`,
      });
      expect(w.output).toBe("Alice (admin)\n");
    });

    test("applies fields filtering to jsonData", () => {
      const w = createTestWriter();
      writeOutput(
        w,
        { full: true },
        {
          json: true,
          fields: ["id"],
          jsonData: { id: 1, name: "Alice", extra: "x" },
          formatHuman: () => "unused",
        }
      );
      expect(JSON.parse(w.output)).toEqual({ id: 1 });
    });

    test("works with footer and detectedFrom in human mode", () => {
      const w = createTestWriter();
      writeOutput(
        w,
        { name: "Alice" },
        {
          json: false,
          jsonData: { id: 1 },
          formatHuman: (data) => `User: ${data.name}`,
          footer: "Done",
          detectedFrom: ".env",
        }
      );
      expect(w.output).toContain("User: Alice\n");
      expect(w.output).toContain("Detected from .env");
      expect(w.output).toContain("Done");
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
