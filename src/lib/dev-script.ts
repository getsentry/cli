/** Auto-detect the project's development server command from filesystem markers. */

import { join } from "node:path";
import { logger } from "./logger.js";

export type DetectedCommand = {
  /** The command args to pass to Bun.spawn. */
  args: string[];
  /** Human label for what was detected (e.g., "package.json scripts.dev"). */
  source: string;
};

/** Ordered list of npm script names to look for in package.json. */
const SCRIPT_PRIORITY = ["dev", "develop", "serve", "start"] as const;

/** Whitespace splitter — hoisted to avoid recreating on every call. */
const WHITESPACE_RE = /\s+/;

/**
 * Matches script values that use shell features (env-var assignments,
 * variable expansion, operators, redirects) which cannot be tokenized
 * by simple whitespace splitting and must be run via `sh -c`.
 */
const SHELL_FEATURES_RE = /^[A-Za-z_]+=\S|&&|\|\||[|><;$]/;

/**
 * Detect the project's dev command by inspecting filesystem markers in priority order.
 *
 * Detection priority:
 * 1. package.json scripts (dev > develop > serve > start)
 * 2. manage.py (Django)
 * 3. app.py (Python)
 * 4. main.py (Python)
 * 5. go.mod (Go)
 * 6. docker-compose.yml / compose.yml (Docker Compose)
 *
 * @param cwd - The project root directory to scan
 * @returns The detected command, or null if nothing was found
 */
export async function detectDevCommand(
  cwd: string
): Promise<DetectedCommand | null> {
  const result =
    (await tryPackageJson(cwd)) ??
    (await tryPythonFile(cwd, "manage.py", [
      "python",
      "manage.py",
      "runserver",
    ])) ??
    (await tryPythonFile(cwd, "app.py", ["python", "app.py"])) ??
    (await tryPythonFile(cwd, "main.py", ["python", "main.py"])) ??
    (await tryGoMod(cwd)) ??
    (await tryDockerCompose(cwd));
  return result;
}

/** Try to detect a dev command from package.json scripts. */
async function tryPackageJson(cwd: string): Promise<DetectedCommand | null> {
  try {
    const pkgPath = join(cwd, "package.json");
    if (!(await Bun.file(pkgPath).exists())) {
      return null;
    }
    const pkg = (await Bun.file(pkgPath).json()) as {
      scripts?: Record<string, string>;
    };
    const scripts = pkg.scripts;
    if (!scripts || typeof scripts !== "object") {
      return null;
    }
    for (const name of SCRIPT_PRIORITY) {
      const value = scripts[name];
      if (typeof value === "string" && value.trim().length > 0) {
        // Scripts with env-var prefixes, pipes, or operators need a shell
        const args = SHELL_FEATURES_RE.test(value)
          ? ["sh", "-c", value]
          : value.split(WHITESPACE_RE);
        return {
          args,
          source: `package.json scripts.${name}`,
        };
      }
    }
    return null;
  } catch (error) {
    logger.debug("Failed to read package.json for dev script detection", error);
    return null;
  }
}

/** Check if a Python entry point exists and return the matching command. */
async function tryPythonFile(
  cwd: string,
  filename: string,
  args: string[]
): Promise<DetectedCommand | null> {
  try {
    if (await Bun.file(join(cwd, filename)).exists()) {
      return { args, source: filename };
    }
    return null;
  } catch (error) {
    logger.debug(`Failed to check ${filename}`, error);
    return null;
  }
}

/** Check for go.mod and return `go run .` */
async function tryGoMod(cwd: string): Promise<DetectedCommand | null> {
  try {
    if (await Bun.file(join(cwd, "go.mod")).exists()) {
      return { args: ["go", "run", "."], source: "go.mod" };
    }
    return null;
  } catch (error) {
    logger.debug("Failed to check go.mod", error);
    return null;
  }
}

/** Check for docker-compose.yml or compose.yml. */
async function tryDockerCompose(cwd: string): Promise<DetectedCommand | null> {
  try {
    for (const filename of ["docker-compose.yml", "compose.yml"]) {
      if (await Bun.file(join(cwd, filename)).exists()) {
        return { args: ["docker", "compose", "up"], source: filename };
      }
    }
    return null;
  } catch (error) {
    logger.debug("Failed to check docker-compose files", error);
    return null;
  }
}
