import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { getCliCommand } from "../../fixture.js";
import type { Platform } from "./platforms.js";

/** Root of the CLI repo (three levels up from this file). */
const CLI_ROOT = resolve(import.meta.dir, "../../..");

export type WizardResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
  diff: string;
  newFiles: Record<string, string>;
};

/**
 * Run `sentry init --yes --force` on a project directory and capture results.
 * When `features` is provided, passes `--features <comma-separated>` to the wizard.
 */
export async function runWizard(
  projectDir: string,
  platform: Platform,
  features?: string[]
): Promise<WizardResult> {
  // Resolve relative paths (e.g. "src/bin.ts") against the CLI repo root,
  // since the wizard spawns with cwd set to the temp project directory.
  const cmd = getCliCommand().map((part) =>
    part.includes("/") ? resolve(CLI_ROOT, part) : part
  );
  const mastraUrl = process.env.MASTRA_API_URL;
  if (!mastraUrl) {
    throw new Error("MASTRA_API_URL env var is required to run init evals");
  }

  // Install dependencies first so the wizard sees a realistic project
  try {
    execSync(platform.installCmd, {
      cwd: projectDir,
      stdio: "pipe",
      timeout: 120_000,
    });
    // Commit lock files so they don't show up in the diff
    execSync("git add -A && git commit -m deps --no-gpg-sign --allow-empty", {
      cwd: projectDir,
      stdio: "pipe",
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "test",
        GIT_AUTHOR_EMAIL: "test@test.com",
        GIT_COMMITTER_NAME: "test",
        GIT_COMMITTER_EMAIL: "test@test.com",
      },
    });
  } catch {
    // Some templates (e.g. Python) might not need install
  }

  const initArgs = [...cmd, "init", "--yes", "--force"];
  if (features && features.length > 0) {
    initArgs.push("--features", features.join(","));
  }

  const proc = Bun.spawn(initArgs, {
    cwd: projectDir,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      // Override the hardcoded Mastra URL to point at local/test server
      SENTRY_WIZARD_API_URL: mastraUrl,
      // Disable telemetry
      SENTRY_CLI_NO_TELEMETRY: "1",
    },
  });

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  const exitCode = await proc.exited;

  // Capture git diff (staged + unstaged changes since last commit)
  let diff = "";
  try {
    diff = execSync("git diff HEAD", {
      cwd: projectDir,
      encoding: "utf-8",
      maxBuffer: 1024 * 1024,
    });
  } catch {
    // No diff available
  }

  // Capture new untracked files
  const newFiles: Record<string, string> = {};
  try {
    const untracked = execSync("git ls-files --others --exclude-standard", {
      cwd: projectDir,
      encoding: "utf-8",
    }).trim();

    for (const file of untracked.split("\n").filter(Boolean)) {
      try {
        newFiles[file] = readFileSync(join(projectDir, file), "utf-8");
      } catch {
        // Binary or unreadable
      }
    }
  } catch {
    // No untracked files
  }

  return { exitCode, stdout, stderr, diff, newFiles };
}
