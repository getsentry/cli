import { request } from "node:http";
import { describe, expect, test } from "vitest";
import { createLocalControlPlane } from "../../../src/commands/local/control-plane.js";
import { tryListen } from "../../../src/commands/local/server.js";

const CONTROL_TOKEN = "control-token";

function controlHeaders() {
  return { Authorization: `Bearer ${CONTROL_TOKEN}` };
}

describe("Local control plane", () => {
  test("creates isolated sessions through its authenticated control API", async () => {
    const controlPlane = createLocalControlPlane({
      controlToken: CONTROL_TOKEN,
    });

    const created = await controlPlane.app.request("/_local/v1/sessions", {
      method: "POST",
      headers: { ...controlHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ label: "web", cwd: "/work/web" }),
    });

    expect(created.status).toBe(201);
    const session = (await created.json()) as {
      id: string;
      label: string;
      ingestUrl: string;
      streamUrl: string;
    };
    expect(session.label).toBe("web");
    expect(session.ingestUrl).toContain(`/${session.id}/stream?cap=`);
    expect(session.streamUrl).toContain(`/${session.id}/stream?cap=`);
    expect(session.ingestUrl).not.toBe(session.streamUrl);

    const sessions = await controlPlane.app.request("/_local/v1/sessions", {
      headers: controlHeaders(),
    });
    await expect(sessions.json()).resolves.toMatchObject({
      sessions: [{ id: session.id, label: "web", state: "open" }],
    });
  });

  test("does not expose the session registry without the control capability", async () => {
    const controlPlane = createLocalControlPlane({
      controlToken: CONTROL_TOKEN,
    });

    const response = await controlPlane.app.request("/_local/v1/sessions");

    expect(response.status).toBe(401);
  });

  test("accepts envelopes only through the matching session ingestion capability", async () => {
    const controlPlane = createLocalControlPlane({
      controlToken: CONTROL_TOKEN,
    });
    const created = await controlPlane.app.request("/_local/v1/sessions", {
      method: "POST",
      headers: { ...controlHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ label: "web", cwd: "/work/web" }),
    });
    const session = (await created.json()) as { id: string; ingestUrl: string };
    const envelope =
      '{"sdk":{"name":"sentry.node"}}\n{"type":"event"}\n{"message":"isolated"}';

    const ingested = await controlPlane.app.request(session.ingestUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-sentry-envelope" },
      body: envelope,
    });
    expect(ingested.status).toBe(204);
    expect(
      controlPlane.sessionStore.getBuffer(session.id).read({ all: true })
    ).toHaveLength(1);

    const rejected = await controlPlane.app.request(
      session.ingestUrl.replace(/cap=[^&]+/, "cap=wrong"),
      { method: "POST", body: envelope }
    );
    expect(rejected.status).toBe(401);
  });

  test("allows subscribers only through the session stream capability", async () => {
    const controlPlane = createLocalControlPlane({
      controlToken: CONTROL_TOKEN,
    });
    const created = await controlPlane.app.request("/_local/v1/sessions", {
      method: "POST",
      headers: { ...controlHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ label: "web", cwd: "/work/web" }),
    });
    const session = (await created.json()) as { streamUrl: string };

    const rejected = await controlPlane.app.request(
      session.streamUrl.replace(/cap=[^&]+/, "cap=wrong")
    );
    expect(rejected.status).toBe(401);

    const stream = await controlPlane.app.request(session.streamUrl);
    expect(stream.status).toBe(200);
    expect(stream.headers.get("content-type")).toContain("text/event-stream");
    await stream.body?.cancel();
  });

  test("indexes decoded events by their Sentry event ID", async () => {
    const controlPlane = createLocalControlPlane({
      controlToken: CONTROL_TOKEN,
    });
    const created = await controlPlane.app.request("/_local/v1/sessions", {
      method: "POST",
      headers: { ...controlHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ label: "web", cwd: "/work/web" }),
    });
    const session = (await created.json()) as { id: string; ingestUrl: string };
    await controlPlane.app.request(session.ingestUrl, {
      method: "POST",
      body: '{"event_id":"event-123"}\n{"type":"event"}\n{"message":"isolated"}',
    });

    const listed = await controlPlane.app.request(
      `/_local/v1/sessions/${session.id}/events`,
      { headers: controlHeaders() }
    );
    await expect(listed.json()).resolves.toMatchObject({
      events: [{ eventId: "event-123" }],
    });
    const viewed = await controlPlane.app.request(
      `/_local/v1/sessions/${session.id}/events/event-123`,
      { headers: controlHeaders() }
    );
    expect(viewed.status).toBe(200);
  });

  test("permits browser preflight only from a loopback development origin", async () => {
    const controlPlane = createLocalControlPlane({
      controlToken: CONTROL_TOKEN,
    });
    const created = await controlPlane.app.request("/_local/v1/sessions", {
      method: "POST",
      headers: { ...controlHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ label: "web", cwd: "/work/web" }),
    });
    const session = (await created.json()) as { ingestUrl: string };
    const response = await controlPlane.app.request(session.ingestUrl, {
      method: "OPTIONS",
      headers: {
        Origin: "http://localhost:5173",
        "Access-Control-Request-Method": "POST",
      },
    });
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "http://localhost:5173"
    );
  });

  test("acknowledges a daemon stop request before closing its listener", async () => {
    let server: import("node:http").Server | undefined;
    const controlPlane = createLocalControlPlane({
      controlToken: CONTROL_TOKEN,
      onStop: () => {
        server?.closeAllConnections();
        server?.close();
      },
    });
    const listening = await tryListen(controlPlane.app, 0, "127.0.0.1");
    server = listening.server;

    const statusCode = await new Promise<number>((resolve, reject) => {
      const stopRequest = request(
        `http://127.0.0.1:${listening.port}/_local/v1/daemon/stop`,
        { method: "POST", headers: controlHeaders() },
        (response) => {
          response.resume();
          response.on("end", () => resolve(response.statusCode ?? 0));
        }
      );
      stopRequest.on("error", reject);
      stopRequest.end();
    });
    expect(statusCode).toBe(202);
  });
});
