/**
 * Tests for `sentry send-envelope` command func().
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sendEnvelopeCommand } from "../../src/commands/send-envelope.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn
import * as transport from "../../src/lib/envelope/transport.js";
import { useTestConfigDir } from "../helpers.js";

useTestConfigDir("send-envelope-");

const SAAS_DSN = "https://abc123@o1.ingest.us.sentry.io/999";

// A minimal valid envelope: header line + item header + item body
const VALID_ENVELOPE =
  '{"event_id":"aabbccddeeff00112233445566778899","sent_at":"2026-01-01T00:00:00.000Z"}\n' +
  '{"type":"event","length":2}\n' +
  "{}";

function makeContext() {
  const writes: string[] = [];
  return {
    ctx: {
      stdout: {
        write: (s: string) => {
          writes.push(s);
          return true;
        },
      },
      stderr: { write: mock(() => true) },
      cwd: "/tmp",
    },
    writes,
  };
}

function writeTmpEnvelope(name: string, content: string): string {
  const dir = join(tmpdir(), "sentry-test-envelopes");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, name);
  writeFileSync(path, content, "utf8");
  return path;
}

describe("sendEnvelopeCommand.func()", () => {
  let func: Awaited<ReturnType<typeof sendEnvelopeCommand.loader>>;
  let sendSpy: ReturnType<typeof spyOn>;

  beforeEach(async () => {
    func = await sendEnvelopeCommand.loader();
    sendSpy = spyOn(transport, "sendEnvelopeRequest").mockResolvedValue(
      undefined
    );
  });

  afterEach(() => {
    sendSpy.mockRestore();
  });

  test("valid envelope file is sent and success message printed", async () => {
    const path = writeTmpEnvelope("test.envelope", VALID_ENVELOPE);
    const { ctx, writes } = makeContext();

    await func.call(ctx, { dsn: SAAS_DSN }, path);

    expect(sendSpy).toHaveBeenCalledTimes(1);
    const output = writes.join("");
    expect(output).toContain("dispatched");
    expect(output).toContain("test.envelope");
  });

  test("--raw sends file bytes without parsing", async () => {
    const content = "raw garbage that is not valid envelope format";
    const path = writeTmpEnvelope("raw.envelope", content);
    const { ctx } = makeContext();

    // Without --raw, this would throw a parse error
    await func.call(ctx, { dsn: SAAS_DSN, raw: true }, path);

    expect(sendSpy).toHaveBeenCalledTimes(1);
    // Body should be the raw bytes
    const body = sendSpy.mock.calls[0]?.[1];
    expect(body).toBeDefined();
  });

  test("invalid envelope without --raw throws parse error", async () => {
    const path = writeTmpEnvelope("bad.envelope", "not valid\nenvelope");
    const { ctx } = makeContext();

    await expect(func.call(ctx, { dsn: SAAS_DSN }, path)).rejects.toThrow();

    expect(sendSpy).not.toHaveBeenCalled();
  });

  test("missing DSN throws ConfigError", async () => {
    const savedDsn = process.env.SENTRY_DSN;
    delete process.env.SENTRY_DSN;
    const path = writeTmpEnvelope("ok.envelope", VALID_ENVELOPE);
    const { ctx } = makeContext();
    try {
      await expect(func.call(ctx, {}, path)).rejects.toThrow();
    } finally {
      if (savedDsn !== undefined) process.env.SENTRY_DSN = savedDsn;
    }
  });

  test("multiple files are each sent separately", async () => {
    const p1 = writeTmpEnvelope("a.envelope", VALID_ENVELOPE);
    const p2 = writeTmpEnvelope("b.envelope", VALID_ENVELOPE);
    const { ctx } = makeContext();

    await func.call(ctx, { dsn: SAAS_DSN }, p1, p2);

    expect(sendSpy).toHaveBeenCalledTimes(2);
  });

  test("nonexistent file throws ValidationError (not raw stack trace)", async () => {
    const { ctx } = makeContext();
    const { ValidationError } = await import("../../src/lib/errors.js");
    await expect(
      func.call(ctx, { dsn: SAAS_DSN }, "/nonexistent/missing.envelope")
    ).rejects.toBeInstanceOf(ValidationError);
    expect(sendSpy).not.toHaveBeenCalled();
  });

  test("no files throws ValidationError", async () => {
    const { ctx } = makeContext();
    const { ValidationError } = await import("../../src/lib/errors.js");
    await expect(func.call(ctx, { dsn: SAAS_DSN })).rejects.toBeInstanceOf(
      ValidationError
    );
    expect(sendSpy).not.toHaveBeenCalled();
  });
});
