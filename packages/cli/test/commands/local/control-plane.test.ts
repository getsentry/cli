import { describe, expect, test } from "vitest";
import { createLocalControlPlane } from "../../../src/commands/local/control-plane.js";

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
});
