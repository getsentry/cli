/**
 * Contract test for the no-generic-is-record Biome plugin.
 */

import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "vitest";
import "../../script/node-polyfills.js";

const REPO_ROOT = join(import.meta.dirname, "../..");
const BIOME_BIN = join(REPO_ROOT, "node_modules/.bin/biome");
const RULE_PATH = join(REPO_ROOT, "lint-rules/no-generic-is-record.grit");
const bun = globalThis.Bun;

describe("no-generic-is-record lint rule", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "no-generic-is-record-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("matches generic copies but allows domain-specific guards", async () => {
    const commandDir = join(tempDir, "src/commands/example");
    const libDir = join(tempDir, "src/lib");
    const configPath = join(tempDir, "biome.json");
    await Promise.all([
      mkdir(commandDir, { recursive: true }),
      mkdir(libDir, { recursive: true }),
    ]);

    await Promise.all([
      bun.write(configPath, JSON.stringify({ plugins: [RULE_PATH] })),
      bun.write(
        join(commandDir, "function-copy.ts"),
        `export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
`
      ),
      bun.write(
        join(commandDir, "inferred-function-copy.ts"),
        `function isRecord(value: unknown) {
  return typeof value === "object" && value !== null;
}
`
      ),
      bun.write(
        join(commandDir, "async-function-copy.ts"),
        `async function isRecord(value: unknown) {
  return typeof value === "object" && value !== null;
}
`
      ),
      bun.write(
        join(libDir, "const-copy.ts"),
        `export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;
`
      ),
      bun.write(
        join(libDir, "typed-const-copy.ts"),
        `type Guard = (value: unknown) => value is Record<string, unknown>;
const isRecord: Guard = (value) =>
  typeof value === "object" && value !== null;
`
      ),
      bun.write(
        join(libDir, "function-expression-copy.ts"),
        `const isRecord = function (value: unknown) {
  return typeof value === "object" && value !== null;
};
`
      ),
      bun.write(
        join(libDir, "let-copy.ts"),
        `let isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;
isRecord = () => false;
`
      ),
      bun.write(
        join(libDir, "unparenthesized-copy.ts"),
        `const isRecord = value => value !== null;
`
      ),
      bun.write(
        join(libDir, "record-flag.ts"),
        `const schema = { type: "record" };
export const isRecord = schema.type === "record";
`
      ),
      bun.write(
        join(libDir, "workflow.ts"),
        `export function hasFileMap(
  value: unknown
): value is { files: Record<string, unknown> } {
  return typeof value === "object" && value !== null && "files" in value;
}
`
      ),
    ]);

    const result = bun.spawnSync(
      [
        BIOME_BIN,
        "lint",
        `--config-path=${configPath}`,
        "--reporter=json",
        "--max-diagnostics=none",
        tempDir,
      ],
      { cwd: REPO_ROOT, stdout: "pipe", stderr: "pipe" }
    );

    const stdout = new TextDecoder().decode(result.stdout);
    const stderr = new TextDecoder().decode(result.stderr);
    expect(result.exitCode, `${stderr}\n${stdout}`).toBe(1);
    const report = JSON.parse(stdout) as {
      summary: { errors: number };
      diagnostics: Array<{ location: { path: { file: string } } }>;
    };
    expect(report.summary.errors).toBe(8);
    expect(
      report.diagnostics.map((diagnostic) => diagnostic.location.path.file)
    ).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/function-copy\.ts$/),
        expect.stringMatching(/inferred-function-copy\.ts$/),
        expect.stringMatching(/async-function-copy\.ts$/),
        expect.stringMatching(/const-copy\.ts$/),
        expect.stringMatching(/typed-const-copy\.ts$/),
        expect.stringMatching(/function-expression-copy\.ts$/),
        expect.stringMatching(/let-copy\.ts$/),
        expect.stringMatching(/unparenthesized-copy\.ts$/),
      ])
    );
    expect(
      report.diagnostics.some((diagnostic) =>
        diagnostic.location.path.file.endsWith("src/lib/workflow.ts")
      )
    ).toBe(false);
    expect(
      report.diagnostics.some((diagnostic) =>
        diagnostic.location.path.file.endsWith("src/lib/record-flag.ts")
      )
    ).toBe(false);
  });
});
