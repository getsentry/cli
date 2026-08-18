import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
// biome-ignore lint/performance/noNamespaceImport: spyOn requires object reference
import * as dsnIndex from "../../../../src/lib/dsn/index.js";
import { executeTool } from "../../../../src/lib/init/tools/registry.js";
import type {
  ReadFilesV2Data,
  ResolvedInitContext,
  ToolPayload,
} from "../../../../src/lib/init/types.js";
import { precomputeDirListing } from "../../../../src/lib/init/workflow-inputs.js";

function makeContext(directory: string): ResolvedInitContext {
  return {
    directory,
    yes: true,
    dryRun: false,
    org: "acme",
    team: "platform",
    authToken: "sntrys_test_token_123",
  };
}

let testDir: string;
let detectDsnSpy: ReturnType<typeof spyOn>;

beforeEach(() => {
  testDir = fs.mkdtempSync(path.join("/tmp", "init-tools-"));
  detectDsnSpy = vi.spyOn(dsnIndex, "detectDsn").mockResolvedValue(null);
});

afterEach(() => {
  detectDsnSpy.mockRestore();
  fs.rmSync(testDir, { recursive: true, force: true });
});

describe("filesystem tools", () => {
  test("rejects tool execution when cwd escapes the project directory", async () => {
    const payload = {
      type: "tool",
      operation: "list-dir",
      cwd: "/",
      params: { path: "." },
    } as ToolPayload;

    const result = await executeTool(payload, makeContext(testDir));

    expect(result.ok).toBe(false);
    expect(result.error).toContain("outside project directory");
  });

  test("lists and precomputes directory contents", async () => {
    fs.writeFileSync(path.join(testDir, "index.ts"), "export {};\n");
    fs.mkdirSync(path.join(testDir, "src"));
    fs.writeFileSync(
      path.join(testDir, "src", "app.ts"),
      "console.log('x');\n"
    );

    const result = await executeTool(
      {
        type: "tool",
        operation: "list-dir",
        cwd: testDir,
        params: { path: ".", recursive: true, maxDepth: 3 },
      },
      makeContext(testDir)
    );
    const entries = (result.data as { entries: Array<{ path: string }> })
      .entries;
    const precomputed = await precomputeDirListing(testDir);

    expect(result.ok).toBe(true);
    expect(entries.map((entry) => entry.path)).toContain("src/app.ts");
    expect(precomputed.map((entry) => entry.path)).toContain("src/app.ts");
  });

  test("reads files and checks existence in batches", async () => {
    fs.writeFileSync(path.join(testDir, "exists.txt"), "hello");

    const readResult = await executeTool(
      {
        type: "tool",
        operation: "read-files",
        cwd: testDir,
        params: { paths: ["exists.txt", "missing.txt"] },
      },
      makeContext(testDir)
    );
    const existsResult = await executeTool(
      {
        type: "tool",
        operation: "file-exists-batch",
        cwd: testDir,
        params: { paths: ["exists.txt", "missing.txt"] },
      },
      makeContext(testDir)
    );

    expect((readResult.data as any).files["exists.txt"]).toBe("hello");
    expect((readResult.data as any).files["missing.txt"]).toBeNull();
    expect((existsResult.data as any).exists["exists.txt"]).toBe(true);
    expect((existsResult.data as any).exists["missing.txt"]).toBe(false);
  });

  test("returns explicit V2 completion and file errors", async () => {
    fs.writeFileSync(path.join(testDir, "exists.txt"), "hello");

    const result = await executeTool(
      {
        type: "tool",
        operation: "read-files",
        cwd: testDir,
        params: {
          paths: ["exists.txt", "missing.txt"],
          resultVersion: 2,
        },
      },
      makeContext(testDir)
    );
    const data = result.data as ReadFilesV2Data;

    expect(data).toEqual({
      files: {
        "exists.txt": {
          content: "hello",
          fileVersion: expect.any(String),
          offsetBytes: 0,
          returnedBytes: 5,
          status: "ok",
          totalBytes: 5,
          truncated: false,
        },
        "missing.txt": { error: "not-found", status: "error" },
      },
      version: 2,
    });
  });

  test("does not replace a successful V2 read when closing fails", async () => {
    fs.writeFileSync(path.join(testDir, "close-error.txt"), "hello");
    const originalOpen = fs.promises.open.bind(fs.promises);
    const openSpy = vi
      .spyOn(fs.promises, "open")
      .mockImplementation(
        async (...args: Parameters<typeof fs.promises.open>) => {
          const handle = await originalOpen(...args);
          const originalClose = handle.close.bind(handle);
          handle.close = async () => {
            await originalClose();
            throw new Error("simulated close failure");
          };
          return handle;
        }
      );

    try {
      const result = await executeTool(
        {
          type: "tool",
          operation: "read-files",
          cwd: testDir,
          params: { paths: ["close-error.txt"], resultVersion: 2 },
        },
        makeContext(testDir)
      );

      expect(
        (result.data as ReadFilesV2Data).files["close-error.txt"]
      ).toMatchObject({ content: "hello", status: "ok" });
    } finally {
      openSpy.mockRestore();
    }
  });

  test("reports invalid UTF-8 at the start of a V2 file as not-text", async () => {
    fs.writeFileSync(
      path.join(testDir, "invalid-utf8.txt"),
      Buffer.from([0x80, 0x41])
    );

    const result = await executeTool(
      {
        type: "tool",
        operation: "read-files",
        cwd: testDir,
        params: { paths: ["invalid-utf8.txt"], resultVersion: 2 },
      },
      makeContext(testDir)
    );

    expect((result.data as ReadFilesV2Data).files["invalid-utf8.txt"]).toEqual({
      error: "not-text",
      status: "error",
    });
  });

  test.each([
    { bytes: Buffer.from([0x80, 0x41]), title: "continuation byte" },
    { bytes: Buffer.from([0xc0, 0x41]), title: "invalid sequence" },
  ])("reports a torn V2 read as unreadable before classifying its $title", async ({
    bytes,
    title,
  }) => {
    const fileName = `${title.replaceAll(" ", "-")}.txt`;
    const filePath = path.join(testDir, fileName);
    fs.writeFileSync(filePath, bytes);
    const originalOpen = fs.promises.open.bind(fs.promises);
    const openSpy = vi
      .spyOn(fs.promises, "open")
      .mockImplementation(
        async (...args: Parameters<typeof fs.promises.open>) => {
          const handle = await originalOpen(...args);
          const originalRead = handle.read.bind(handle);
          handle.read = (async (
            ...readArgs: Parameters<typeof handle.read>
          ) => {
            const result = await originalRead(...readArgs);
            fs.appendFileSync(filePath, "changed");
            return result;
          }) as typeof handle.read;
          return handle;
        }
      );

    try {
      const result = await executeTool(
        {
          type: "tool",
          operation: "read-files",
          cwd: testDir,
          params: { paths: [fileName], resultVersion: 2 },
        },
        makeContext(testDir)
      );

      expect((result.data as ReadFilesV2Data).files[fileName]).toEqual({
        error: "unreadable",
        status: "error",
      });
    } finally {
      openSpy.mockRestore();
    }
  });

  test("rejects a V2 retry read that makes no byte progress", async () => {
    fs.writeFileSync(path.join(testDir, "retry-zero.txt"), "😀");
    const originalOpen = fs.promises.open.bind(fs.promises);
    const openSpy = vi
      .spyOn(fs.promises, "open")
      .mockImplementation(
        async (...args: Parameters<typeof fs.promises.open>) => {
          const handle = await originalOpen(...args);
          const originalRead = handle.read.bind(handle);
          let readCount = 0;
          handle.read = (async (
            ...readArgs: Parameters<typeof handle.read>
          ) => {
            readCount += 1;
            if (readCount === 2) {
              return { buffer: readArgs[0], bytesRead: 0 };
            }
            return originalRead(...readArgs);
          }) as typeof handle.read;
          return handle;
        }
      );

    try {
      const result = await executeTool(
        {
          type: "tool",
          operation: "read-files",
          cwd: testDir,
          params: {
            maxBytes: 1,
            paths: ["retry-zero.txt"],
            resultVersion: 2,
          },
        },
        makeContext(testDir)
      );

      expect((result.data as ReadFilesV2Data).files["retry-zero.txt"]).toEqual({
        error: "unreadable",
        status: "error",
      });
    } finally {
      openSpy.mockRestore();
    }
  });

  test("preserves a UTF-8 BOM in both wire versions", async () => {
    const content = "\uFEFFexport {};\r\n";
    fs.writeFileSync(path.join(testDir, "bom.ts"), content);

    const legacy = await executeTool(
      {
        type: "tool",
        operation: "read-files",
        cwd: testDir,
        params: { paths: ["bom.ts"] },
      },
      makeContext(testDir)
    );
    const v2 = await executeTool(
      {
        type: "tool",
        operation: "read-files",
        cwd: testDir,
        params: { paths: ["bom.ts"], resultVersion: 2 },
      },
      makeContext(testDir)
    );

    expect(
      (legacy.data as { files: Record<string, string> }).files["bom.ts"]
    ).toBe(content);
    expect((v2.data as ReadFilesV2Data).files["bom.ts"]).toMatchObject({
      content,
      returnedBytes: Buffer.byteLength(content),
    });
  });

  test("preserves legacy replacement decoding at a byte-truncation boundary", async () => {
    fs.writeFileSync(path.join(testDir, "legacy-invalid.txt"), "A😀");

    const legacy = await executeTool(
      {
        type: "tool",
        operation: "read-files",
        cwd: testDir,
        params: { maxBytes: 2, paths: ["legacy-invalid.txt"] },
      },
      makeContext(testDir)
    );
    const v2 = await executeTool(
      {
        type: "tool",
        operation: "read-files",
        cwd: testDir,
        params: {
          maxBytes: 2,
          paths: ["legacy-invalid.txt"],
          resultVersion: 2,
        },
      },
      makeContext(testDir)
    );

    expect(
      (legacy.data as { files: Record<string, string> }).files[
        "legacy-invalid.txt"
      ]
    ).toBe("A�");
    expect(
      (v2.data as ReadFilesV2Data).files["legacy-invalid.txt"]
    ).toMatchObject({
      content: "A",
      nextOffsetBytes: 1,
    });
  });

  test("continues a V2 read with an exact UTF-8 byte cursor", async () => {
    fs.writeFileSync(path.join(testDir, "unicode.txt"), "A😀BC");

    const first = await executeTool(
      {
        type: "tool",
        operation: "read-files",
        cwd: testDir,
        params: {
          maxBytes: 3,
          paths: ["unicode.txt"],
          resultVersion: 2,
        },
      },
      makeContext(testDir)
    );
    const firstFile = (first.data as ReadFilesV2Data).files["unicode.txt"];
    expect(firstFile).toEqual({
      content: "A",
      fileVersion: expect.any(String),
      nextOffsetBytes: 1,
      offsetBytes: 0,
      returnedBytes: 1,
      status: "ok",
      totalBytes: 7,
      truncated: true,
    });

    const second = await executeTool(
      {
        type: "tool",
        operation: "read-files",
        cwd: testDir,
        params: {
          maxBytes: 3,
          offsetBytes: 1,
          paths: ["unicode.txt"],
          resultVersion: 2,
        },
      },
      makeContext(testDir)
    );
    const secondFile = (second.data as ReadFilesV2Data).files["unicode.txt"];
    expect(secondFile).toEqual({
      content: "😀",
      fileVersion: expect.any(String),
      nextOffsetBytes: 5,
      offsetBytes: 1,
      returnedBytes: 4,
      status: "ok",
      totalBytes: 7,
      truncated: true,
    });
    expect(firstFile.status).toBe("ok");
    expect(secondFile.status).toBe("ok");
    if (firstFile.status === "ok" && secondFile.status === "ok") {
      expect(secondFile.fileVersion).toBe(firstFile.fileVersion);
    }

    const invalid = await executeTool(
      {
        type: "tool",
        operation: "read-files",
        cwd: testDir,
        params: {
          offsetBytes: 2,
          paths: ["unicode.txt"],
          resultVersion: 2,
        },
      },
      makeContext(testDir)
    );
    expect((invalid.data as ReadFilesV2Data).files["unicode.txt"]).toEqual({
      error: "invalid-offset",
      status: "error",
    });
  });

  test("applies patchsets and injects auth tokens into env files", async () => {
    const result = await executeTool(
      {
        type: "tool",
        operation: "apply-patchset",
        cwd: testDir,
        params: {
          patches: [
            {
              path: ".env.sentry-build-plugin",
              action: "create",
              patch: "SENTRY_AUTH_TOKEN=\n",
            },
          ],
        },
      },
      makeContext(testDir)
    );

    expect(result.ok).toBe(true);
    expect(
      fs.readFileSync(path.join(testDir, ".env.sentry-build-plugin"), "utf-8")
    ).toContain("sntrys_test_token_123");
  });

  test("rejects unsafe apply-patchset paths before writing", async () => {
    const unsafePaths: unknown[] = [
      null,
      "../../outside.txt",
      "/tmp/outside.txt",
      "C:/repo/package.json",
      "C:\\repo\\package.json",
      "apps/../package.json",
      "./package.json",
      "apps//package.json",
    ];

    for (const unsafePath of unsafePaths) {
      const result = await executeTool(
        {
          type: "tool",
          operation: "apply-patchset",
          cwd: testDir,
          params: {
            patches: [
              {
                path: unsafePath as never,
                action: "create",
                patch: "should not be written\n",
              },
            ],
          },
        },
        makeContext(testDir)
      );

      expect(result.ok).toBe(false);
      expect(result.error).toMatch(
        /Invalid (?:file change path|file changes request)/
      );
    }
  });

  test("applies patchsets to nested project-relative files", async () => {
    fs.mkdirSync(path.join(testDir, "Cary.ConversionFunnels.API"));
    fs.writeFileSync(
      path.join(
        testDir,
        "Cary.ConversionFunnels.API",
        "Cary.ConversionFunnels.API.csproj"
      ),
      "<Project></Project>\n"
    );

    const result = await executeTool(
      {
        type: "tool",
        operation: "apply-patchset",
        cwd: testDir,
        params: {
          patches: [
            {
              path: "Directory.Packages.props",
              action: "create",
              patch: "<Project></Project>\n",
            },
            {
              path: "Cary.ConversionFunnels.API/Cary.ConversionFunnels.API.csproj",
              action: "modify",
              edits: [
                {
                  oldString: "<Project></Project>",
                  newString:
                    '<Project><ItemGroup><PackageReference Include="Sentry.AspNetCore" /></ItemGroup></Project>',
                },
              ],
            },
          ],
        },
      },
      makeContext(testDir)
    );

    expect(result.ok).toBe(true);
    expect(
      fs.readFileSync(path.join(testDir, "Directory.Packages.props"), "utf-8")
    ).toContain("<Project>");
    expect(
      fs.readFileSync(
        path.join(
          testDir,
          "Cary.ConversionFunnels.API",
          "Cary.ConversionFunnels.API.csproj"
        ),
        "utf-8"
      )
    ).toContain("Sentry.AspNetCore");
  });

  test("greps and globs files inside the project", async () => {
    fs.mkdirSync(path.join(testDir, "src"));
    fs.writeFileSync(
      path.join(testDir, "src", "app.ts"),
      "Sentry.captureException(error);\n"
    );

    const grepResult = await executeTool(
      {
        type: "tool",
        operation: "grep",
        cwd: testDir,
        params: { searches: [{ pattern: "captureException" }] },
      },
      makeContext(testDir)
    );
    const globResult = await executeTool(
      {
        type: "tool",
        operation: "glob",
        cwd: testDir,
        params: { patterns: ["**/*.ts"] },
      },
      makeContext(testDir)
    );

    expect((grepResult.data as any).results[0].matches[0].path).toBe(
      "src/app.ts"
    );
    expect((globResult.data as any).results[0].files).toContain("src/app.ts");
  });

  test("reports installed Sentry signals when a DSN is detected", async () => {
    detectDsnSpy.mockResolvedValue({
      publicKey: "abc",
      protocol: "https",
      host: "o1.ingest.sentry.io",
      projectId: "42",
      raw: "https://abc@o1.ingest.sentry.io/42",
      source: "env_file" as const,
      sourcePath: ".env",
    });

    const result = await executeTool(
      {
        type: "tool",
        operation: "detect-sentry",
        cwd: testDir,
        params: {},
      },
      makeContext(testDir)
    );

    expect(result.ok).toBe(true);
    expect(result.data).toEqual(
      expect.objectContaining({
        status: "installed",
        dsn: "https://abc@o1.ingest.sentry.io/42",
      })
    );
  });
});
