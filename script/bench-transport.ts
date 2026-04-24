/**
 * Offline benchmark for the telemetry transport's compression codecs.
 *
 *     bun run script/bench-transport.ts           # markdown table to stdout
 *     bun run script/bench-transport.ts > bench.md
 *
 * For each of four representative envelopes (error / transaction / log /
 * session) the script measures compress-time and wire size across:
 *
 *     none           — raw, no compression
 *     gzip-6         — zlib default level (what the SDK's default transport uses)
 *     zstd-3         — libzstd default
 *     zstd-5         — mid-level; probes the low-to-mid curve for small payloads
 *     zstd-6         — slightly higher-ratio / slower
 *     zstd-9         — upper anchor; AGENTS.md warns of decoder-side cost at high levels
 *
 * Also measures decompress time with Bun.zstdDecompress / zlib.gunzip so
 * the server-side cost is visible. Without decode-side data a lower
 * compressed size can look like a win on ratio while actually being
 * worse total throughput once the ingest relay's decode cost is counted.
 *
 * Output: a single markdown table per envelope plus a per-codec summary.
 */

import { promisify } from "node:util";
import { gunzip as gunzipCb, gzip as gzipCb } from "node:zlib";
import { createEnvelope, serializeEnvelope } from "@sentry/core";

const gzipAsync = promisify(gzipCb);
const gunzipAsync = promisify(gunzipCb);

type Codec = "none" | "gzip-6" | "zstd-3" | "zstd-5" | "zstd-6" | "zstd-9";

const CODECS: Codec[] = [
  "none",
  "gzip-6",
  "zstd-3",
  "zstd-5",
  "zstd-6",
  "zstd-9",
];

const WARMUP_ITERS = 5;
const MEASURE_ITERS = 50;

async function compress(codec: Codec, buf: Buffer): Promise<Buffer> {
  if (codec === "none") {
    return buf;
  }
  if (codec === "gzip-6") {
    return await gzipAsync(buf);
  }
  const level = Number(codec.split("-")[1]);
  const out = await Bun.zstdCompress(buf, { level });
  return Buffer.from(out.buffer, out.byteOffset, out.byteLength);
}

async function decompress(codec: Codec, buf: Buffer): Promise<Buffer> {
  if (codec === "none") {
    return buf;
  }
  if (codec === "gzip-6") {
    return await gunzipAsync(buf);
  }
  const out = await Bun.zstdDecompress(buf);
  return Buffer.from(out.buffer, out.byteOffset, out.byteLength);
}

async function timeFn<T>(
  fn: () => Promise<T>
): Promise<{ avgMs: number; result: T }> {
  for (let i = 0; i < WARMUP_ITERS; i++) {
    await fn();
  }
  const start = performance.now();
  let result: T | undefined;
  for (let i = 0; i < MEASURE_ITERS; i++) {
    result = await fn();
  }
  const elapsed = performance.now() - start;
  return { avgMs: elapsed / MEASURE_ITERS, result: result as T };
}

// ── Fixture envelopes ────────────────────────────────────────────────
// Modeled on captures from running the CLI against the real ingest:
// shape and field choice reflect what the SDK actually sends, so the
// compression ratio numbers transfer to production.

function buildErrorEnvelope(): Buffer {
  const eventId = "a".repeat(32);
  const header = { event_id: eventId, sent_at: new Date().toISOString() };
  const item = {
    event_id: eventId,
    level: "error",
    platform: "node",
    sdk: { name: "sentry.javascript.node-core", version: "10.47.0" },
    exception: {
      values: [
        {
          type: "TypeError",
          value: "Cannot read properties of undefined (reading 'foo')",
          stacktrace: {
            frames: Array.from({ length: 30 }, (_, i) => ({
              filename: `/home/user/proj/src/file${i}.ts`,
              function: `handler${i}`,
              lineno: 100 + i,
              colno: 10,
              pre_context: ["  const x = y;", "  if (!z) return;"],
              context_line: `  return data.${"nested.".repeat(5)}prop;`,
              post_context: ["} catch (e) {", "  log(e);", "}"],
            })),
          },
        },
      ],
    },
    tags: {
      command: "issue.list",
      "sentry.runtime": "bun",
      cli_version: "0.29.0",
    },
    contexts: {
      runtime: { name: "bun", version: "1.3.13" },
      os: { name: "darwin", version: "23.4.0" },
    },
  };
  return Buffer.from(
    serializeEnvelope(
      createEnvelope(header as never, [
        // biome-ignore lint/suspicious/noExplicitAny: fixture fidelity
        [{ type: "event" } as any, item as any],
      ])
    )
  );
}

function buildTransactionEnvelope(): Buffer {
  const eventId = "b".repeat(32);
  const traceId = "c".repeat(32);
  const header = { event_id: eventId, sent_at: new Date().toISOString() };
  const now = Date.now() / 1000;
  const spanOps = ["http.client", "db", "file"];
  const spans = Array.from({ length: 60 }, (_, i) => ({
    span_id: String(i).padStart(16, "0"),
    trace_id: traceId,
    op: spanOps[i % 3],
    description: `operation ${i} with a reasonably long description line`,
    start_timestamp: now - 1,
    timestamp: now,
    data: { "http.method": "GET", "url.path": `/api/0/resource/${i}` },
  }));
  const item = {
    type: "transaction",
    event_id: eventId,
    transaction: "cli.command",
    contexts: {
      trace: { trace_id: traceId, span_id: "0000000000000000" },
    },
    spans,
    sdk: { name: "sentry.javascript.node-core", version: "10.47.0" },
  };
  return Buffer.from(
    serializeEnvelope(
      createEnvelope(header as never, [
        // biome-ignore lint/suspicious/noExplicitAny: fixture fidelity
        [{ type: "transaction" } as any, item as any],
      ])
    )
  );
}

function buildLogEnvelope(): Buffer {
  const header = { sent_at: new Date().toISOString() };
  const items = Array.from({ length: 20 }, (_, i) => ({
    timestamp: Date.now() / 1000,
    trace_id: "d".repeat(32),
    level: "info",
    body: `log message ${i}: something happened during execution`,
    attributes: { command: { value: "issue.list", type: "string" } },
  }));
  return Buffer.from(
    serializeEnvelope(
      createEnvelope(header as never, [
        // biome-ignore lint/suspicious/noExplicitAny: fixture fidelity
        [{ type: "log" } as any, { items } as any],
      ])
    )
  );
}

function buildSessionEnvelope(): Buffer {
  const header = { sent_at: new Date().toISOString() };
  const item = {
    sid: "e".repeat(32),
    did: "user-1",
    started: new Date().toISOString(),
    status: "exited",
    errors: 0,
    attrs: { release: "0.29.0", environment: "production" },
  };
  return Buffer.from(
    serializeEnvelope(
      createEnvelope(header as never, [
        // biome-ignore lint/suspicious/noExplicitAny: fixture fidelity
        [{ type: "session" } as any, item as any],
      ])
    )
  );
}

type BenchRow = {
  envelope: string;
  rawBytes: number;
  codec: Codec;
  sentBytes: number;
  ratio: number;
  compressMs: number;
  decompressMs: number;
};

async function benchCodec(
  envelopeName: string,
  buf: Buffer,
  codec: Codec
): Promise<BenchRow> {
  const { avgMs: compressMs, result: compressed } = await timeFn(() =>
    compress(codec, buf)
  );
  const { avgMs: decompressMs } = await timeFn(() =>
    decompress(codec, compressed)
  );
  return {
    envelope: envelopeName,
    rawBytes: buf.length,
    codec,
    sentBytes: compressed.length,
    ratio: compressed.length / buf.length,
    compressMs,
    decompressMs,
  };
}

function formatRow(r: BenchRow): string {
  const cols = [
    r.envelope,
    String(r.rawBytes),
    r.codec,
    String(r.sentBytes),
    r.ratio.toFixed(3),
    r.compressMs.toFixed(3),
    r.decompressMs.toFixed(3),
  ];
  return `| ${cols.join(" | ")} |`;
}

async function main(): Promise<void> {
  if (typeof Bun?.zstdCompress !== "function") {
    process.stderr.write(
      "bench-transport: Bun.zstdCompress unavailable — run on Bun or Node >= 22.15 with polyfill installed\n"
    );
    process.exit(1);
  }

  const fixtures: { name: string; buf: Buffer }[] = [
    { name: "error (30-frame stack)", buf: buildErrorEnvelope() },
    { name: "transaction (60 spans)", buf: buildTransactionEnvelope() },
    { name: "log (20 entries)", buf: buildLogEnvelope() },
    { name: "session", buf: buildSessionEnvelope() },
  ];

  process.stdout.write(
    "# Telemetry transport codec benchmark\n\n" +
      `_${WARMUP_ITERS} warmup + ${MEASURE_ITERS} measured iterations per cell._\n\n`
  );

  process.stdout.write(
    "| envelope | raw bytes | codec | sent bytes | ratio | compress ms | decompress ms |\n"
  );
  process.stdout.write(
    "|----------|----------:|-------|-----------:|------:|------------:|--------------:|\n"
  );

  for (const fix of fixtures) {
    for (const codec of CODECS) {
      const row = await benchCodec(fix.name, fix.buf, codec);
      process.stdout.write(`${formatRow(row)}\n`);
    }
  }
}

await main();
