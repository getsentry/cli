/**
 * Whether the v11 migration applies to a project, and what it declared on
 * arrival.
 *
 * This is the whole of this migration's inference, and it answers two
 * questions. Is this a JavaScript project on the v10 line, and was it already
 * on v11 before we touched it. Neither guesses at what the project does: no
 * framework, no feature set. What each task applies to is the task's own
 * business, decided by parsing the code it knows how to change.
 */

import path from "node:path";
import { JS_EXTENSIONS } from "../../ast.js";
import type { MigrationFit, ProjectProbe } from "../../framework.js";

/**
 * `@sentry/*` packages released on their own cadence, not the SDK version line.
 *
 * `@sentry/cli` is the only one left, since v11 ships against Sentry CLI v4.
 * The bundler plugins were here until they started shipping alongside the SDK
 * in v10.
 *
 * Shared with the `package-json` task deliberately: this set decides whether a
 * project is already on the v11 line, and that one decides what gets bumped
 * onto it. A package excluded from one but not the other would let a project
 * report itself migrated while a task still had work to do on it.
 */
export const NOT_SDK_VERSIONED = new Set(["@sentry/cli"]);

const SENTRY_PACKAGE = /^@sentry\//;
const LEADING_MAJOR = /(\d+)/;

/** The v10 line, which this migration upgrades *from*. */
const V10_MAJOR = 10;
/** The v11 line, which it upgrades *to*. */
const V11_MAJOR = 11;

/** Every declared dependency, across all sections, name → range. */
export function allDependencies(
  data: Record<string, unknown>
): Map<string, string> {
  const declared = new Map<string, string>();
  for (const key of [
    "dependencies",
    "devDependencies",
    "peerDependencies",
    "optionalDependencies",
  ]) {
    const value = data[key];
    if (value && typeof value === "object" && !Array.isArray(value)) {
      for (const [name, range] of Object.entries(value)) {
        declared.set(name, typeof range === "string" ? range : "");
      }
    }
  }
  return declared;
}

/**
 * Whether every SDK-versioned `@sentry/*` package already declares v11 or
 * later. A project with no SDK package at all is not "already migrated".
 *
 * Read against the manifest as it arrived, never against the migrated one: the
 * dependency task runs first and rewrites those ranges, after which every
 * project looks migrated. Tasks use this to stay quiet on a project that has
 * nothing left to do, rather than re-reporting the same environment advice on
 * every run.
 */
export function isAlreadyOnV11(pkg: Record<string, unknown> | null): boolean {
  if (!pkg) {
    return false;
  }

  let seen = false;
  for (const [name, range] of allDependencies(pkg)) {
    if (!SENTRY_PACKAGE.test(name) || NOT_SDK_VERSIONED.has(name)) {
      continue;
    }
    seen = true;
    const major = LEADING_MAJOR.exec(range)?.[1];
    // An unparseable range (`workspace:*`, `latest`, a git URL) says nothing,
    // so it cannot be evidence that the project is done.
    if (major === undefined || Number(major) < V11_MAJOR) {
      return false;
    }
  }

  return seen;
}

/**
 * The lowest major any SDK-versioned `@sentry/*` package clearly declares.
 *
 * Used to refuse a project that has not reached v10 yet. Skipping a major is
 * not a smaller version of migrating. The v11 tasks would rewrite v9-era code
 * against v11 expectations, bump the manifest two lines at once, and exit 0.
 * That is a failure that reads as success, on a diff that looks authoritative.
 *
 * A range this cannot read (`workspace:*`, `latest`, a git URL) is skipped
 * rather than treated as old. It is not evidence of a pre-v10 project, and
 * refusing on it would block monorepos that are on v10 perfectly well.
 */
function lowestSdkMajor(
  declared: Map<string, string>
): { name: string; range: string; major: number } | null {
  let lowest: { name: string; range: string; major: number } | null = null;

  for (const [name, range] of declared) {
    if (!SENTRY_PACKAGE.test(name) || NOT_SDK_VERSIONED.has(name)) {
      continue;
    }
    const major = LEADING_MAJOR.exec(range)?.[1];
    if (major === undefined) {
      continue;
    }
    const value = Number(major);
    if (!lowest || value < lowest.major) {
      lowest = { name, range, major: value };
    }
  }

  return lowest;
}

/**
 * Where to send someone who is not on v10 yet.
 *
 * The per-major guides are named `vN-to-vN+1` back to v6; below that the
 * naming breaks down, so the index is the honest answer rather than a
 * constructed URL that 404s.
 */
function upgradePathFor(major: number): string {
  return major >= 6
    ? `https://docs.sentry.io/platforms/javascript/migration/v${major}-to-v${major + 1}/`
    : "https://docs.sentry.io/platforms/javascript/migration/";
}

/**
 * Non-script files worth reading, by basename.
 *
 * Deliberately broader than what any task rewrites, because the check tasks
 * look at manifests, Wrangler config, templates and CI too. Keep the template
 * extensions in step with the `include` globs those tasks declare: a file type
 * a task looks for but this never reads is a task that can never fire.
 */
const EXTRA_FILES =
  /^(package\.json|deno\.jsonc?|Dockerfile[\w.-]*|Procfile|wrangler\.(toml|json|jsonc)|.*\.(ya?ml|html|htm|ejs|hbs|liquid|njk|tf|env|sh))$/;

const CI_DIRECTORIES = [".github/", ".circleci/", ".gitlab"];

const YAML = /\.ya?ml$/;

const SCRIPTS = new Set<string>(JS_EXTENSIONS);

export function isScript(relativePath: string): boolean {
  return SCRIPTS.has(path.extname(relativePath).toLowerCase());
}

/** Whether a repo-relative path is worth reading into the workspace. */
export function wantsFile(relativePath: string): boolean {
  if (isScript(relativePath)) {
    return true;
  }
  const base = path.posix.basename(relativePath);
  if (!EXTRA_FILES.test(base)) {
    return false;
  }
  // YAML is everywhere and mostly none of our business; only CI YAML is.
  if (YAML.test(base)) {
    return CI_DIRECTORIES.some((directory) =>
      relativePath.startsWith(directory)
    );
  }
  return true;
}

/**
 * Whether this is a JavaScript project the v11 migration can run against.
 *
 * The three answers are deliberately distinct. No `package.json` means this is
 * not a JavaScript project at all, and saying so would be noise in a Python
 * repo. Some other migration may recognise it, and if none does, the command
 * says so once rather than once per migration. A `package.json` with no
 * Sentry in it *is* this migration's ecosystem, so the more useful answer is
 * that there is nothing to migrate yet.
 */
export async function detectJavascriptV11(
  probe: ProjectProbe
): Promise<MigrationFit> {
  const pkg = await probe.json("package.json");
  if (!pkg) {
    return { fit: "no" };
  }

  const declared = allDependencies(pkg);
  const sentry = [...declared.keys()].filter((name) =>
    SENTRY_PACKAGE.test(name)
  );

  if (sentry.length === 0) {
    return {
      fit: "blocked",
      because:
        "no @sentry/* package found in package.json, so there is nothing to migrate",
      hint:
        "Point at the right project with --cwd <path>, or run `sentry init` " +
        "to set Sentry up first.",
    };
  }

  const lowest = lowestSdkMajor(declared);
  if (lowest && lowest.major < V10_MAJOR) {
    return {
      fit: "blocked",
      because: `\`${lowest.name}\` is declared at \`${lowest.range}\`, and this migration upgrades 10.x to 11.x`,
      hint:
        `Migrate to ${lowest.major + 1}.x first, one major at a time: ` +
        `${upgradePathFor(lowest.major)}. Re-run \`sentry migrate\` once the ` +
        "project is on 10.x.",
    };
  }

  return {
    fit: "yes",
    because: `package.json declares ${sentry.slice(0, 3).join(", ")}${
      sentry.length > 3 ? ` and ${sentry.length - 3} more` : ""
    }`,
  };
}
