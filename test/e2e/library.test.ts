/**
 * Library Mode Smoke Tests
 *
 * Verifies the npm bundle works correctly when imported as a library.
 * Tests the variadic sentry() API and the typed createSentrySDK() API.
 *
 * These tests run the bundled dist/index.cjs via Node.js subprocesses
 * to verify the real npm package behavior (not source imports).
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

const ROOT_DIR = join(import.meta.dir, "../..");
const INDEX_PATH = join(ROOT_DIR, "dist/index.cjs");
const TYPES_PATH = join(ROOT_DIR, "dist/index.d.cts");

/**
 * Run a Node.js script that requires the bundled library.
 * Returns { stdout, stderr, exitCode }.
 */
async function runNodeScript(
  script: string,
  timeout = 15_000
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const env: Record<string, string | undefined> = {
    ...process.env,
    SENTRY_CLI_NO_TELEMETRY: "1",
  };
  // Ensure no auth leaks into tests — delete rather than set to undefined
  // because Bun.spawn may pass "undefined" as a literal string
  delete env.SENTRY_AUTH_TOKEN;
  delete env.SENTRY_TOKEN;

  const proc = Bun.spawn(["node", "--no-warnings", "-e", script], {
    cwd: ROOT_DIR,
    stdout: "pipe",
    stderr: "pipe",
    env,
  });

  const timer = setTimeout(() => proc.kill(), timeout);
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  clearTimeout(timer);

  return { stdout, stderr, exitCode };
}

/**
 * Run a Node.js script and assert it exits cleanly.
 * On non-zero exit, throws with stderr for CI debuggability.
 */
async function runNodeScriptOk(
  script: string,
  timeout?: number
): Promise<{ stdout: string; stderr: string }> {
  const result = await runNodeScript(script, timeout);
  if (result.exitCode !== 0) {
    throw new Error(
      `Node exited ${result.exitCode}.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`
    );
  }
  return result;
}

describe("library mode (bundled)", () => {
  beforeAll(async () => {
    // Build the bundle if it doesn't exist
    if (!existsSync(INDEX_PATH)) {
      const distDir = join(ROOT_DIR, "dist");
      if (existsSync(distDir)) {
        rmSync(distDir, { recursive: true, force: true });
      }

      const proc = Bun.spawn([process.execPath, "run", "script/bundle.ts"], {
        cwd: ROOT_DIR,
        env: {
          ...process.env,
          SENTRY_CLIENT_ID: process.env.SENTRY_CLIENT_ID || "test-client-id",
        },
        stdout: "pipe",
        stderr: "pipe",
      });

      const exitCode = await proc.exited;
      if (exitCode !== 0) {
        const stderr = await new Response(proc.stderr).text();
        // Don't throw — let tests skip gracefully (e.g., generate:schema 429)
        console.error(`Bundle failed with exit code ${exitCode}: ${stderr}`);
      }
    }

    if (!existsSync(INDEX_PATH)) {
      throw new Error("Bundle not built — cannot run library tests");
    }
  }, 60_000);

  afterAll(() => {
    const distDir = join(ROOT_DIR, "dist");
    if (existsSync(distDir)) {
      rmSync(distDir, { recursive: true, force: true });
    }
  });

  // --- Bundle structure ---

  test("dist/index.cjs exists", () => {
    expect(existsSync(INDEX_PATH)).toBe(true);
  });

  test("dist/index.d.cts exists", () => {
    expect(existsSync(TYPES_PATH)).toBe(true);
  });

  test("index.cjs does NOT start with shebang", async () => {
    const content = await Bun.file(INDEX_PATH).text();
    // The library bundle should not have a shebang — that's on bin.cjs only
    expect(content.startsWith("#!/")).toBe(false);
  });

  test("index.cjs does NOT suppress process warnings", async () => {
    const content = await Bun.file(INDEX_PATH).text();
    // The warning suppression (process.emit monkeypatch) moved to bin.cjs
    // The library must not patch the host's process.emit
    expect(content.slice(0, 200)).not.toContain("process.emit");
  });

  // --- Library exports ---

  test("exports sentry as default", async () => {
    const { stdout } = await runNodeScriptOk(`
      const mod = require('./dist/index.cjs');
      console.log(typeof mod.default);
    `);
    expect(stdout.trim()).toBe("function");
  });

  test("exports sentry as named export", async () => {
    const { stdout } = await runNodeScriptOk(`
      const { sentry } = require('./dist/index.cjs');
      console.log(typeof sentry);
    `);
    expect(stdout.trim()).toBe("function");
  });

  test("exports createSentrySDK", async () => {
    const { stdout } = await runNodeScriptOk(`
      const { createSentrySDK } = require('./dist/index.cjs');
      console.log(typeof createSentrySDK);
    `);
    expect(stdout.trim()).toBe("function");
  });

  test("exports SentryError", async () => {
    const { stdout } = await runNodeScriptOk(`
      const { SentryError } = require('./dist/index.cjs');
      console.log(typeof SentryError);
    `);
    expect(stdout.trim()).toBe("function");
  });

  // --- Variadic API ---

  test("sentry('--version') returns version string", async () => {
    const { stdout } = await runNodeScriptOk(`
      const sentry = require('./dist/index.cjs').default;
      sentry('--version').then(r => {
        console.log(JSON.stringify({ type: typeof r, value: r }));
      }).catch(e => {
        console.log(JSON.stringify({ error: e.message }));
        process.exitCode = 1;
      });
    `);
    const result = JSON.parse(stdout.trim());
    expect(result.type).toBe("string");
    expect(result.value).toMatch(/\d+\.\d+/);
  });

  test("sentry() does not pollute process.env", async () => {
    const { stdout } = await runNodeScriptOk(`
      const sentry = require('./dist/index.cjs').default;
      const before = process.env.SENTRY_OUTPUT_FORMAT;
      sentry('--version').then(() => {
        const after = process.env.SENTRY_OUTPUT_FORMAT;
        console.log(JSON.stringify({ before, after, same: before === after }));
      }).catch(() => {
        const after = process.env.SENTRY_OUTPUT_FORMAT;
        console.log(JSON.stringify({ before, after, same: before === after }));
      });
    `);
    const result = JSON.parse(stdout.trim());
    expect(result.same).toBe(true);
  });

  test("sentry() throws SentryError on auth failure", async () => {
    const { stdout } = await runNodeScriptOk(`
      const { default: sentry, SentryError } = require('./dist/index.cjs');
      sentry('org', 'list').then(() => {
        console.log(JSON.stringify({ error: false }));
      }).catch(e => {
        console.log(JSON.stringify({
          isSentryError: e instanceof SentryError,
          name: e.name,
          hasExitCode: typeof e.exitCode === 'number',
          hasStderr: typeof e.stderr === 'string',
        }));
      });
    `);
    const result = JSON.parse(stdout.trim());
    expect(result.isSentryError).toBe(true);
    expect(result.name).toBe("SentryError");
    expect(result.hasExitCode).toBe(true);
    expect(result.hasStderr).toBe(true);
  });

  // --- Typed SDK ---

  test("createSentrySDK() returns object with namespaces", async () => {
    const { stdout } = await runNodeScriptOk(`
      const { createSentrySDK } = require('./dist/index.cjs');
      const sdk = createSentrySDK();
      console.log(JSON.stringify({
        hasOrgs: typeof sdk.organizations === 'object',
        hasIssues: typeof sdk.issues === 'object',
        hasProjects: typeof sdk.projects === 'object',
        orgListFn: typeof sdk.organizations.list === 'function',
        issueListFn: typeof sdk.issues.list === 'function',
      }));
    `);
    const result = JSON.parse(stdout.trim());
    expect(result.hasOrgs).toBe(true);
    expect(result.hasIssues).toBe(true);
    expect(result.hasProjects).toBe(true);
    expect(result.orgListFn).toBe(true);
    expect(result.issueListFn).toBe(true);
  });

  test("SDK throws SentryError on auth failure", async () => {
    const { stdout } = await runNodeScriptOk(`
      const { createSentrySDK, SentryError } = require('./dist/index.cjs');
      const sdk = createSentrySDK();
      sdk.organizations.list().then(() => {
        console.log(JSON.stringify({ error: false }));
      }).catch(e => {
        console.log(JSON.stringify({
          isSentryError: e instanceof SentryError,
          hasExitCode: typeof e.exitCode === 'number',
        }));
      });
    `);
    const result = JSON.parse(stdout.trim());
    expect(result.isSentryError).toBe(true);
    expect(result.hasExitCode).toBe(true);
  });

  // --- Type declarations ---

  test("type declarations contain sentry function", async () => {
    const content = await Bun.file(TYPES_PATH).text();
    expect(content).toContain("export declare function sentry");
    expect(content).toContain("export default sentry");
  });

  test("type declarations contain SentrySDK", async () => {
    const content = await Bun.file(TYPES_PATH).text();
    expect(content).toContain("createSentrySDK");
    expect(content).toContain("SentrySDK");
    expect(content).toContain("organizations");
    expect(content).toContain("issues");
  });

  test("type declarations contain SentryError", async () => {
    const content = await Bun.file(TYPES_PATH).text();
    expect(content).toContain("export declare class SentryError");
    expect(content).toContain("exitCode");
    expect(content).toContain("stderr");
  });

  test("type declarations contain SentryOptions", async () => {
    const content = await Bun.file(TYPES_PATH).text();
    expect(content).toContain("SentryOptions");
    expect(content).toContain("token");
    expect(content).toContain("text");
    expect(content).toContain("cwd");
  });
});
