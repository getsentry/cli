import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { executeTool } from "../../../../src/lib/init/tools/registry.js";
import type {
  ResolvedInitContext,
  ToolPayload,
} from "../../../../src/lib/init/types.js";

function makeContext(directory: string): ResolvedInitContext {
  return {
    directory,
    yes: true,
    dryRun: false,
    org: "acme",
    team: "platform",
  };
}

function makeToolPayload(payload: Omit<ToolPayload, "type">): ToolPayload {
  return {
    type: "tool",
    ...payload,
  } as ToolPayload;
}

function writeExecutable(filePath: string, content: string): void {
  fs.writeFileSync(filePath, content, { mode: 0o755 });
}

function setPath(entries: string[]): void {
  process.env.PATH = entries.join(path.delimiter);
}

let savedPath: string | undefined;
let testDir: string;
let helperBinDir: string;

beforeEach(() => {
  savedPath = process.env.PATH;
  testDir = fs.mkdtempSync(path.join("/tmp", "init-search-"));
  helperBinDir = fs.mkdtempSync(path.join("/tmp", "init-search-bin-"));

  fs.writeFileSync(
    path.join(testDir, "app.ts"),
    'import * as Sentry from "@sentry/node";\nSentry.init({ dsn: "..." });\n'
  );
  fs.writeFileSync(
    path.join(testDir, "utils.ts"),
    "export function helper() { return 1; }\n"
  );
  fs.writeFileSync(path.join(testDir, "config.json"), "{}\n");
  fs.mkdirSync(path.join(testDir, "src"));
  fs.writeFileSync(
    path.join(testDir, "src", "index.ts"),
    'import { helper } from "./utils";\nSentry.init({});\n'
  );
});

afterEach(() => {
  process.env.PATH = savedPath;
  fs.rmSync(testDir, { recursive: true, force: true });
  fs.rmSync(helperBinDir, { recursive: true, force: true });
});

describe("search tools", () => {
  test("supports old grep include filters and subdirectory-relative paths", async () => {
    const grepWithInclude = await executeTool(
      makeToolPayload({
        operation: "grep",
        cwd: testDir,
        params: { searches: [{ pattern: "Sentry", include: "app.*" }] },
      }),
      makeContext(testDir)
    );
    const grepSubdir = await executeTool(
      makeToolPayload({
        operation: "grep",
        cwd: testDir,
        params: { searches: [{ pattern: "helper", path: "src" }] },
      }),
      makeContext(testDir)
    );

    expect(grepWithInclude.ok).toBe(true);
    for (const match of (grepWithInclude.data as any).results[0].matches) {
      expect(match.path).toContain("app");
    }

    expect(grepSubdir.ok).toBe(true);
    for (const match of (grepSubdir.data as any).results[0].matches) {
      expect(match.path).toMatch(/^src\//);
    }
  });

  test("supports old glob multi-pattern and empty-result behavior", async () => {
    const matches = await executeTool(
      makeToolPayload({
        operation: "glob",
        cwd: testDir,
        params: { patterns: ["*.ts", "*.json"] },
      }),
      makeContext(testDir)
    );
    const empty = await executeTool(
      makeToolPayload({
        operation: "glob",
        cwd: testDir,
        params: { patterns: ["*.xyz"] },
      }),
      makeContext(testDir)
    );

    expect(matches.ok).toBe(true);
    expect((matches.data as any).results).toHaveLength(2);
    expect(
      (matches.data as any).results[0].files.length
    ).toBeGreaterThanOrEqual(2);
    expect(
      (matches.data as any).results[1].files.length
    ).toBeGreaterThanOrEqual(1);

    expect(empty.ok).toBe(true);
    expect((empty.data as any).results[0].files).toHaveLength(0);
  });

  test("falls back to git-based grep and glob when rg is unavailable", async () => {
    const realGit = Bun.which("git");
    expect(realGit).toBeString();

    const initResult = Bun.spawnSync([realGit as string, "init"], {
      cwd: testDir,
      stdout: "ignore",
      stderr: "ignore",
    });
    expect(initResult.exitCode).toBe(0);

    writeExecutable(
      path.join(helperBinDir, "git"),
      `#!/bin/sh\nexec "${realGit}" "$@"\n`
    );
    setPath([helperBinDir]);

    const grepResult = await executeTool(
      makeToolPayload({
        operation: "grep",
        cwd: testDir,
        params: { searches: [{ pattern: "Sentry\\.init" }] },
      }),
      makeContext(testDir)
    );
    const globResult = await executeTool(
      makeToolPayload({
        operation: "glob",
        cwd: testDir,
        params: { patterns: ["*.ts"] },
      }),
      makeContext(testDir)
    );

    expect(grepResult.ok).toBe(true);
    expect((grepResult.data as any).results[0].matches.length).toBeGreaterThan(
      0
    );
    expect(globResult.ok).toBe(true);
    expect((globResult.data as any).results[0].files).toContain("app.ts");
  });

  test("falls back to filesystem search when rg and git are unavailable", async () => {
    setPath([helperBinDir]);

    const grepResult = await executeTool(
      makeToolPayload({
        operation: "grep",
        cwd: testDir,
        params: { searches: [{ pattern: "helper" }] },
      }),
      makeContext(testDir)
    );
    const globResult = await executeTool(
      makeToolPayload({
        operation: "glob",
        cwd: testDir,
        params: { patterns: ["**/*.ts"] },
      }),
      makeContext(testDir)
    );

    expect(grepResult.ok).toBe(true);
    expect((grepResult.data as any).results[0].matches.length).toBeGreaterThan(
      0
    );
    expect(globResult.ok).toBe(true);
    expect((globResult.data as any).results[0].files).toContain("src/index.ts");
  });

  test("drains stderr during rg-based glob searches", async () => {
    fs.writeFileSync(path.join(testDir, "src", "app.ts"), "export {};\n");
    writeExecutable(
      path.join(helperBinDir, "rg"),
      [
        "#!/bin/sh",
        'target="$5"',
        "i=0",
        'while [ "$i" -lt 70000 ]; do',
        "  printf x >&2",
        "  i=$((i + 1))",
        "done",
        "printf '%s\\n' \"$target/src/app.ts\"",
      ].join("\n")
    );
    setPath([helperBinDir]);

    const result = await executeTool(
      makeToolPayload({
        operation: "glob",
        cwd: testDir,
        params: { patterns: ["**/*.ts"] },
      }),
      makeContext(testDir)
    );

    expect(result.ok).toBe(true);
    expect((result.data as any).results[0].files).toContain("src/app.ts");
  });

  test("rejects grep paths outside the init sandbox", async () => {
    const result = await executeTool(
      makeToolPayload({
        operation: "grep",
        cwd: testDir,
        params: { searches: [{ pattern: "test", path: "../../etc" }] },
      }),
      makeContext(testDir)
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain("outside project directory");
  });
});
