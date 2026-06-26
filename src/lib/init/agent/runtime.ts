/**
 * Resolves the native `claude` executable that the Claude Agent SDK spawns.
 *
 * The SDK's JavaScript is bundled into the CLI at build time, but its
 * per-platform native runtime (~62 MB download, ~210 MB on disk) is not — the
 * CLI ships fully bundled with zero runtime dependencies, so neither the npm
 * package nor the single binary carries it. We therefore fetch it on first
 * `init` and cache it under `~/.sentry`, then point the SDK at it via the
 * `pathToClaudeCodeExecutable` option.
 *
 * In dev (running from source with node_modules present) the SDK's own
 * platform package is used directly, so no download happens.
 */

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { customFetch } from "../../custom-ca.js";
import { WizardError } from "../../errors.js";
import { CLAUDE_AGENT_SDK_VERSION } from "../constants.js";

const execFileAsync = promisify(execFile);

const SDK_PKG = "@anthropic-ai/claude-agent-sdk";
const REGISTRY = "https://registry.npmjs.org";
const META_TIMEOUT_MS = 30_000;
const DOWNLOAD_TIMEOUT_MS = 600_000;

function detectLibc(): "glibc" | "musl" {
  if (process.platform !== "linux") {
    return "glibc";
  }
  try {
    const report = process.report?.getReport() as
      | { header?: { glibcVersionRuntime?: string } }
      | undefined;
    return report?.header?.glibcVersionRuntime ? "glibc" : "musl";
  } catch {
    return "glibc";
  }
}

/** The `@anthropic-ai/claude-agent-sdk-<key>` package key for this platform. */
function platformKey(): string | null {
  const arch = process.arch;
  if (arch !== "arm64" && arch !== "x64") {
    return null;
  }
  if (process.platform === "darwin") {
    return `darwin-${arch}`;
  }
  if (process.platform === "win32") {
    return `win32-${arch}`;
  }
  if (process.platform === "linux") {
    return detectLibc() === "musl" ? `linux-${arch}-musl` : `linux-${arch}`;
  }
  return null;
}

function executableName(): string {
  return process.platform === "win32" ? "claude.exe" : "claude";
}

/** Resolve the native binary from node_modules (dev/source runs). */
function resolveFromNodeModules(pkg: string): string | undefined {
  try {
    const require = createRequire(import.meta.url);
    return require.resolve(`${pkg}/${executableName()}`);
  } catch {
    return;
  }
}

function cacheDir(key: string): string {
  return path.join(
    homedir(),
    ".sentry",
    "agent",
    CLAUDE_AGENT_SDK_VERSION,
    key
  );
}

type TarballMeta = { tarball: string; integrity?: string };

async function fetchTarballMeta(pkg: string): Promise<TarballMeta> {
  const res = await customFetch(
    `${REGISTRY}/${pkg}/${CLAUDE_AGENT_SDK_VERSION}`,
    { signal: AbortSignal.timeout(META_TIMEOUT_MS) }
  );
  if (!res.ok) {
    throw new WizardError(
      `Could not look up the init agent runtime (${pkg}@${CLAUDE_AGENT_SDK_VERSION}): HTTP ${res.status}.`
    );
  }
  const json = (await res.json()) as {
    dist?: { tarball?: string; integrity?: string };
  };
  if (!json.dist?.tarball) {
    throw new WizardError(
      `No download URL found for ${pkg}@${CLAUDE_AGENT_SDK_VERSION}.`
    );
  }
  return { tarball: json.dist.tarball, integrity: json.dist.integrity };
}

function verifyIntegrity(buffer: Buffer, integrity: string | undefined): void {
  if (!integrity?.startsWith("sha512-")) {
    return;
  }
  const expected = integrity.slice("sha512-".length);
  const actual = createHash("sha512").update(buffer).digest("base64");
  if (actual !== expected) {
    throw new WizardError(
      "The init agent runtime download failed its integrity check. Please try again."
    );
  }
}

async function downloadAndExtract(pkg: string, dest: string): Promise<void> {
  const meta = await fetchTarballMeta(pkg);
  const res = await customFetch(meta.tarball, {
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new WizardError(
      `Failed to download the init agent runtime: HTTP ${res.status}.`
    );
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  verifyIntegrity(buffer, meta.integrity);

  const scratch = mkdtempSync(path.join(tmpdir(), "sentry-claude-dl-"));
  const tgz = path.join(scratch, "runtime.tgz");
  writeFileSync(tgz, buffer);
  mkdirSync(dest, { recursive: true });

  try {
    // npm tarballs are rooted at `package/`; strip it so the executable lands
    // directly in `dest`.
    await execFileAsync("tar", [
      "-xzf",
      tgz,
      "-C",
      dest,
      "--strip-components=1",
      `package/${executableName()}`,
    ]);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }

  const bin = path.join(dest, executableName());
  if (!existsSync(bin)) {
    throw new WizardError(
      "The init agent runtime archive did not contain the expected executable."
    );
  }
  if (process.platform !== "win32") {
    chmodSync(bin, 0o755);
  }
}

/**
 * Return the path to the native `claude` executable, downloading and caching
 * it on first use. `onDownload` fires only when a network download is needed
 * (so callers can surface a one-time progress message).
 */
export async function resolveClaudeExecutable(
  opts: { onDownload?: () => void } = {}
): Promise<string> {
  const key = platformKey();
  if (!key) {
    throw new WizardError(
      `sentry init is not supported on ${process.platform}/${process.arch}.`
    );
  }

  const pkg = `${SDK_PKG}-${key}`;
  const local = resolveFromNodeModules(pkg);
  if (local) {
    return local;
  }

  const dest = cacheDir(key);
  const cached = path.join(dest, executableName());
  if (existsSync(cached)) {
    return cached;
  }

  opts.onDownload?.();
  await downloadAndExtract(pkg, dest);
  return cached;
}
