import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { getUserAgent } from "../constants.js";

const TARBALL_URL =
  "https://api.github.com/repos/getsentry/sentry-agent-skills/tarball/main";
const FETCH_TIMEOUT_MS = 10_000;

/**
 * Fetches the getsentry/sentry-agent-skills repository from GitHub as a tarball,
 * extracts it to a temp directory, and returns the paths of all skill directories
 * (those containing a SKILL.md file).
 *
 * Always fetches fresh — no caching. Returns an empty array on any failure
 * (network error, rate limit, timeout, extraction failure) and prints a warning
 * to stderr. Never throws.
 *
 * The temp directory is cleaned up when the process exits.
 */
export async function fetchSentrySkills(stderr: {
  write(s: string): void;
}): Promise<string[]> {
  let tempDir: string;

  try {
    tempDir = mkdtempSync(path.join(os.tmpdir(), "sentry-agent-skills-"));
  } catch (err) {
    stderr.write(
      `[setup] Warning: failed to create temp directory for skills: ${err}\n`
    );
    return [];
  }

  // Register cleanup handlers so the temp dir is removed even on signal
  const cleanup = () => rmSync(tempDir, { recursive: true, force: true });
  process.on("exit", cleanup);
  process.on("SIGINT", () => {
    cleanup();
    process.exit(130);
  });
  process.on("SIGTERM", () => {
    cleanup();
    process.exit(143);
  });

  // Download the tarball
  let tarballBytes: ArrayBuffer;
  try {
    const response = await fetch(TARBALL_URL, {
      headers: {
        "User-Agent": getUserAgent(),
        Accept: "application/vnd.github+json",
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!response.ok) {
      stderr.write(
        `[setup] Warning: failed to fetch sentry-agent-skills (HTTP ${response.status}). Skipping skills.\n`
      );
      return [];
    }

    tarballBytes = await response.arrayBuffer();
  } catch (err) {
    stderr.write(
      `[setup] Warning: failed to fetch sentry-agent-skills: ${err}. Skipping skills.\n`
    );
    return [];
  }

  // Write tarball to temp file and extract it
  const tarballPath = path.join(tempDir, "skills.tar.gz");

  try {
    await Bun.write(tarballPath, tarballBytes);

    const proc = Bun.spawn(["tar", "xzf", tarballPath, "-C", tempDir], {
      stderr: "pipe",
    });
    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      const errText = await new Response(proc.stderr).text();
      stderr.write(
        `[setup] Warning: failed to extract sentry-agent-skills tarball (exit ${exitCode}): ${errText}. Skipping skills.\n`
      );
      return [];
    }
  } catch (err) {
    stderr.write(
      `[setup] Warning: failed to extract sentry-agent-skills: ${err}. Skipping skills.\n`
    );
    return [];
  }

  // Find the extracted top-level directory (e.g. getsentry-sentry-agent-skills-<sha>/)
  // and locate all skill directories under skills/ that contain SKILL.md
  try {
    const glob = new Bun.Glob("*/skills/*/SKILL.md");
    const skillFiles: string[] = [];

    for await (const match of glob.scan({ cwd: tempDir, absolute: true })) {
      skillFiles.push(path.dirname(match));
    }

    return skillFiles;
  } catch (err) {
    stderr.write(
      `[setup] Warning: failed to enumerate sentry-agent-skills: ${err}. Skipping skills.\n`
    );
    return [];
  }
}
