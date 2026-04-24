/**
 * Unit tests for {@link makeCompressedTransport}.
 *
 * Uses the SDK's `options.httpModule` extension point to inject a mock
 * that captures the bytes written to the ClientRequest and synthesizes
 * a response. We don't touch real sockets.
 *
 * Each scenario asserts on one of:
 *   1. the `content-encoding` header as observed on the wire,
 *   2. the compressed body round-tripping back to the input,
 *   3. rate-limit response headers surfacing correctly to the
 *      `createTransport` layer.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import type { ClientRequest, IncomingHttpHeaders } from "node:http";
import { gunzipSync } from "node:zlib";
import { createEnvelope } from "@sentry/core";
import {
  hasZstdSupport,
  makeCompressedTransport,
} from "../../../src/lib/telemetry/zstd-transport.js";

/** No-op for SDK callbacks that require a function but return nothing meaningful. */
function noop(): void {
  // intentionally empty
}

// ── Mock http module ─────────────────────────────────────────────────

type MockResponseShape = {
  statusCode: number;
  headers: IncomingHttpHeaders;
};

type CapturedRequest = {
  chunks: Buffer[];
  options: Record<string, unknown>;
};

/**
 * Build a fake {@link http} module that captures outbound body bytes and
 * resolves with a pre-canned response. The returned object exposes both
 * the shim and the capture buffer for test assertions.
 */
function buildMockHttpModule(response: MockResponseShape): {
  httpModule: {
    request: (opts: unknown, cb?: (res: unknown) => void) => ClientRequest;
  };
  captured: CapturedRequest;
} {
  const captured: CapturedRequest = { chunks: [], options: {} };
  const httpModule = {
    request: (opts: unknown, cb?: (res: unknown) => void) => {
      captured.options = opts as Record<string, unknown>;

      // The ClientRequest must behave as a Writable so that
      // `Readable.from(payload).pipe(req)` succeeds. We fake one from
      // an EventEmitter and expose `write`/`end` that push into the
      // captured buffer.
      const req = new EventEmitter() as unknown as ClientRequest & {
        write: (chunk: Buffer | string) => boolean;
        end: (chunk?: Buffer | string) => void;
      };
      req.write = (chunk: Buffer | string) => {
        captured.chunks.push(
          Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        );
        return true;
      };
      req.end = (chunk?: Buffer | string) => {
        if (chunk !== undefined) {
          captured.chunks.push(
            Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
          );
        }
        // Fire the response on next tick so the caller has time to
        // finish piping before we resolve. The response object is a
        // minimal IncomingMessage-like shape that the transport's
        // handler uses.
        process.nextTick(() => {
          const res = Object.assign(new EventEmitter(), {
            statusCode: response.statusCode,
            headers: response.headers,
            setEncoding: noop,
          });
          cb?.(res);
          // Drive data/end events the transport listens to.
          process.nextTick(() => {
            res.emit("data", Buffer.alloc(0));
            res.emit("end");
          });
        });
      };
      return req;
    },
  };
  return { httpModule: httpModule as never, captured };
}

// ── Tests ────────────────────────────────────────────────────────────

const BASE_OPTIONS = {
  url: "https://ingest.example.com/api/0/envelope/",
  headers: { "x-sentry-auth": "Sentry sentry_key=abc" },
  recordDroppedEvent: noop,
};

describe("makeCompressedTransport", () => {
  let savedZstd: typeof globalThis.Bun.zstdCompress | undefined;

  afterEach(() => {
    // Restore Bun.zstdCompress after tests that stash it.
    if (savedZstd !== undefined) {
      globalThis.Bun.zstdCompress = savedZstd;
      savedZstd = undefined;
    }
  });

  test("zstd branch: sets Content-Encoding: zstd and round-trips", async () => {
    if (!hasZstdSupport()) {
      // On a runtime without zstd this test is meaningless.
      return;
    }
    const { httpModule, captured } = buildMockHttpModule({
      statusCode: 200,
      headers: {},
    });

    const transport = makeCompressedTransport({
      ...BASE_OPTIONS,
      httpModule,
    });

    // Build a large envelope — above ZSTD_THRESHOLD (1 KiB).
    const payload = "x".repeat(4096);
    const envelope: any = createEnvelope({} as any, [
      [{ type: "event" } as any, { data: payload } as any],
    ]);
    await transport.send(envelope);

    const headers = captured.options.headers as Record<string, string>;
    expect(headers["content-encoding"]).toBe("zstd");

    const wire = Buffer.concat(captured.chunks);
    expect(wire.length).toBeGreaterThan(0);

    // Decompress and verify the payload body is present
    const decompressed = await Bun.zstdDecompress(wire);
    const text = Buffer.from(
      decompressed.buffer,
      decompressed.byteOffset,
      decompressed.byteLength
    ).toString("utf-8");
    expect(text).toContain(payload);
  });

  test("gzip fallback: Bun.zstdCompress absent → Content-Encoding: gzip", async () => {
    savedZstd = globalThis.Bun.zstdCompress;
    // Stash + remove zstd to force the gzip branch
    (globalThis as { Bun: { zstdCompress?: unknown } }).Bun.zstdCompress =
      undefined as never;

    try {
      const { httpModule, captured } = buildMockHttpModule({
        statusCode: 200,
        headers: {},
      });

      const transport = makeCompressedTransport({
        ...BASE_OPTIONS,
        httpModule,
      });

      // Build a payload > GZIP_THRESHOLD (32 KiB).
      const payload = "y".repeat(64 * 1024);
      const envelope: any = createEnvelope({} as any, [
        [{ type: "event" } as any, { data: payload } as any],
      ]);
      await transport.send(envelope);

      const headers = captured.options.headers as Record<string, string>;
      expect(headers["content-encoding"]).toBe("gzip");

      const wire = Buffer.concat(captured.chunks);
      const decompressed = gunzipSync(wire);
      const text = decompressed.toString("utf-8");
      expect(text).toContain(payload);
    } finally {
      // afterEach restores savedZstd
    }
  });

  test("below threshold: no content-encoding header", async () => {
    const { httpModule, captured } = buildMockHttpModule({
      statusCode: 200,
      headers: {},
    });

    const transport = makeCompressedTransport({
      ...BASE_OPTIONS,
      httpModule,
    });

    // Tiny envelope - well below 1 KiB zstd threshold
    const envelope: any = createEnvelope({} as any, [
      [{ type: "event" } as any, { tiny: "x" } as any],
    ]);
    await transport.send(envelope);

    const headers = captured.options.headers as Record<string, string>;
    expect(headers["content-encoding"]).toBeUndefined();

    // The wire body should be exactly the serialized envelope
    const wire = Buffer.concat(captured.chunks);
    expect(wire.toString("utf-8")).toContain("event");
  });

  test("rate-limit response headers bubble up (string form)", async () => {
    const { httpModule } = buildMockHttpModule({
      statusCode: 429,
      headers: {
        "retry-after": "60",
        "x-sentry-rate-limits": "60:error:organization",
      },
    });

    const transport = makeCompressedTransport({
      ...BASE_OPTIONS,
      httpModule,
    });

    const envelope: any = createEnvelope({} as any, [
      [{ type: "event" } as any, { data: "small" } as any],
    ]);
    const response = await transport.send(envelope);

    expect(response.statusCode).toBe(429);
    expect(response.headers?.["retry-after"]).toBe("60");
    expect(response.headers?.["x-sentry-rate-limits"]).toBe(
      "60:error:organization"
    );
  });

  test("rate-limit response headers normalize array form", async () => {
    const { httpModule } = buildMockHttpModule({
      statusCode: 429,
      // Some proxies emit duplicate headers as arrays
      headers: {
        "retry-after": "30",
        "x-sentry-rate-limits": [
          "30:transaction:organization",
          "60:error:organization",
        ] as never,
      },
    });

    const transport = makeCompressedTransport({
      ...BASE_OPTIONS,
      httpModule,
    });

    const envelope: any = createEnvelope({} as any, [
      [{ type: "event" } as any, { data: "small" } as any],
    ]);
    const response = await transport.send(envelope);

    // Array collapsed to first element
    expect(response.headers?.["x-sentry-rate-limits"]).toBe(
      "30:transaction:organization"
    );
  });

  test("invalid URL: no-op transport returned", async () => {
    const transport = makeCompressedTransport({
      ...BASE_OPTIONS,
      url: "not a url",
    });
    const envelope: any = createEnvelope({} as any, [
      [{ type: "event" } as any, {} as any],
    ]);
    // No-op transport resolves with empty response, does not throw.
    const response = await transport.send(envelope);
    expect(response).toEqual({});
  });
});
