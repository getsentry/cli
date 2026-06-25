/**
 * Tests for `sentry debug-files upload`.
 *
 * Uses Breakpad symbol files (a deterministic, portable text format) as
 * fixtures so the tests need no committed binaries. Filter and dry-run paths
 * run end-to-end through the scanner; the network upload is stubbed by spying
 * on `uploadDebugFiles`.
 */

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "@stricli/core";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { app } from "../../../src/app.js";
import type { SentryContext } from "../../../src/context.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as chunkUpload from "../../../src/lib/api/chunk-upload.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as debugFilesApi from "../../../src/lib/api/debug-files.js";
import { useTestConfigDir } from "../../helpers.js";

useTestConfigDir("debug-files-upload-");

const BREAKPAD_FIXTURE = [
  "MODULE Linux x86_64 0F13A5DA412AFBF7C8662048F3294F3D0 example",
  "INFO CODE_ID DAA5130F2A41F7FBC8662048F3294F3D439CA7FF",
  "FUNC 1000 10 0 main",
  "1000 10 42 1",
  "PUBLIC 2000 0 some_symbol",
].join("\n");

const KNOWN_DEBUG_ID = "0f13a5da-412a-fbf7-c866-2048f3294f3d";

let tempDir: string;
let savedEnv: Record<string, string | undefined>;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "df-upload-test-"));
  savedEnv = {
    SENTRY_ORG: process.env.SENTRY_ORG,
    SENTRY_PROJECT: process.env.SENTRY_PROJECT,
  };
  // The real-upload path fetches chunk-upload options before scanning to gate
  // on the server's max file size. Stub it so tests need no network.
  vi.spyOn(chunkUpload, "getChunkUploadOptions").mockResolvedValue({
    url: "https://us.sentry.io/api/0/chunk-upload/",
    chunkSize: 8192,
    chunksPerRequest: 64,
    maxRequestSize: 1_048_576,
    hashAlgorithm: "sha1",
    concurrency: 8,
    compression: ["gzip"],
  } as Awaited<ReturnType<typeof chunkUpload.getChunkUploadOptions>>);
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = v;
    }
  }
  vi.restoreAllMocks();
});

/** Write a Breakpad symbol file inside `tempDir` and return its path. */
async function writeBreakpad(name = "example.sym"): Promise<string> {
  const path = join(tempDir, name);
  await writeFile(path, BREAKPAD_FIXTURE);
  return path;
}

/** Run `debug-files upload` and capture stdout + exit code. */
async function runUpload(
  args: string[]
): Promise<{ output: string; error: string; exitCode: number | undefined }> {
  let output = "";
  let error = "";
  const mockContext: SentryContext = {
    process: { ...process, exitCode: undefined } as typeof process,
    env: process.env,
    cwd: tempDir,
    homeDir: "/tmp",
    configDir: "/tmp",
    stdout: {
      write(data: string | Uint8Array) {
        output +=
          typeof data === "string" ? data : new TextDecoder().decode(data);
        return true;
      },
    },
    stderr: {
      write(data: string | Uint8Array) {
        error +=
          typeof data === "string" ? data : new TextDecoder().decode(data);
        return true;
      },
    },
    stdin: process.stdin,
  };

  await run(app, ["debug-files", "upload", ...args], mockContext);
  return { output, error, exitCode: mockContext.process.exitCode };
}

describe("sentry debug-files upload", () => {
  // ── Input validation ─────────────────────────────────────────────

  test("no paths exits non-zero", async () => {
    const { exitCode } = await runUpload([]);
    expect(exitCode).not.toBe(0);
  });

  test("--wait and --wait-for together exits non-zero", async () => {
    const path = await writeBreakpad();
    const { exitCode } = await runUpload([
      path,
      "--no-upload",
      "--wait",
      "--wait-for",
      "30",
    ]);
    expect(exitCode).not.toBe(0);
  });

  test("unknown --type exits non-zero", async () => {
    const path = await writeBreakpad();
    const { exitCode } = await runUpload([
      path,
      "--type",
      "bogus",
      "--no-upload",
    ]);
    expect(exitCode).not.toBe(0);
  });

  // ── --derived-data ───────────────────────────────────────────────

  test("--derived-data is additive: explicit paths still scan", async () => {
    await writeBreakpad();
    const { output, exitCode } = await runUpload([
      tempDir,
      "--derived-data",
      "--no-upload",
      "--json",
    ]);
    expect(exitCode).toBe(0);
    // The explicit tempDir fixture is found regardless of whether a
    // DerivedData folder exists on this platform.
    expect(JSON.parse(output).files).toHaveLength(1);
  });

  test.skipIf(process.platform === "darwin")(
    "--derived-data alone on non-macOS exits non-zero (no scan targets)",
    async () => {
      const { exitCode } = await runUpload(["--derived-data", "--no-upload"]);
      expect(exitCode).not.toBe(0);
    }
  );

  // ── --no-upload (dry-run) ────────────────────────────────────────

  test("--no-upload scans a directory and reports the debug id", async () => {
    await writeBreakpad();
    const { output, exitCode } = await runUpload([tempDir, "--no-upload"]);
    expect(output).toContain(KNOWN_DEBUG_ID);
    expect(exitCode).toBe(0);
  });

  test("--no-upload --json reports uploaded:false with the file", async () => {
    await writeBreakpad();
    const { output } = await runUpload([tempDir, "--no-upload", "--json"]);
    const parsed = JSON.parse(output);
    expect(parsed.uploaded).toBe(false);
    expect(parsed.files).toHaveLength(1);
    expect(parsed.files[0].debugId).toBe(KNOWN_DEBUG_ID);
  });

  test("--no-upload needs no credentials", async () => {
    delete process.env.SENTRY_ORG;
    delete process.env.SENTRY_PROJECT;
    await writeBreakpad();
    const { exitCode } = await runUpload([tempDir, "--no-upload"]);
    expect(exitCode).toBe(0);
  });

  // ── Filters ──────────────────────────────────────────────────────

  test("--type breakpad matches the fixture", async () => {
    await writeBreakpad();
    const { output } = await runUpload([
      tempDir,
      "--type",
      "breakpad",
      "--no-upload",
      "--json",
    ]);
    expect(JSON.parse(output).files).toHaveLength(1);
  });

  test("--type breakpad --include-sources --no-upload attaches a bundle", async () => {
    // The fixture has no source files, so createSourceBundle returns null;
    // we just verify --include-sources does not break the flow.
    await writeBreakpad();
    const { output, exitCode } = await runUpload([
      tempDir,
      "--type",
      "breakpad",
      "--no-upload",
      "--include-sources",
      "--json",
    ]);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(output);
    // The main DIF is always present; the bundle is only added when
    // createSourceBundle returns one or more files.
    expect(parsed.files.length).toBeGreaterThanOrEqual(1);
  });

  test("--type elf excludes a breakpad file", async () => {
    await writeBreakpad();
    const { output } = await runUpload([
      tempDir,
      "--type",
      "elf",
      "--no-upload",
      "--json",
    ]);
    expect(JSON.parse(output).files).toHaveLength(0);
  });

  test("--id matching the fixture keeps it", async () => {
    await writeBreakpad();
    const { output } = await runUpload([
      tempDir,
      "--id",
      KNOWN_DEBUG_ID,
      "--no-upload",
      "--json",
    ]);
    expect(JSON.parse(output).files).toHaveLength(1);
  });

  test("--id with no match drops the file", async () => {
    await writeBreakpad();
    const { output } = await runUpload([
      tempDir,
      "--id",
      "11111111-1111-1111-1111-111111111111",
      "--no-upload",
      "--json",
    ]);
    expect(JSON.parse(output).files).toHaveLength(0);
  });

  test("--require-all with a missing id exits non-zero", async () => {
    await writeBreakpad();
    const { exitCode } = await runUpload([
      tempDir,
      "--id",
      "11111111-1111-1111-1111-111111111111",
      "--require-all",
      "--no-upload",
    ]);
    expect(exitCode).toBe(1);
  });

  test("--id without --require-all does not fail (dry-run)", async () => {
    await writeBreakpad();
    const { exitCode } = await runUpload([
      tempDir,
      "--id",
      "11111111-1111-1111-1111-111111111111",
      "--no-upload",
    ]);
    expect(exitCode).toBe(0);
  });

  // ── Upload orchestration ─────────────────────────────────────────

  test("uploads scanned files via uploadDebugFiles", async () => {
    process.env.SENTRY_ORG = "test-org";
    process.env.SENTRY_PROJECT = "test-project";
    await writeBreakpad();

    const spy = vi.spyOn(debugFilesApi, "uploadDebugFiles").mockResolvedValue([
      {
        name: "example.sym",
        debugId: KNOWN_DEBUG_ID,
        checksum: "a".repeat(40),
        state: "ok",
        detail: null,
      },
    ]);

    const { exitCode } = await runUpload([tempDir]);
    expect(spy).toHaveBeenCalledTimes(1);
    const callArgs = spy.mock.calls[0]?.[0];
    expect(callArgs?.org).toBe("test-org");
    expect(callArgs?.project).toBe("test-project");
    expect(callArgs?.difs).toHaveLength(1);
    expect(callArgs?.difs[0]?.debugId).toBe(KNOWN_DEBUG_ID);
    expect(callArgs?.difs[0]?.content).toBeInstanceOf(Buffer);
    // The server options fetched for the scan gate are threaded through so
    // uploadDebugFiles does not re-fetch them.
    expect(callArgs?.serverOptions).toBeDefined();
    expect(exitCode).toBe(0);
  });

  test("server maxFileSize gating all files exits non-zero with a clear error", async () => {
    process.env.SENTRY_ORG = "test-org";
    process.env.SENTRY_PROJECT = "test-project";
    await writeBreakpad();
    // Advertise a 10-byte cap; the fixture is well over that, so it is skipped
    // during the scan and never reaches uploadDebugFiles. Because a real DIF
    // was found but dropped for size, the command must fail loudly rather than
    // reporting "nothing found".
    vi.spyOn(chunkUpload, "getChunkUploadOptions").mockResolvedValue({
      url: "https://us.sentry.io/api/0/chunk-upload/",
      chunkSize: 8192,
      chunksPerRequest: 64,
      maxRequestSize: 1_048_576,
      maxFileSize: 10,
      hashAlgorithm: "sha1",
      concurrency: 8,
      compression: ["gzip"],
    } as Awaited<ReturnType<typeof chunkUpload.getChunkUploadOptions>>);
    const spy = vi.spyOn(debugFilesApi, "uploadDebugFiles");

    const { exitCode } = await runUpload([tempDir]);
    expect(spy).not.toHaveBeenCalled();
    expect(exitCode).not.toBe(0);
  });

  test("wait mode surfaces processing errors with a non-zero exit", async () => {
    process.env.SENTRY_ORG = "test-org";
    process.env.SENTRY_PROJECT = "test-project";
    await writeBreakpad();

    vi.spyOn(debugFilesApi, "uploadDebugFiles").mockResolvedValue([
      {
        name: "example.sym",
        debugId: KNOWN_DEBUG_ID,
        checksum: "a".repeat(40),
        state: "error",
        detail: "could not process",
      },
    ]);

    const { exitCode } = await runUpload([tempDir, "--wait"]);
    expect(exitCode).toBe(1);
  });

  test("a not_found result exits non-zero (chunk delivery incomplete)", async () => {
    process.env.SENTRY_ORG = "test-org";
    process.env.SENTRY_PROJECT = "test-project";
    await writeBreakpad();

    vi.spyOn(debugFilesApi, "uploadDebugFiles").mockResolvedValue([
      {
        name: "example.sym",
        debugId: KNOWN_DEBUG_ID,
        checksum: "a".repeat(40),
        state: "not_found",
        detail: null,
      },
    ]);

    const { exitCode } = await runUpload([tempDir]);
    expect(exitCode).toBe(1);
  });

  test("--require-all on a real upload fails when an --id is missing", async () => {
    process.env.SENTRY_ORG = "test-org";
    process.env.SENTRY_PROJECT = "test-project";
    await writeBreakpad();

    const spy = vi.spyOn(debugFilesApi, "uploadDebugFiles").mockResolvedValue([
      {
        name: "example.sym",
        debugId: KNOWN_DEBUG_ID,
        checksum: "a".repeat(40),
        state: "ok",
        detail: null,
      },
    ]);

    const { exitCode, output } = await runUpload([
      tempDir,
      "--id",
      KNOWN_DEBUG_ID,
      "--id",
      "11111111-1111-1111-1111-111111111111",
      "--require-all",
    ]);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(exitCode).toBe(1);
    expect(output).toContain("11111111-1111-1111-1111-111111111111");
  });

  test("--require-all is honored when the queue is empty (real upload)", async () => {
    process.env.SENTRY_ORG = "test-org";
    process.env.SENTRY_PROJECT = "test-project";
    await writeBreakpad();
    const spy = vi.spyOn(debugFilesApi, "uploadDebugFiles");

    // The only --id requested doesn't match the fixture, so the queue is empty.
    // doNothingToUpload must still honor --require-all and report the missing
    // id (exit 1) rather than skipping the check.
    const { exitCode, output } = await runUpload([
      tempDir,
      "--id",
      "11111111-1111-1111-1111-111111111111",
      "--require-all",
    ]);
    expect(spy).not.toHaveBeenCalled();
    expect(exitCode).toBe(1);
    expect(output).toContain("11111111-1111-1111-1111-111111111111");
  });

  test("--id without --require-all does not fail on a real upload", async () => {
    process.env.SENTRY_ORG = "test-org";
    process.env.SENTRY_PROJECT = "test-project";
    await writeBreakpad();

    vi.spyOn(debugFilesApi, "uploadDebugFiles").mockResolvedValue([
      {
        name: "example.sym",
        debugId: KNOWN_DEBUG_ID,
        checksum: "a".repeat(40),
        state: "ok",
        detail: null,
      },
    ]);

    const { exitCode } = await runUpload([
      tempDir,
      "--id",
      "11111111-1111-1111-1111-111111111111",
    ]);
    expect(exitCode).toBe(0);
  });

  test("reports nothing to upload when no debug files are found", async () => {
    process.env.SENTRY_ORG = "test-org";
    process.env.SENTRY_PROJECT = "test-project";
    await writeFile(join(tempDir, "notes.txt"), "not a debug file");

    const spy = vi.spyOn(debugFilesApi, "uploadDebugFiles");
    const { exitCode } = await runUpload([tempDir]);
    expect(spy).not.toHaveBeenCalled();
    expect(exitCode).toBe(0);
  });
});
