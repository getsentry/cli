/**
 * Unit tests for the transport-metrics emitter.
 *
 * Exercises the two public helpers directly:
 *   - `emitTransportMetric` is gated on `SENTRY_TRANSPORT_METRICS=1`,
 *     and when enabled writes one JSON line to stderr with the
 *     expected shape.
 *   - `detectEnvelopeType` parses the first item header out of a
 *     real envelope wire format, and returns `undefined` on malformed
 *     input (empty, truncated, non-JSON header).
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createEnvelope, serializeEnvelope } from "@sentry/core";
import {
  detectEnvelopeType,
  emitTransportMetric,
} from "../../../src/lib/telemetry/zstd-transport-metrics.ts";

const METRICS_ENV_VAR = "SENTRY_TRANSPORT_METRICS";

/** Lazy envelope-type stub that returns undefined (matches the envelope
 * parser's failure case). Declared as a named function rather than
 * `() => undefined` to satisfy biome's `noUselessUndefined` rule. */
function noEnvelopeType(): string | undefined {
  return;
}

/**
 * Capture `process.stderr.write` calls into an array for the duration
 * of a callback. Restores the original writer unconditionally.
 */
function captureStderr<T>(fn: () => T): { lines: string[]; result: T } {
  const lines: string[] = [];
  const original = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk: string | Uint8Array, ...rest: any[]) => {
    const text =
      typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf-8");
    lines.push(text);
    return original(chunk, ...rest);
  }) as typeof process.stderr.write;
  try {
    const result = fn();
    return { lines, result };
  } finally {
    process.stderr.write = original;
  }
}

describe("emitTransportMetric", () => {
  let savedEnv: string | undefined;

  beforeEach(() => {
    savedEnv = process.env[METRICS_ENV_VAR];
  });

  afterEach(() => {
    if (savedEnv === undefined) {
      delete process.env[METRICS_ENV_VAR];
    } else {
      process.env[METRICS_ENV_VAR] = savedEnv;
    }
  });

  test("off by default: emits nothing", () => {
    delete process.env[METRICS_ENV_VAR];
    const { lines } = captureStderr(() =>
      emitTransportMetric({
        rawBytes: 100,
        sentBytes: 50,
        compressMs: 1.5,
        encoding: "zstd",
        envelopeType: () => "event",
      })
    );
    expect(lines).toHaveLength(0);
  });

  test("enabled: emits one JSON line with expected fields", () => {
    process.env[METRICS_ENV_VAR] = "1";
    const { lines } = captureStderr(() =>
      emitTransportMetric({
        rawBytes: 1000,
        sentBytes: 250,
        compressMs: 1.234_567,
        encoding: "zstd",
        envelopeType: () => "event",
      })
    );
    expect(lines).toHaveLength(1);
    const payload = JSON.parse(lines[0]!.trim()) as Record<string, unknown>;
    expect(payload.kind).toBe("sentry_transport");
    expect(payload.envelope_type).toBe("event");
    expect(payload.encoding).toBe("zstd");
    expect(payload.raw_bytes).toBe(1000);
    expect(payload.sent_bytes).toBe(250);
    expect(payload.compress_ms).toBe(1.23); // rounded to 2 decimals
    expect(payload.ratio).toBe(0.25); // 250/1000 rounded to 3
    expect(typeof payload.ts).toBe("number");
  });

  test("envelopeType returning undefined → 'unknown'", () => {
    process.env[METRICS_ENV_VAR] = "1";
    const { lines } = captureStderr(() =>
      emitTransportMetric({
        rawBytes: 100,
        sentBytes: 100,
        compressMs: 0,
        encoding: "none",
        envelopeType: noEnvelopeType,
      })
    );
    const payload = JSON.parse(lines[0]!.trim()) as Record<string, unknown>;
    expect(payload.envelope_type).toBe("unknown");
    expect(payload.encoding).toBe("none");
    expect(payload.ratio).toBe(1);
  });

  test("rawBytes=0 → ratio defaults to 1 (no division by zero)", () => {
    process.env[METRICS_ENV_VAR] = "1";
    const { lines } = captureStderr(() =>
      emitTransportMetric({
        rawBytes: 0,
        sentBytes: 0,
        compressMs: 0,
        encoding: "none",
        envelopeType: () => "event",
      })
    );
    const payload = JSON.parse(lines[0]!.trim()) as Record<string, unknown>;
    expect(payload.ratio).toBe(1);
  });

  test("any value other than '1' leaves the emitter off", () => {
    process.env[METRICS_ENV_VAR] = "true";
    const { lines } = captureStderr(() =>
      emitTransportMetric({
        rawBytes: 100,
        sentBytes: 100,
        compressMs: 0,
        encoding: "none",
        envelopeType: () => "event",
      })
    );
    expect(lines).toHaveLength(0);
  });

  test("gzip encoding surfaces in the emitted line", () => {
    process.env[METRICS_ENV_VAR] = "1";
    const { lines } = captureStderr(() =>
      emitTransportMetric({
        rawBytes: 5000,
        sentBytes: 500,
        compressMs: 0.5,
        encoding: "gzip",
        envelopeType: () => "transaction",
      })
    );
    const payload = JSON.parse(lines[0]!.trim()) as Record<string, unknown>;
    expect(payload.encoding).toBe("gzip");
    expect(payload.envelope_type).toBe("transaction");
  });
});

describe("detectEnvelopeType", () => {
  test("extracts type from a real event envelope", () => {
    const envelope = createEnvelope({ event_id: "a".repeat(32) } as any, [
      [{ type: "event" } as any, { message: "hi" } as any],
    ]);
    const wire = serializeEnvelope(envelope);
    expect(detectEnvelopeType(wire)).toBe("event");
  });

  test("extracts type from a transaction envelope (string input)", () => {
    const wire =
      '{"event_id":"a"}\n{"type":"transaction","length":17}\n{"some":"span"}\n';
    expect(detectEnvelopeType(wire)).toBe("transaction");
  });

  test("extracts type from a Buffer input", () => {
    const wire = '{"event_id":"a"}\n{"type":"log"}\n{"items":[]}\n';
    expect(detectEnvelopeType(Buffer.from(wire, "utf-8"))).toBe("log");
  });

  test("extracts type from a Uint8Array input", () => {
    const wire = '{"event_id":"a"}\n{"type":"session"}\n{"sid":"x"}\n';
    expect(detectEnvelopeType(new TextEncoder().encode(wire))).toBe("session");
  });

  test("returns undefined on empty input", () => {
    expect(detectEnvelopeType("")).toBeUndefined();
    expect(detectEnvelopeType(Buffer.alloc(0))).toBeUndefined();
  });

  test("returns undefined on single-line (no newline) input", () => {
    expect(detectEnvelopeType("{}")).toBeUndefined();
  });

  test("returns undefined when the item header is not JSON", () => {
    expect(detectEnvelopeType('{}\nnot json\n{"body":1}\n')).toBeUndefined();
  });

  test("returns undefined when the item header has a non-string type", () => {
    expect(detectEnvelopeType('{}\n{"type":42}\n{}\n')).toBeUndefined();
  });

  test("returns undefined when item header is missing the type field", () => {
    expect(detectEnvelopeType('{}\n{"length":0}\n{}\n')).toBeUndefined();
  });

  test("caps header scan at first 512 bytes", () => {
    // Even if the envelope is enormous, only the first 512 bytes are
    // decoded — a valid item header in the first 512 still resolves.
    const big = "x".repeat(10 * 1024);
    const wire = `{"event_id":"a"}\n{"type":"event"}\n${big}`;
    expect(detectEnvelopeType(wire)).toBe("event");
  });

  test("returns undefined when first-item header lives past byte 512", () => {
    // Envelope header alone longer than 512 bytes → item header is
    // past the scan window → undefined.
    const big = "x".repeat(1024);
    const wire = `{"pad":"${big}"}\n{"type":"event"}\n{}\n`;
    expect(detectEnvelopeType(wire)).toBeUndefined();
  });

  test("handles item header at end of input (no trailing newline)", () => {
    const wire = '{}\n{"type":"event"}';
    expect(detectEnvelopeType(wire)).toBe("event");
  });

  test("returns undefined when the item header slot is empty (adjacent newlines)", () => {
    // envelope header immediately followed by another newline — empty
    // item header, nothing to parse.
    expect(detectEnvelopeType("{}\n\n{}\n")).toBeUndefined();
  });
});
