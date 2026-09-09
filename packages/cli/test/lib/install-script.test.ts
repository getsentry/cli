/**
 * Install Script Tests
 *
 * Exercises the shell installer with fake download tools so source selection,
 * argument parsing, and setup delegation can be validated without network access.
 */

import { spawn } from "node:child_process";
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
import { UPGRADE_SOURCES } from "../../src/lib/binary.js";

type InstallerResult = {
  exitCode: number;
  stderr: string;
  stdout: string;
};

function noop(): void {
  // Intentionally empty — absorbs async spawn errors
}

const repoRoot = join(import.meta.dirname, "..", "..");
const installScript = join(repoRoot, "install");

describe("install script", () => {
  let testDir: string;
  let binDir: string;
  let argsFile: string;
  let requestsFile: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "sentry-install-test-"));
    binDir = join(testDir, "bin");
    argsFile = join(testDir, "setup-args.txt");
    requestsFile = join(testDir, "requests.txt");
    mkdirSync(binDir, { recursive: true });

    const fakeCurl = `#!/usr/bin/env bash
set -u

url=""
output=""
write_format=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    -o)
      output="$2"
      shift 2
      ;;
    -w)
      write_format="$2"
      shift 2
      ;;
    -H|-d|--max-time)
      shift 2
      ;;
    http://*|https://*)
      url="$1"
      shift
      ;;
    *)
      shift
      ;;
  esac
done

printf '%s\n' "$url" >> "$SENTRY_TEST_REQUESTS_FILE"

status=200
body=""
redirect_url=""
case "$url" in
  https://api.github.com/repos/getsentry/toolkit/releases\\?per_page=100)
    case "$SENTRY_TEST_SCENARIO" in
      fallback|gzip-fallback) status=404 ;;
      forbidden) status=403 ;;
      network) exit 7 ;;
      *) body='[{"tag_name":"mcp@9.0.0"},{"tag_name":"cli@0.51.0-dev.1","prerelease":true},{"tag_name":"cli@0.50.0"}]' ;;
    esac
    ;;
  https://api.github.com/repos/getsentry/cli/releases/latest)
    body='{"tag_name":"0.49.0"}'
    ;;
  https://api.github.com/repos/getsentry/toolkit/releases/tags/cli%40*)
    case "$SENTRY_TEST_SCENARIO" in
      fallback|gzip-fallback) status=404 ;;
      forbidden) status=429 ;;
      network) exit 6 ;;
      *) body='{"tag_name":"cli@0.31.0"}' ;;
    esac
    ;;
  https://api.github.com/repos/getsentry/cli/releases/tags/*)
    body='{"tag_name":"0.31.0"}'
    ;;
  https://api.github.com/repos/getsentry/toolkit)
    if [[ "$SENTRY_TEST_SCENARIO" == "nightly-fallback" ]]; then
      status=404
    else
      body='{"full_name":"getsentry/toolkit"}'
    fi
    ;;
  https://api.github.com/repos/getsentry/cli)
    body='{"full_name":"getsentry/cli"}'
    ;;
  https://ghcr.io/token*)
    body='{"token":"test-token"}'
    ;;
  https://ghcr.io/v2/*/manifests/nightly)
    if [[ "$SENTRY_TEST_SCENARIO" == "nightly-manifest-fallback" && "$url" == *getsentry/toolkit* ]]; then
      status=404
    elif [[ "$SENTRY_TEST_SCENARIO" == "nightly-manifest-forbidden" && "$url" == *getsentry/toolkit* ]]; then
      status=403
    else
      body='{"annotations":{"version":"0.51.0-dev.1"},"layers":[{"digest":"sha256:x64","annotations":{"org.opencontainers.image.title":"sentry-linux-x64.gz"}},{"digest":"sha256:arm64","annotations":{"org.opencontainers.image.title":"sentry-linux-arm64.gz"}}]}'
    fi
    ;;
  https://ghcr.io/v2/*/blobs/*)
    redirect_url='https://blob.example.test/sentry.gz'
    ;;
  https://blob.example.test/sentry.gz)
    body='#!/usr/bin/env bash
for arg in "$@"; do echo "$arg"; done > "$SENTRY_TEST_ARGS_FILE"'
    ;;
  https://github.com/*/releases/download/*.gz)
    if [[ "$SENTRY_TEST_SCENARIO" == "gzip-fallback" ]]; then
      exit 22
    fi
    body='#!/usr/bin/env bash
for arg in "$@"; do echo "$arg"; done > "$SENTRY_TEST_ARGS_FILE"'
    ;;
  https://github.com/*/releases/download/*)
    body='#!/usr/bin/env bash
for arg in "$@"; do echo "$arg"; done > "$SENTRY_TEST_ARGS_FILE"'
    ;;
  *)
    status=404
    ;;
esac

if [[ -n "$output" && "$output" != "/dev/null" ]]; then
  printf '%s\n' "$body" > "$output"
elif [[ -z "$output" ]]; then
  printf '%s\n' "$body"
fi

if [[ -n "$write_format" ]]; then
  case "$write_format" in
    '%{http_code}') printf '%s' "$status" ;;
    *'%{redirect_url}'*) printf '\n%s' "$redirect_url" ;;
  esac
fi
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

  async function runInstaller(
    args: readonly string[],
    scenario: string
  ): Promise<InstallerResult> {
    const proc = spawn("bash", [installScript, ...args], {
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH ?? ""}`,
        SENTRY_CLI_NO_TELEMETRY: "1",
        SENTRY_TEST_ARGS_FILE: argsFile,
        SENTRY_TEST_REQUESTS_FILE: requestsFile,
        SENTRY_TEST_SCENARIO: scenario,
        TMPDIR: testDir,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    proc.on("error", noop);

    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (data: Buffer) => {
      stdout += data;
    });
    proc.stderr.on("data", (data: Buffer) => {
      stderr += data;
    });

    const exitCode = await new Promise<number>((resolve) =>
      proc.on("close", (code) => resolve(code ?? 1))
    );
    return { exitCode, stderr, stdout };
  }

  function requests(): string[] {
    return readFileSync(requestsFile, "utf8").trim().split("\n");
  }

  function setupArgs(): string[] {
    return readFileSync(argsFile, "utf8").trim().split("\n");
  }

  test("uses the primary source for the latest stable CLI release", async () => {
    const result = await runInstaller([], "primary");

    expect(result).toMatchObject({ exitCode: 0 });
    expect(requests()).toEqual([
      "https://api.github.com/repos/getsentry/toolkit/releases?per_page=100",
      "https://github.com/getsentry/toolkit/releases/download/cli@0.50.0/sentry-linux-x64.gz",
    ]);
  });

  test("filters Toolkit's latest releases by the CLI tag prefix", async () => {
    const result = await runInstaller([], "latest-prefix");

    expect(result).toMatchObject({ exitCode: 0 });
    expect(requests()[1]).toContain("/cli@0.50.0/");
    expect(requests()[1]).not.toContain("/mcp@9.0.0/");
    expect(requests()[1]).not.toContain("/cli@0.51.0-dev.1/");
  });

  test("falls through to the legacy stable source only after a 404", async () => {
    const result = await runInstaller([], "fallback");

    expect(result).toMatchObject({ exitCode: 0 });
    expect(requests()).toEqual([
      "https://api.github.com/repos/getsentry/toolkit/releases?per_page=100",
      "https://api.github.com/repos/getsentry/cli/releases/latest",
      "https://github.com/getsentry/cli/releases/download/0.49.0/sentry-linux-x64.gz",
    ]);
  });

  test("stops source selection on a non-404 response", async () => {
    const result = await runInstaller([], "forbidden");

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("HTTP 403");
    expect(requests()).toEqual([
      "https://api.github.com/repos/getsentry/toolkit/releases?per_page=100",
    ]);
  });

  test("stops source selection on a network failure", async () => {
    const result = await runInstaller([], "network");

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Failed to connect to GitHub");
    expect(requests()).toEqual([
      "https://api.github.com/repos/getsentry/toolkit/releases?per_page=100",
    ]);
  });

  test("probes and downloads a pinned stable release from the same source", async () => {
    const result = await runInstaller(["--version", "v0.31.0"], "pinned");

    expect(result).toMatchObject({ exitCode: 0 });
    expect(requests()).toEqual([
      "https://api.github.com/repos/getsentry/toolkit/releases/tags/cli%400.31.0",
      "https://github.com/getsentry/toolkit/releases/download/cli@0.31.0/sentry-linux-x64.gz",
    ]);
  });

  test("selects a nightly source before requesting source-specific GHCR data", async () => {
    const result = await runInstaller(
      ["--version", "nightly"],
      "nightly-fallback"
    );

    expect(result).toMatchObject({ exitCode: 0 });
    expect(requests()).toEqual([
      "https://api.github.com/repos/getsentry/toolkit",
      "https://api.github.com/repos/getsentry/cli",
      "https://ghcr.io/token?scope=repository:getsentry/cli:pull",
      "https://ghcr.io/v2/getsentry/cli/manifests/nightly",
      "https://ghcr.io/v2/getsentry/cli/blobs/sha256:x64",
      "https://blob.example.test/sentry.gz",
    ]);
    expect(setupArgs()).toContain("nightly");
  });

  test("falls back when Toolkit's nightly manifest returns 404", async () => {
    const result = await runInstaller(
      ["--version", "nightly"],
      "nightly-manifest-fallback"
    );

    expect(result).toMatchObject({ exitCode: 0 });
    expect(requests()).toContain(
      "https://ghcr.io/v2/getsentry/toolkit/manifests/nightly"
    );
    expect(requests()).toContain(
      "https://ghcr.io/v2/getsentry/cli/manifests/nightly"
    );
  });

  test("stops when Toolkit's nightly manifest returns a non-404", async () => {
    const result = await runInstaller(
      ["--version", "nightly"],
      "nightly-manifest-forbidden"
    );

    expect(result.exitCode).toBe(1);
    expect(requests()).not.toContain(
      "https://api.github.com/repos/getsentry/cli"
    );
  });

  test("falls back from gzip to the raw asset without changing sources", async () => {
    const result = await runInstaller(["--version", "0.31.0"], "gzip-fallback");

    expect(result).toMatchObject({ exitCode: 0 });
    expect(requests()).toEqual([
      "https://api.github.com/repos/getsentry/toolkit/releases/tags/cli%400.31.0",
      "https://api.github.com/repos/getsentry/cli/releases/tags/0.31.0",
      "https://github.com/getsentry/cli/releases/download/0.31.0/sentry-linux-x64.gz",
      "https://github.com/getsentry/cli/releases/download/0.31.0/sentry-linux-x64",
    ]);
  });

  test("passes setup options through to sentry cli setup", async () => {
    const result = await runInstaller(
      [
        "--version",
        "0.31.0",
        "--no-modify-path",
        "--no-completions",
        "--no-agent-skills",
      ],
      "pinned"
    );

    expect(result).toMatchObject({ exitCode: 0 });
    expect(setupArgs()).toEqual([
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

  test("embeds the shared ordered upgrade source list", () => {
    const script = readFileSync(installScript, "utf8");
    const match = script.match(/^UPGRADE_SOURCES=\(([^)]*)\)$/m);
    const sources = Array.from(match?.[1]?.matchAll(/'([^']*)'/g) ?? []).map(
      (entry) => entry[1]
    );

    expect(sources).toEqual(
      UPGRADE_SOURCES.map(
        (source) =>
          `${source.githubRepo}|${source.ghcrRepo}|${source.tagPrefix}`
      )
    );
  });
});
