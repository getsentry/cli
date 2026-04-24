/**
 * Opt-in transport-level metrics for the Sentry SDK telemetry pipeline.
 *
 * When `SENTRY_TRANSPORT_METRICS=1` is set, {@link emitTransportMetric}
 * writes a single line of JSON to stderr per outbound envelope. Off by
 * default — no cost in production beyond a single env-var read.
 *
 * Emitted fields:
 *   - `ts`             epoch ms when the metric was emitted
 *   - `kind`           always `"sentry_transport"` (for greppability)
 *   - `envelope_type`  first-item type (`"event"`, `"transaction"`,
 *                      `"log"`, `"session"`, `"client_report"`, …) or
 *                      `"unknown"` if the envelope couldn't be parsed
 *   - `encoding`       `"zstd"` | `"gzip"` | `"none"`
 *   - `raw_bytes`      body size before compression
 *   - `sent_bytes`     body size on the wire
 *   - `compress_ms`    wall-clock compress time in milliseconds (0 if
 *                      the body was under the compression threshold)
 *   - `ratio`          sent / raw (1.0 if no compression)
 *
 * The envelope-type sniff is passed as a callback so we only pay its
 * JSON-parse cost when the metric is actually emitted.
 */

import { getEnv } from "../env.js";

export type TransportEncoding = "zstd" | "gzip" | "none";

export type TransportMetricInput = {
  rawBytes: number;
  sentBytes: number;
  compressMs: number;
  encoding: TransportEncoding;
  /** Lazy envelope-type extractor. Invoked only when the metric is emitted. */
  envelopeType: () => string | undefined;
};

/** Emit a single JSON line to stderr iff `SENTRY_TRANSPORT_METRICS=1`. */
export function emitTransportMetric(m: TransportMetricInput): void {
  if (getEnv().SENTRY_TRANSPORT_METRICS !== "1") {
    return;
  }
  const ratio = m.rawBytes > 0 ? m.sentBytes / m.rawBytes : 1;
  const line = JSON.stringify({
    ts: Date.now(),
    kind: "sentry_transport",
    envelope_type: m.envelopeType() ?? "unknown",
    encoding: m.encoding,
    raw_bytes: m.rawBytes,
    sent_bytes: m.sentBytes,
    compress_ms: Number(m.compressMs.toFixed(2)),
    ratio: Number(ratio.toFixed(3)),
  });
  process.stderr.write(`${line}\n`);
}

/**
 * Peek at the first envelope item header to classify the envelope.
 *
 * Envelope wire format (https://develop.sentry.dev/sdk/envelopes/):
 *
 *     {envelope_header}\n
 *     {item_1_header}\n
 *     {item_1_body}\n
 *     {item_2_header}\n
 *     ...
 *
 * Only the first item's `type` field is needed. We decode at most the
 * first ~512 bytes (well beyond the largest reasonable item header) to
 * avoid slurping the whole envelope for a classification hint.
 *
 * @param body Raw envelope bytes (pre-compression) or string.
 * @returns The first item's `type` or `undefined` if the envelope can't
 *   be parsed (empty, truncated, non-JSON item header).
 */
export function detectEnvelopeType(
  body: Buffer | Uint8Array | string
): string | undefined {
  const text =
    typeof body === "string"
      ? body.slice(0, 512)
      : Buffer.from(
          body.buffer,
          body.byteOffset,
          Math.min(body.byteLength, 512)
        ).toString("utf-8");

  const firstNl = text.indexOf("\n");
  if (firstNl < 0) {
    return;
  }
  const secondNl = text.indexOf("\n", firstNl + 1);
  const itemHeader = text.slice(
    firstNl + 1,
    secondNl > 0 ? secondNl : undefined
  );
  if (!itemHeader) {
    return;
  }
  try {
    const parsed = JSON.parse(itemHeader) as { type?: unknown };
    return typeof parsed.type === "string" ? parsed.type : undefined;
  } catch {
    return;
  }
}
