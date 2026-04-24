/**
 * E2E tests for the zstd transport.
 *
 * Spins up a real `http.createServer` on `127.0.0.1:0`, points the
 * transport at it, and verifies the wire-level behavior: the request
 * body is zstd-compressed, the `Content-Encoding` header is correct,
 * and the body decompresses back to a valid envelope.
 *
 * Uses `useTestConfigDir()` for DB isolation (see AGENTS.md).
 */

import { afterAll, describe, expect, test } from "bun:test";

/** No-op for SDK callbacks that require a function but return nothing meaningful. */
function noop(): void {
  // intentionally empty
}

import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createEnvelope } from "@sentry/core";
import {
  hasZstdSupport,
  makeCompressedTransport,
} from "../../../src/lib/telemetry/zstd-transport.js";
import { useTestConfigDir } from "../../helpers.js";

type CapturedRequest = {
  headers: IncomingMessage["headers"];
  body: Buffer;
};

function startMockIngest(
  responder: (req: IncomingMessage) => {
    statusCode: number;
    headers?: Record<string, string | string[]>;
  }
): Promise<{
  server: Server;
  url: string;
  captures: CapturedRequest[];
}> {
  const captures: CapturedRequest[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      captures.push({ headers: req.headers, body: Buffer.concat(chunks) });
      const response = responder(req);
      res.writeHead(response.statusCode, response.headers ?? {});
      res.end();
    });
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as AddressInfo;
      resolve({
        server,
        url: `http://127.0.0.1:${addr.port}/api/0/envelope/`,
        captures,
      });
    });
  });
}

useTestConfigDir("zstd-transport-e2e-");

describe("makeCompressedTransport (e2e)", () => {
  let server: Server | undefined;

  afterAll(() => {
    server?.close();
  });

  test("sends zstd-encoded envelope; server decompresses back to original", async () => {
    if (!hasZstdSupport()) {
      return;
    }

    const {
      server: srv,
      url,
      captures,
    } = await startMockIngest(() => ({
      statusCode: 200,
    }));
    server = srv;

    const transport = makeCompressedTransport({
      url,
      recordDroppedEvent: noop,
    });

    // Sizable envelope — above the 1 KiB zstd threshold.
    const message = "x".repeat(4096);
    const envelope: any = createEnvelope({ event_id: "abc" } as any, [
      [{ type: "event" } as any, { message } as any],
    ]);

    const response = await transport.send(envelope);
    expect(response.statusCode).toBe(200);

    expect(captures).toHaveLength(1);
    expect(captures[0]?.headers["content-encoding"]).toBe("zstd");

    const decompressed = await Bun.zstdDecompress(captures[0]!.body);
    const text = Buffer.from(
      decompressed.buffer,
      decompressed.byteOffset,
      decompressed.byteLength
    ).toString("utf-8");
    expect(text).toContain(message);
    expect(text).toContain('"type":"event"');
  });

  test("rate-limit headers flow back into createTransport wrapper", async () => {
    const {
      server: srv,
      url,
      captures,
    } = await startMockIngest(() => ({
      statusCode: 429,
      headers: {
        "retry-after": "60",
        "x-sentry-rate-limits": "60:error:organization",
      },
    }));
    server = srv;

    const transport = makeCompressedTransport({
      url,
      recordDroppedEvent: noop,
    });

    const envelope: any = createEnvelope({ event_id: "a" } as any, [
      [{ type: "event" } as any, { message: "hi" } as any],
    ]);
    const response = await transport.send(envelope);

    expect(response.statusCode).toBe(429);
    expect(response.headers?.["retry-after"]).toBe("60");
    expect(response.headers?.["x-sentry-rate-limits"]).toBe(
      "60:error:organization"
    );
    expect(captures).toHaveLength(1);
  });
});
