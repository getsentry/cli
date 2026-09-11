/**
 * Install Script Tests
 *
 * Exercises the shell installer with fake download tools so argument parsing and
 * setup delegation can be validated without network access.
 */

import { spawn, spawnSync } from "node:child_process";
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
import { afterEach, beforeEach, describe, expect, test } from "vitest";

function noop(): void {
  // Intentionally empty — absorbs async spawn errors
}

const repoRoot = join(import.meta.dirname, "..", "..");
const installScript = join(repoRoot, "install");

describe("install script", () => {
  let testDir: string;
  let binDir: string;
  let argsFile: string;
  let ttyFile: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "sentry-install-test-"));
    binDir = join(testDir, "bin");
    argsFile = join(testDir, "setup-args.txt");
    ttyFile = join(testDir, "setup-tty.txt");
    mkdirSync(binDir, { recursive: true });

    const fakeCurl = `#!/usr/bin/env bash
cat <<'SCRIPT'
#!/usr/bin/env bash
printf '%s\n' "$@" > "$SENTRY_TEST_ARGS_FILE"
{
  for fd in 0 1 2; do
    if [[ -t "$fd" ]]; then
      printf '%s:true\\n' "$fd" >&3
    else
      printf '%s:false\\n' "$fd" >&3
    fi
  done
  if { : </dev/tty; } 2>/dev/null; then
    printf 'controlling:true\\n' >&3
  else
    printf 'controlling:false\\n' >&3
  fi
} 3>"$SENTRY_TEST_TTY_FILE"
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
    const proc = spawn(
      "bash",
      [
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
          SENTRY_TEST_TTY_FILE: ttyFile,
          TMPDIR: testDir,
        },
        stdio: ["pipe", "pipe", "pipe"],
      }
    );
    proc.on("error", noop);

    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d: Buffer) => {
      stdout += d;
    });
    proc.stderr.on("data", (d: Buffer) => {
      stderr += d;
    });

    const exitCode = await new Promise<number>((resolve) =>
      proc.on("close", (code) => resolve(code ?? 1))
    );

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
    expect(
      readFileSync(ttyFile, "utf8").trim().split("\n").slice(0, 3)
    ).toEqual(["0:false", "1:false", "2:false"]);
  });

  test.each([
    {
      name: "reconnects piped stdin when output and controlling terminal are interactive",
      redirect: "",
      detached: false,
      expected: ["0:true", "1:true", "2:true", "controlling:true"],
    },
    {
      name: "keeps piped stdin when stdout is redirected despite a controlling terminal",
      redirect: " >/dev/null",
      detached: false,
      expected: ["0:false", "1:false", "2:true", "controlling:true"],
    },
    {
      name: "keeps piped stdin when stderr is redirected despite a controlling terminal",
      redirect: " 2>/dev/null",
      detached: false,
      expected: ["0:false", "1:true", "2:false", "controlling:true"],
    },
    {
      name: "keeps piped stdin when terminal output has no controlling terminal",
      redirect: "",
      detached: true,
      expected: ["0:false", "1:true", "2:true", "controlling:false"],
    },
  ])("$name", ({ redirect, detached, expected }) => {
    // script(1) creates a real PTY on both macOS and Linux. A detached child
    // retains its terminal output fds but has no controlling terminal, so
    // /dev/tty exists yet cannot be opened — the installer's fallback case.
    const launcher = join(testDir, "piped-install.cjs");
    writeFileSync(
      launcher,
      `const { spawnSync } = require("node:child_process");
const result = spawnSync("bash", ["-c",
  'cat "$SENTRY_TEST_INSTALL_SCRIPT" | bash -s -- --version 0.31.0${redirect}'
], { stdio: "inherit", detached: ${detached} });
process.exitCode = result.status ?? 1;
`
    );
    const scriptArgs =
      process.platform === "darwin"
        ? ["-q", "/dev/null", process.execPath, launcher]
        : [
            "-q",
            "-e",
            "-c",
            '"$SENTRY_TEST_NODE" "$SENTRY_TEST_LAUNCHER"',
            "/dev/null",
          ];
    const result = spawnSync("script", scriptArgs, {
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH ?? ""}`,
        SENTRY_TEST_ARGS_FILE: argsFile,
        SENTRY_TEST_TTY_FILE: ttyFile,
        SENTRY_TEST_INSTALL_SCRIPT: installScript,
        SENTRY_TEST_NODE: process.execPath,
        SENTRY_TEST_LAUNCHER: launcher,
        TMPDIR: testDir,
      },
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
      timeout: 10_000,
    });

    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(readFileSync(ttyFile, "utf8").trim().split("\n")).toEqual(expected);
  });
});
