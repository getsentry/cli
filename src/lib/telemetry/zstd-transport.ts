/**
 * Custom Sentry SDK transport factory with zstd-first compression.
 *
 * Wraps `createTransport` from @sentry/core with a custom request executor
 * that compresses outgoing envelope bodies with zstd level 3 (libzstd
 * default). When running on a host without zstd support (Node < 22.15
 * without the polyfill installed), falls back to gzip — matches the
 * SDK's default behavior byte-for-byte so there's no regression.
 *
 * Codec selection is one-shot, performed at factory-construction time.
 * No per-request branching: if `Bun.zstdCompress` is available when the
 * transport is created, every envelope uses zstd; otherwise every
 * envelope uses gzip. The choice is reflected in the metric emitted by
 * {@link emitTransportMetric} so the ratio of zstd-vs-gzip callers can
 * be observed in the real world.
 *
 * This mirrors `@sentry/node-core/transports/http.js` `makeNodeTransport`
 * — URL parsing, `no_proxy` handling, proxy agent, CA certs, keepAlive,
 * IPv6 hostname unwrapping, rate-limit response header normalization —
 * but swaps out the gzip-via-stream-pipe for an async one-shot compress
 * that sets the correct `Content-Encoding`.
 *
 * Why not patch the SDK:
 *   `Sentry.init({ transport })` is a first-class extension point on
 *   the Client. Going via a custom factory avoids patch-file maintenance
 *   across SDK upgrades and avoids the gzip→gunzip→zstd waste that an
 *   `httpModule` shim would incur (the SDK has already piped the body
 *   through `createGzip()` by the time `httpModule.request()` runs).
 */

// biome-ignore lint/performance/noNamespaceImport: http module must be passed as a namespace object (matches SDK's HTTPModule interface)
import * as http from "node:http";
// biome-ignore lint/performance/noNamespaceImport: same as above for https
import * as https from "node:https";
import { Readable } from "node:stream";
import { promisify } from "node:util";
import { gzip as gzipCb } from "node:zlib";
import {
  createTransport,
  suppressTracing,
  type Transport,
  type TransportMakeRequestResponse,
  type TransportRequest,
  type TransportRequestExecutor,
} from "@sentry/core";
import {
  makeNodeTransport,
  type NodeTransportOptions,
} from "@sentry/node-core/light";
import {
  detectEnvelopeType,
  emitTransportMetric,
  type TransportEncoding,
} from "./zstd-transport-metrics.js";

/**
 * zstd compression level. L3 is libzstd's default — benchmarks across
 * envelope sizes (1–30 KiB) showed L3–L6 sit on the same ratio-vs-time
 * curve for this workload; L3 is the safe operating point until the
 * offline bench pins a different value. See `script/bench-transport.ts`.
 */
const ZSTD_LEVEL = 3;

/**
 * Minimum body length above which we attempt compression.
 *
 * For zstd we lower this from the SDK's 32 KiB gzip threshold to 1 KiB
 * — Bun's zstd worker is cheap to dispatch and most error envelopes
 * (5–15 KiB) would miss the 32 KiB cutoff and ship uncompressed
 * otherwise.
 */
const ZSTD_THRESHOLD = 1024;

/**
 * Matches the SDK default. Kept identical to avoid any byte-level
 * regression when the zstd fast path is unavailable.
 */
const GZIP_THRESHOLD = 1024 * 32;

/**
 * Shape of the globalThis.Bun subset we rely on. Bun's real types
 * declare this, but the transport also runs under Node (via the
 * feature-detected polyfill in `script/node-polyfills.ts`) where only
 * a subset of Bun APIs are installed.
 */
type BunZstdHost = {
  zstdCompress?: (
    data: Uint8Array | Buffer | string | ArrayBuffer,
    options?: { level?: number }
  ) => Promise<Buffer>;
};

const gzipAsync = promisify(gzipCb);

/** Factory — see module docs. */
export function makeCompressedTransport(
  options: NodeTransportOptions
): Transport {
  // When a proxy is configured (via options.proxy or http_proxy /
  // https_proxy env vars and not overridden by no_proxy), fall back to
  // the SDK's default makeNodeTransport — it owns the CONNECT-tunneling
  // HttpsProxyAgent. Proxy users thus continue to get gzip (the SDK
  // default), but correctness wins over micro-optimizing an edge case.
  let urlSegments: URL;
  try {
    urlSegments = new URL(options.url);
  } catch {
    // Mirror makeNodeTransport: return a no-op transport on bad URL so
    // the SDK doesn't throw at init time on misconfigured DSNs.
    return createTransport(options, () => Promise.resolve({}));
  }

  if (shouldFallbackToDefault(urlSegments, options)) {
    return makeNodeTransport(options);
  }

  const isHttps = urlSegments.protocol === "https:";
  const nativeHttpModule = isHttps ? https : http;
  const keepAlive = options.keepAlive ?? false;
  const agent = new nativeHttpModule.Agent({
    keepAlive,
    maxSockets: 30,
    timeout: 2000,
  });

  const httpModule = options.httpModule ?? nativeHttpModule;

  // One-shot codec selection. Frozen into the executor closure below.
  const encoding: Exclude<TransportEncoding, "none"> = hasZstdSupport()
    ? "zstd"
    : "gzip";

  const executor = createCompressingExecutor({
    options,
    httpModule,
    agent,
    encoding,
  });

  return createTransport(options, executor);
}

/**
 * True iff a proxy is configured for this URL and not exempted by
 * no_proxy. When true, the caller falls back to the SDK's default
 * transport (which handles CONNECT tunneling).
 */
function shouldFallbackToDefault(
  url: URL,
  options: NodeTransportOptions
): boolean {
  const isHttps = url.protocol === "https:";
  const envProxy = isHttps ? process.env.https_proxy : process.env.http_proxy;
  const proxy = options.proxy || envProxy || process.env.http_proxy;
  if (!proxy) {
    return false;
  }
  return !isNoProxyExempt(url);
}

/**
 * @internal Exported for tests. Builds the bare HTTP executor without
 * any of `makeCompressedTransport`'s URL / proxy / agent plumbing — the
 * caller supplies a fully resolved {@link http.Agent} and the {@link
 * http.request}-compatible module to use.
 */
export function createCompressingExecutor(args: {
  options: NodeTransportOptions;
  httpModule: NonNullable<NodeTransportOptions["httpModule"]>;
  agent: http.Agent;
  encoding: Exclude<TransportEncoding, "none">;
}): TransportRequestExecutor {
  const { options, httpModule, agent, encoding } = args;
  const { hostname, pathname, port, protocol, search } = new URL(options.url);
  const hostnameIsIPv6 = hostname.startsWith("[");

  return (request: TransportRequest) =>
    new Promise<TransportMakeRequestResponse>((resolve, reject) => {
      suppressTracing(() => {
        performRequest({
          request,
          options,
          httpModule,
          agent,
          encoding,
          hostname: hostnameIsIPv6 ? hostname.slice(1, -1) : hostname,
          path: `${pathname}${search}`,
          port,
          protocol,
        })
          .then(resolve)
          .catch(reject);
      });
    });
}

type PerformRequestArgs = {
  request: TransportRequest;
  options: NodeTransportOptions;
  httpModule: NonNullable<NodeTransportOptions["httpModule"]>;
  agent: http.Agent;
  encoding: Exclude<TransportEncoding, "none">;
  hostname: string;
  path: string;
  port: string;
  protocol: string;
};

async function performRequest(
  args: PerformRequestArgs
): Promise<TransportMakeRequestResponse> {
  const { request, options, httpModule, agent, encoding } = args;

  const rawBuffer = normalizeBody(request.body);
  const { payload, encodingApplied, compressMs } = await maybeCompress(
    rawBuffer,
    encoding
  );

  const headers: Record<string, string> = { ...(options.headers ?? {}) };
  if (encodingApplied !== "none") {
    headers["content-encoding"] = encodingApplied;
  }

  emitTransportMetric({
    rawBytes: rawBuffer.length,
    sentBytes: payload.length,
    compressMs,
    encoding: encodingApplied,
    envelopeType: () => detectEnvelopeType(rawBuffer),
  });

  return new Promise<TransportMakeRequestResponse>((resolve, reject) => {
    const req = httpModule.request(
      {
        method: "POST",
        agent,
        headers,
        hostname: args.hostname,
        path: args.path,
        port: args.port,
        protocol: args.protocol,
        ca: options.caCerts,
      },
      (res) => {
        res.on("data", () => {
          // Drain socket
        });
        res.on("end", () => {
          // Drain socket
        });
        res.setEncoding("utf8");

        const retryAfterHeader = res.headers["retry-after"] ?? null;
        const rateLimitsHeader = res.headers["x-sentry-rate-limits"] ?? null;

        resolve({
          statusCode: res.statusCode,
          headers: {
            "retry-after": Array.isArray(retryAfterHeader)
              ? (retryAfterHeader[0] ?? null)
              : retryAfterHeader,
            "x-sentry-rate-limits": Array.isArray(rateLimitsHeader)
              ? (rateLimitsHeader[0] ?? null)
              : rateLimitsHeader,
          },
        });
      }
    );

    req.on("error", reject);
    // Single-shot write. `payload` is already a complete Buffer in
    // memory (compressed or not), so piping a fresh Readable through
    // avoids the SDK's stream-gzip dance without changing the wire
    // behavior — `http.ClientRequest` still sees a body it can send.
    Readable.from(payload).pipe(req);
  });
}

/**
 * Coerce `string | Uint8Array` into a single contiguous Buffer.
 *
 * @internal Exported for tests.
 */
export function normalizeBody(body: string | Uint8Array): Buffer {
  if (typeof body === "string") {
    return Buffer.from(body, "utf-8");
  }
  // Buffer.from(view) copies; but Buffer.from(view.buffer, byteOffset,
  // byteLength) is zero-copy and gives us a Buffer that aliases the
  // original bytes — exactly what we want before handing off to the
  // compression worker.
  return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
}

type CompressResult = {
  payload: Buffer;
  encodingApplied: TransportEncoding;
  compressMs: number;
};

/**
 * Apply the pre-selected codec iff the body is large enough to benefit.
 * Under threshold → passthrough with `encoding: "none"` (matches SDK
 * default behavior).
 *
 * @internal Exported for tests.
 */
export async function maybeCompress(
  buf: Buffer,
  encoding: Exclude<TransportEncoding, "none">
): Promise<CompressResult> {
  const threshold = encoding === "zstd" ? ZSTD_THRESHOLD : GZIP_THRESHOLD;
  if (buf.length <= threshold) {
    return { payload: buf, encodingApplied: "none", compressMs: 0 };
  }

  const start = performance.now();
  if (encoding === "zstd") {
    const bun = (globalThis as { Bun?: BunZstdHost }).Bun;
    // Shouldn't happen (factory checked at construction time), but a
    // belt-and-braces fallback to gzip keeps us correct if `Bun` is
    // swapped out between construction and first send.
    if (!bun?.zstdCompress) {
      const gz = await gzipAsync(buf);
      return {
        payload: gz,
        encodingApplied: "gzip",
        compressMs: performance.now() - start,
      };
    }
    const out = await bun.zstdCompress(buf, { level: ZSTD_LEVEL });
    return {
      payload: Buffer.from(out.buffer, out.byteOffset, out.byteLength),
      encodingApplied: "zstd",
      compressMs: performance.now() - start,
    };
  }

  const gz = await gzipAsync(buf);
  return {
    payload: gz,
    encodingApplied: "gzip",
    compressMs: performance.now() - start,
  };
}

/** Feature-detect zstd support on the current runtime. */
export function hasZstdSupport(): boolean {
  const bun = (globalThis as { Bun?: BunZstdHost }).Bun;
  return typeof bun?.zstdCompress === "function";
}

/**
 * Mirror the SDK's `applyNoProxyOption`: returns true iff the target
 * URL matches an entry in `NO_PROXY` / `no_proxy`, in which case the
 * proxy should be ignored.
 *
 * Whitespace around comma-separated entries is trimmed — `"a.com, b.com"`
 * is a common config style and both entries should match.
 *
 * @internal Exported for tests.
 */
export function isNoProxyExempt(urlSegments: URL): boolean {
  const noProxy = process.env.no_proxy ?? process.env.NO_PROXY;
  if (!noProxy) {
    return false;
  }
  return noProxy
    .split(",")
    .map((ex) => ex.trim())
    .filter((ex) => ex.length > 0)
    .some(
      (ex) => urlSegments.host.endsWith(ex) || urlSegments.hostname.endsWith(ex)
    );
}
