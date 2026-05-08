/**
 * Install Script Tests
 *
 * Exercises the shell installer with fake download tools so argument parsing and
 * setup delegation can be validated without network access.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "..", "..");
const installScript = join(repoRoot, "install");

describe("install script", () => {
  let testDir: string;
  let binDir: string;
  let argsFile: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "sentry-install-test-"));
    binDir = join(testDir, "bin");
    argsFile = join(testDir, "setup-args.txt");
    mkdirSync(binDir, { recursive: true });

    const fakeCurl = `#!/usr/bin/env bash
cat <<'SCRIPT'
#!/usr/bin/env bash
printf '%s\n' "$@" > "$SENTRY_TEST_ARGS_FILE"
SCRIPT
`;
    writeFileSync(join(binDir, "curl"), fakeCurl);
    chmodSync(join(binDir, "curl"), 0o755);

    const fakeGunzip = `#!/usr/bin/env bash
cat
`;
    writeFileSync(join(binDir, "gunzip"), fakeGunzip);
    chmodSync(join(binDir, "gunzip"), 0o755);
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  test("passes --no-agent-skills through to sentry cli setup", async () => {
    const proc = Bun.spawn(
      [
        "bash",
        installScript,
        "--version",
        "0.31.0",
        "--no-modify-path",
        "--no-completions",
        "--no-agent-skills",
      ],
      {
        env: {
          ...process.env,
          PATH: `${binDir}:${process.env.PATH ?? ""}`,
          SENTRY_TEST_ARGS_FILE: argsFile,
          TMPDIR: testDir,
        },
        stderr: "pipe",
        stdout: "pipe",
      }
    );

    const [exitCode, stdout, stderr] = await Promise.all([
      proc.exited,
      Bun.readableStreamToText(proc.stdout),
      Bun.readableStreamToText(proc.stderr),
    ]);

    expect({ exitCode, stdout, stderr }).toMatchObject({ exitCode: 0 });
    expect(readFileSync(argsFile, "utf8").trim().split("\n")).toEqual([
      "cli",
      "setup",
      "--install",
      "--method",
      "curl",
      "--channel",
      "stable",
      "--no-modify-path",
      "--no-completions",
      "--no-agent-skills",
    ]);
  });
});
