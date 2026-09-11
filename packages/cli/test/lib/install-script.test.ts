/**
 * Exercises the shell installer with a fake downloaded executable. Real PTYs
 * verify the handoff from piped installation to interactive login or init.
 */

import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

const installScript = join(import.meta.dirname, "..", "..", "install");

describe("install script", () => {
  let testDir: string;
  let binDir: string;
  let installDir: string;
  let env: NodeJS.ProcessEnv;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "sentry-install-test-"));
    binDir = join(testDir, "bin");
    installDir = join(testDir, "installed bin");
    mkdirSync(binDir, { recursive: true });
    mkdirSync(join(testDir, "home"));
    env = {
      PATH: `${binDir}:/usr/bin:/bin:/usr/sbin:/sbin`,
      HOME: join(testDir, "home"),
      SENTRY_INSTALL_DIR: installDir,
      SENTRY_CLI_NO_TELEMETRY: "1",
      SENTRY_TEST_DIR: testDir,
      SENTRY_TEST_INSTALL_SCRIPT: installScript,
      TMPDIR: testDir,
    };

    // The artifact records each invocation and emulates setup's binary copy and
    // POSIX cleanup. Every install location and output is inside the fixture.
    writeFileSync(
      join(binDir, "curl"),
      `#!/usr/bin/env bash
cat <<'SCRIPT'
#!/usr/bin/env bash
set -euo pipefail
record_tty() {
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
}
if [[ "$1" == "cli" && "$2" == "setup" ]]; then
  printf '%s\\n' "$@" > "$SENTRY_TEST_DIR/setup-args"
  printf '%s\\n' "$0" > "$SENTRY_TEST_DIR/setup-binary"
  record_tty 3> "$SENTRY_TEST_DIR/setup-tty"
  mkdir -p "$SENTRY_INSTALL_DIR"
  cp "$0" "$SENTRY_INSTALL_DIR/sentry\${SENTRY_TEST_SUFFIX:-}"
  if [[ "\${SENTRY_TEST_SUFFIX:-}" != ".exe" ]]; then
    rm "$0"
  fi
  exit 0
fi
printf '%s\\n' "$@" >> "$SENTRY_TEST_DIR/post-args"
printf '%s\\n' "$0" >> "$SENTRY_TEST_DIR/post-binary"
record_tty 3> "$SENTRY_TEST_DIR/post-tty"
exit "\${SENTRY_TEST_POST_EXIT:-0}"
SCRIPT
`
    );
    chmodSync(join(binDir, "curl"), 0o755);
    writeFileSync(join(binDir, "gunzip"), "#!/usr/bin/env bash\ncat\n");
    chmodSync(join(binDir, "gunzip"), 0o755);
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  function recorded(name: string): string[] {
    const path = join(testDir, name);
    return existsSync(path)
      ? readFileSync(path, "utf8").trim().split("\n")
      : [];
  }

  /** Exercise Windows installer branching without executing a Windows binary. */
  function useWindowsArtifact(): void {
    env.SENTRY_TEST_SUFFIX = ".exe";
    writeFileSync(
      join(binDir, "uname"),
      '#!/bin/sh\ncase "$1" in -s) echo MSYS_NT-10.0 ;; -m) echo x86_64 ;; esac\n'
    );
    chmodSync(join(binDir, "uname"), 0o755);
  }

  /** Run curl-style piped installation in a real controlling terminal. */
  function runInTerminal(
    options: { redirect?: string; detached?: boolean } = {}
  ) {
    const launcher = join(testDir, "piped-install.cjs");
    const command =
      'cat "$SENTRY_TEST_INSTALL_SCRIPT" | bash -s -- --version 0.31.0' +
      (options.redirect ?? "");
    writeFileSync(
      launcher,
      `const { spawnSync } = require("node:child_process");
const result = spawnSync("bash", ["-c", ${JSON.stringify(command)}], {
  stdio: "inherit", detached: ${options.detached ?? false}
});
process.exitCode = result.status ?? 1;
`
    );
    // script(1) has different argument syntax on BSD and util-linux. A
    // detached shell retains its PTY output but cannot open /dev/tty.
    const args =
      process.platform === "darwin"
        ? ["-q", "/dev/null", process.execPath, launcher]
        : [
            "-q",
            "-e",
            "-c",
            '"$SENTRY_TEST_NODE" "$SENTRY_TEST_LAUNCHER"',
            "/dev/null",
          ];
    return spawnSync("script", args, {
      env: {
        ...env,
        SENTRY_TEST_NODE: process.execPath,
        SENTRY_TEST_LAUNCHER: launcher,
      },
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
      timeout: 10_000,
    });
  }

  test("passes setup flags through and skips login without a terminal", () => {
    const result = spawnSync(
      "bash",
      [
        installScript,
        "--version",
        "0.31.0",
        "--no-modify-path",
        "--no-completions",
        "--no-agent-skills",
      ],
      { env, encoding: "utf8", timeout: 10_000 }
    );
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(recorded("setup-args")).toEqual([
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
    expect(recorded("setup-tty").slice(0, 3)).toEqual([
      "0:false",
      "1:false",
      "2:false",
    ]);
    expect(recorded("post-args")).toEqual([]);
    expect(existsSync(join(installDir, "sentry"))).toBe(true);
  });

  test("keeps setup piped and launches automatic login on the controlling terminal", () => {
    const result = runInTerminal();
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(recorded("setup-tty")).toEqual([
      "0:false",
      "1:true",
      "2:true",
      "controlling:true",
    ]);
    expect(recorded("post-args")).toEqual(["auth", "login", "--automatic"]);
    expect(recorded("post-tty")).toEqual([
      "0:true",
      "1:true",
      "2:true",
      "controlling:true",
    ]);
    expect(recorded("post-binary")).toEqual([join(installDir, "sentry")]);
  });

  test.each([
    {
      name: "stdout is redirected",
      redirect: " >/dev/null",
      expected: ["0:false", "1:false", "2:true", "controlling:true"],
    },
    {
      name: "stderr is redirected",
      redirect: " 2>/dev/null",
      expected: ["0:false", "1:true", "2:false", "controlling:true"],
    },
    {
      name: "terminal output has no controlling terminal",
      detached: true,
      expected: ["0:false", "1:true", "2:true", "controlling:false"],
    },
  ])("skips login when $name", ({ redirect, detached, expected }) => {
    const result = runInTerminal({ redirect, detached });
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(recorded("setup-tty")).toEqual(expected);
    expect(recorded("post-args")).toEqual([]);
  });

  test.each([
    false,
    true,
  ])("skips login for an existing CLI (Windows: %s)", (windows) => {
    if (windows) useWindowsArtifact();
    mkdirSync(installDir);
    const target = join(installDir, windows ? "sentry.exe" : "sentry");
    writeFileSync(target, "#!/bin/sh\nexit 99\n");
    chmodSync(target, 0o755);
    const result = runInTerminal();
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(recorded("setup-args").slice(0, 2)).toEqual(["cli", "setup"]);
    expect(recorded("post-args")).toEqual([]);
    expect(readFileSync(target, "utf8")).toContain("record_tty");
  });

  test("hands off to init instead of login when SENTRY_INIT is set", () => {
    env.SENTRY_INIT = "1";
    env.SENTRY_TEST_POST_EXIT = "7";
    const result = runInTerminal();
    expect(result.status, result.stdout + result.stderr).toBe(7);
    expect(recorded("post-args")).toEqual(["init"]);
    expect(recorded("post-binary")).toEqual([join(installDir, "sentry")]);
    expect(recorded("post-tty")).toEqual([
      "0:true",
      "1:true",
      "2:true",
      "controlling:true",
    ]);
  });

  test.each([
    1, 130,
  ])("keeps install successful when login exits with %i", (exitCode) => {
    env.SENTRY_TEST_POST_EXIT = String(exitCode);
    const result = runInTerminal();
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(recorded("post-args")).toEqual(["auth", "login", "--automatic"]);
    expect(recorded("post-binary")).toHaveLength(1);
    expect(result.stdout + result.stderr).toContain(
      "Run 'sentry auth login' to authenticate later."
    );
    expect(existsSync(join(installDir, "sentry"))).toBe(true);
  });

  test("runs Windows login from the temporary binary that already ran setup", () => {
    useWindowsArtifact();
    const result = runInTerminal();
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(recorded("post-args")).toEqual(["auth", "login", "--automatic"]);
    expect(recorded("post-binary")).toEqual(recorded("setup-binary"));
    expect(recorded("post-binary")).not.toEqual([
      join(installDir, "sentry.exe"),
    ]);
    expect(existsSync(join(installDir, "sentry.exe"))).toBe(true);
  });
});
