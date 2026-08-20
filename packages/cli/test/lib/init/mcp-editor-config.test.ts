import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { writeMcpConfig } from "../../../src/lib/init/mcp-editor-config.js";

const MCP = { url: "https://mcp.sentry.dev/mcp/acme/my-app" };

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(tmpdir(), "mcp-cfg-"));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

async function readJson(rel: string): Promise<unknown> {
  return JSON.parse(await fs.readFile(path.join(dir, rel), "utf8"));
}

describe("writeMcpConfig", () => {
  test("creates .cursor/mcp.json with the Sentry server", async () => {
    const ok = await writeMcpConfig("cursor", MCP, dir);
    expect(ok).toBe(true);
    expect(await readJson(".cursor/mcp.json")).toEqual({
      mcpServers: { Sentry: { url: MCP.url } },
    });
  });

  test("creates .vscode/mcp.json with the http server shape", async () => {
    const ok = await writeMcpConfig("vscode", MCP, dir);
    expect(ok).toBe(true);
    expect(await readJson(".vscode/mcp.json")).toEqual({
      servers: { Sentry: { url: MCP.url, type: "http" } },
    });
  });

  test("creates .mcp.json for Claude Code", async () => {
    const ok = await writeMcpConfig("claude-code", MCP, dir);
    expect(ok).toBe(true);
    expect(await readJson(".mcp.json")).toEqual({
      mcpServers: { Sentry: { url: MCP.url } },
    });
  });

  test("merges into an existing config, preserving other servers", async () => {
    await fs.mkdir(path.join(dir, ".cursor"), { recursive: true });
    await fs.writeFile(
      path.join(dir, ".cursor/mcp.json"),
      JSON.stringify({ mcpServers: { Other: { url: "https://other" } } }),
      "utf8"
    );

    const ok = await writeMcpConfig("cursor", MCP, dir);
    expect(ok).toBe(true);
    expect(await readJson(".cursor/mcp.json")).toEqual({
      mcpServers: {
        Other: { url: "https://other" },
        Sentry: { url: MCP.url },
      },
    });
  });

  test("returns false when MCP data or project dir is missing", async () => {
    expect(await writeMcpConfig("cursor", undefined, dir)).toBe(false);
    expect(await writeMcpConfig("cursor", MCP, undefined)).toBe(false);
  });
});
