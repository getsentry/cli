/**
 * HTTP control surface for the singleton Sentry Local daemon.
 *
 * The daemon owns all session metadata and telemetry buffers. CLI processes use
 * its bearer-protected API while SDKs receive only scoped ingestion URLs.
 */

import { Buffer } from "node:buffer";
import { pushToSpotlightBuffer } from "@spotlightjs/spotlight/sdk";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { logger } from "../../lib/logger.js";
import {
  createLocalSessionStore,
  type LocalSessionStore,
} from "./session-store.js";

export const CONTROL_PLANE_PREFIX = "/_local/v1";
const LOOPBACK_ORIGIN_RE =
  /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

export type LocalControlPlane = {
  readonly app: Hono;
  readonly sessionStore: LocalSessionStore;
};

export type CreateLocalControlPlaneOptions = {
  readonly controlToken: string;
  readonly host?: string;
  readonly onStop?: () => void;
  readonly port?: number;
  readonly sessionStore?: LocalSessionStore;
};

function controlUrl(host: string, port: number): string {
  const formattedHost = host.includes(":") ? `[${host}]` : host;
  return `http://${formattedHost}:${port}`;
}

function hasControlCapability(request: Request, controlToken: string): boolean {
  return request.headers.get("authorization") === `Bearer ${controlToken}`;
}

function eventSummary(parsed: {
  envelope: [Record<string, unknown>, unknown[]];
}): { envelopeId: string; eventId: string; itemTypes: string[] } {
  const [header, items] = parsed.envelope;
  return {
    envelopeId: String(header.__spotlight_envelope_id ?? ""),
    eventId: String(header.event_id ?? header.__spotlight_envelope_id ?? ""),
    itemTypes: items.map((item) =>
      Array.isArray(item) && typeof item[0] === "object" && item[0]
        ? String((item[0] as { type?: unknown }).type ?? "unknown")
        : "unknown"
    ),
  };
}

function buildSSEHandler(stream: {
  writeSSE: (event: {
    data: string;
    event?: string;
    id?: string;
  }) => Promise<void>;
}) {
  return (container: {
    getContentType: () => string;
    getParsedEnvelope: () => {
      envelope: [Record<string, unknown>, unknown[]];
    } | null;
  }) => {
    const parsed = container.getParsedEnvelope();
    if (!parsed) {
      return;
    }
    stream
      .writeSSE({
        data: JSON.stringify(parsed.envelope),
        event: container.getContentType(),
        id: String(parsed.envelope[0].__spotlight_envelope_id ?? ""),
      })
      .catch((error: unknown) =>
        logger.debug("Local stream write failed", error)
      );
  };
}

/** Create the in-process HTTP application hosted by the detached Local daemon. */
export function createLocalControlPlane({
  controlToken,
  host = "localhost",
  onStop,
  port = 8969,
  sessionStore = createLocalSessionStore(),
}: CreateLocalControlPlaneOptions): LocalControlPlane {
  const app = new Hono();
  const baseUrl = controlUrl(host, port);
  const sessionExists = (reference: string): boolean => {
    sessionStore.pruneExpired();
    try {
      sessionStore.resolve(reference);
      return true;
    } catch (error) {
      logger.debug("Local session was not found", error);
      return false;
    }
  };

  app.get("/health", (c) => c.text("OK"));

  app.use(`${CONTROL_PLANE_PREFIX}/*`, async (c, next) => {
    if (c.req.path.endsWith("/stream")) {
      await next();
      return;
    }
    if (!hasControlCapability(c.req.raw, controlToken)) {
      return c.body(null, 401);
    }
    await next();
  });
  app.use(
    `${CONTROL_PLANE_PREFIX}/sessions/:id/stream`,
    cors({
      allowHeaders: ["Content-Type", "Content-Encoding", "User-Agent"],
      allowMethods: ["GET", "POST", "OPTIONS"],
      origin: (origin) => (LOOPBACK_ORIGIN_RE.test(origin) ? origin : null),
    })
  );

  app.get(`${CONTROL_PLANE_PREFIX}/sessions`, (c) => {
    sessionStore.pruneExpired();
    return c.json({ sessions: sessionStore.list() });
  });

  app.get(`${CONTROL_PLANE_PREFIX}/sessions/:id`, (c) => {
    if (!sessionExists(c.req.param("id"))) {
      return c.body(null, 404);
    }
    return c.json(sessionStore.resolve(c.req.param("id")));
  });

  app.post(`${CONTROL_PLANE_PREFIX}/sessions`, async (c) => {
    const input = await c.req.json<unknown>().catch((error: unknown) => {
      logger.debug("Invalid Local session request body", error);
      return;
    });
    if (
      typeof input !== "object" ||
      input === null ||
      Array.isArray(input) ||
      typeof (input as { label?: unknown }).label !== "string" ||
      typeof (input as { cwd?: unknown }).cwd !== "string" ||
      ("clientId" in input &&
        typeof (input as { clientId?: unknown }).clientId !== "string")
    ) {
      return c.json({ error: "label and cwd are required." }, 400);
    }
    const { clientId, label, cwd } = input as {
      clientId?: string;
      label: string;
      cwd: string;
    };
    const session = sessionStore.create({ clientId, label, cwd });
    const capabilities = sessionStore.getCapabilities(session.id);
    const path = `${CONTROL_PLANE_PREFIX}/sessions/${session.id}/stream`;
    return c.json(
      {
        ...session,
        ingestUrl: `${baseUrl}${path}?cap=${capabilities.ingest}`,
        streamUrl: `${baseUrl}${path}?cap=${capabilities.stream}`,
      },
      201
    );
  });

  app.post(`${CONTROL_PLANE_PREFIX}/sessions/:id/stream`, async (c) => {
    if (!sessionExists(c.req.param("id"))) {
      return c.body(null, 404);
    }
    const capabilities = sessionStore.getCapabilities(c.req.param("id"));
    if (c.req.query("cap") !== capabilities.ingest) {
      return c.body(null, 401);
    }

    const arrayBuffer = await c.req.arrayBuffer();
    const body = Buffer.from(arrayBuffer);
    pushToSpotlightBuffer({
      spotlightBuffer: sessionStore.getBuffer(c.req.param("id")),
      body,
      contentType: c.req.header("content-type") ?? "",
      userAgent: c.req.header("user-agent"),
    });
    sessionStore.recordActivity(c.req.param("id"));
    return c.body(null, 204);
  });

  app.get(`${CONTROL_PLANE_PREFIX}/sessions/:id/stream`, (c) => {
    if (!sessionExists(c.req.param("id"))) {
      return c.body(null, 404);
    }
    const capabilities = sessionStore.getCapabilities(c.req.param("id"));
    const buffer = sessionStore.getBuffer(c.req.param("id"));
    if (c.req.query("cap") !== capabilities.stream) {
      return c.body(null, 401);
    }
    return streamSSE(c, async (stream) => {
      const readerId = buffer.subscribe(
        buildSSEHandler(stream),
        c.req.header("Last-Event-ID")
      );
      await new Promise<void>((resolve) => {
        stream.onAbort(() => {
          buffer.unsubscribe(readerId);
          resolve();
        });
      });
    });
  });

  app.post(`${CONTROL_PLANE_PREFIX}/sessions/:id/reset`, (c) => {
    if (!sessionExists(c.req.param("id"))) {
      return c.body(null, 404);
    }
    sessionStore.getBuffer(c.req.param("id")).clear();
    return c.body(null, 204);
  });

  app.post(`${CONTROL_PLANE_PREFIX}/sessions/:id/close`, (c) => {
    if (!sessionExists(c.req.param("id"))) {
      return c.body(null, 404);
    }
    return c.json(sessionStore.close(c.req.param("id")));
  });

  app.get(`${CONTROL_PLANE_PREFIX}/sessions/:id/envelopes`, (c) => {
    if (!sessionExists(c.req.param("id"))) {
      return c.body(null, 404);
    }
    const envelopes = sessionStore
      .getBuffer(c.req.param("id"))
      .read({ all: true })
      .map((container) => {
        const parsed = container.getParsedEnvelope();
        const header = (parsed?.envelope[0] ?? {}) as {
          __spotlight_envelope_id?: unknown;
        };
        return {
          id: String(header.__spotlight_envelope_id ?? ""),
          contentType: container.getContentType(),
          itemTypes:
            parsed?.envelope[1]
              .map((item) =>
                Array.isArray(item) && typeof item[0] === "object" && item[0]
                  ? String((item[0] as { type?: unknown }).type ?? "unknown")
                  : "unknown"
              )
              .filter(Boolean) ?? [],
        };
      })
      .reverse();
    return c.json({ envelopes });
  });

  app.get(`${CONTROL_PLANE_PREFIX}/sessions/:id/events`, (c) => {
    if (!sessionExists(c.req.param("id"))) {
      return c.body(null, 404);
    }
    const events = sessionStore
      .getBuffer(c.req.param("id"))
      .read({ all: true })
      .flatMap((container) => {
        const parsed = container.getParsedEnvelope();
        if (!parsed) {
          return [];
        }
        return [
          {
            ...eventSummary(parsed),
          },
        ];
      })
      .reverse();
    return c.json({ events });
  });

  app.get(`${CONTROL_PLANE_PREFIX}/sessions/:id/events/:eventId`, (c) => {
    if (!sessionExists(c.req.param("id"))) {
      return c.body(null, 404);
    }
    const container = sessionStore
      .getBuffer(c.req.param("id"))
      .read({ all: true })
      .find((candidate) => {
        const parsed = candidate.getParsedEnvelope();
        return (
          parsed && eventSummary(parsed).eventId === c.req.param("eventId")
        );
      });
    const parsed = container?.getParsedEnvelope();
    if (!parsed) {
      return c.body(null, 404);
    }
    return c.json({
      ...eventSummary(parsed),
      envelope: parsed.envelope,
    });
  });

  app.get(`${CONTROL_PLANE_PREFIX}/sessions/:id/envelopes/:envelopeId`, (c) => {
    if (!sessionExists(c.req.param("id"))) {
      return c.body(null, 404);
    }
    const container = sessionStore
      .getBuffer(c.req.param("id"))
      .read({ envelopeId: c.req.param("envelopeId") })[0];
    if (!container) {
      return c.body(null, 404);
    }
    return c.json({
      contentType: container.getContentType(),
      data: Buffer.from(container.getData()).toString("base64"),
      id: c.req.param("envelopeId"),
    });
  });

  app.post(`${CONTROL_PLANE_PREFIX}/daemon/stop`, (c) => {
    if (!onStop) {
      return c.body(null, 409);
    }
    queueMicrotask(onStop);
    return c.body(null, 202);
  });

  return { app, sessionStore };
}
