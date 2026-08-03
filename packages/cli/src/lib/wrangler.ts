/**
 * Wrangler-specific command augmentation for Cloudflare Workers local dev.
 *
 * Process environment variables inherited by `wrangler dev` are not exposed
 * as Worker bindings. The Cloudflare Sentry SDK reads `SENTRY_SPOTLIGHT` from
 * the Worker `env` object, so `sentry local run` must pass it through
 * Wrangler's `--var` flag rather than relying on child-process inheritance.
 */

import { access, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { logger } from "./logger.js";

/** Wrangler project configuration filenames, in resolution order. */
const WRANGLER_CONFIG_FILES = [
  "wrangler.json",
  "wrangler.jsonc",
  "wrangler.toml",
] as const;

/** Package managers whose `run` subcommand forwards args after `--`. */
const PACKAGE_MANAGERS = new Set(["npm", "pnpm", "yarn", "bun"]);

/** Match `wrangler` as a shell command, optionally with a path prefix. */
const WRANGLER_SHELL_RE = /(?:^|[\s;&|])(?:[^\s;&|]*\/)?wrangler(?:\.cmd)?\s/;

/** Match Wrangler's `dev` subcommand in a shell command. */
const WRANGLER_DEV_SHELL_RE = /\bwrangler(?:\.cmd)?\s+(?:pages\s+)?dev\b/;

/** Match an existing SENTRY_SPOTLIGHT Wrangler binding. */
const SPOTLIGHT_VAR_RE = /^SENTRY_SPOTLIGHT(?::|=)/;

/** Strip Windows' executable suffix before command comparisons. */
const CMD_SUFFIX_RE = /\.cmd$/i;

/** Result of attempting to augment a command for Wrangler. */
export type WranglerCommandAugmentation = {
  /** Spawn arguments, possibly containing an injected `--var`. */
  args: string[];
  /** Whether the Worker binding was injected. */
  injected: boolean;
};

/** Return the executable's platform-independent basename. */
function executableName(value: string): string {
  return basename(value).replace(CMD_SUFFIX_RE, "").toLowerCase();
}

/** Whether args already provide an explicit SENTRY_SPOTLIGHT Wrangler var. */
function hasSpotlightVar(args: readonly string[]): boolean {
  return args.some((arg, index) => {
    if (arg.startsWith("--var=")) {
      return SPOTLIGHT_VAR_RE.test(arg.slice("--var=".length));
    }
    return args[index - 1] === "--var" && SPOTLIGHT_VAR_RE.test(arg);
  });
}

/** Whether a direct/wrapped command invokes `wrangler dev`. */
function isDirectWranglerDev(args: readonly string[]): boolean {
  const wranglerIndex = args.findIndex(
    (arg) => executableName(arg) === "wrangler"
  );
  if (wranglerIndex === -1) {
    return false;
  }
  const following = args.slice(wranglerIndex + 1);
  return (
    following[0] === "dev" ||
    (following[0] === "pages" && following[1] === "dev")
  );
}

/** Extract `package-manager run <script>` metadata when present. */
function packageScriptName(args: readonly string[]): string | undefined {
  if (!PACKAGE_MANAGERS.has(executableName(args[0] ?? ""))) {
    return;
  }
  const runIndex = args.indexOf("run");
  return runIndex === -1 ? undefined : args[runIndex + 1];
}

/** Read a package script without failing command startup on malformed files. */
async function readPackageScript(
  cwd: string,
  name: string
): Promise<string | undefined> {
  try {
    const raw = await readFile(join(cwd, "package.json"), "utf8");
    const pkg = JSON.parse(raw) as { scripts?: Record<string, unknown> };
    const value = pkg.scripts?.[name];
    return typeof value === "string" ? value : undefined;
  } catch (error) {
    logger.debug("Could not inspect package script for Wrangler", error);
    return;
  }
}

/** Whether the project has a Wrangler config or the command names one. */
async function hasWranglerConfig(
  cwd: string,
  args: readonly string[]
): Promise<boolean> {
  if (
    args.some(
      (arg, index) => arg === "--config" && typeof args[index + 1] === "string"
    ) ||
    args.some((arg) => arg.startsWith("--config="))
  ) {
    return true;
  }

  for (const filename of WRANGLER_CONFIG_FILES) {
    try {
      await access(join(cwd, filename));
      return true;
    } catch {
      // Try the next supported Wrangler filename.
    }
  }
  return false;
}

/**
 * Inject `SENTRY_SPOTLIGHT` as a Wrangler Worker binding when appropriate.
 *
 * Supports direct invocations (`wrangler dev`, `npx wrangler dev`),
 * auto-detected shell scripts, and explicit package-manager scripts such as
 * `npm run dev`. User-supplied `--var SENTRY_SPOTLIGHT:...` always wins.
 *
 * @param args - Child command arguments
 * @param spotlightUrl - Local envelope endpoint
 * @param cwd - Project root used to find Wrangler/package configuration
 */
export async function injectWranglerSpotlightBinding(
  args: readonly string[],
  spotlightUrl: string,
  cwd: string
): Promise<WranglerCommandAugmentation> {
  const unchanged = { args: [...args], injected: false };
  if (!(await hasWranglerConfig(cwd, args)) || hasSpotlightVar(args)) {
    return unchanged;
  }

  const binding = `SENTRY_SPOTLIGHT:${spotlightUrl}`;
  if (isDirectWranglerDev(args)) {
    return { args: [...args, "--var", binding], injected: true };
  }

  const shellIndex = args.findIndex(
    (arg, index) =>
      index > 0 &&
      ["-c", "/c"].includes(args[index - 1] ?? "") &&
      WRANGLER_SHELL_RE.test(arg) &&
      WRANGLER_DEV_SHELL_RE.test(arg)
  );
  if (shellIndex !== -1) {
    const augmented = [...args];
    augmented[shellIndex] = `${augmented[shellIndex]} --var ${binding}`;
    return { args: augmented, injected: true };
  }

  const scriptName = packageScriptName(args);
  if (!scriptName) {
    return unchanged;
  }
  const script = await readPackageScript(cwd, scriptName);
  if (!(script && WRANGLER_DEV_SHELL_RE.test(script))) {
    return unchanged;
  }

  const separator = args.includes("--") ? [] : ["--"];
  return {
    args: [...args, ...separator, "--var", binding],
    injected: true,
  };
}
