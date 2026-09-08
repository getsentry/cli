/**
 * The workspace, and the API injected into every migration task.
 *
 * Tasks never touch the filesystem. The workspace is read into memory once,
 * tasks mutate it through `TaskApi`, and the runner diffs the result against
 * the originals to produce the change set. That buys:
 *
 * - `--dry-run` and a real run take the same code path, differing only in
 *   whether the diff is written. A dry run that takes a different path lies.
 * - Tasks are testable as "files in, files out", with no temp directories.
 * - A task that throws cannot leave a half-migrated tree on disk, because
 *   nothing is on disk yet.
 *
 * Everything a task can do to a project goes through this object, which is
 * what makes "a task never touches the filesystem" enforceable rather than a
 * convention every task has to remember.
 */

import type { File } from "@babel/types";
import picomatch from "picomatch";
import { lineAt, parseSource } from "./ast.js";
import { applyEdits } from "./edits.js";
import type { Edit, Finding, RawFinding } from "./types.js";

/** Every extension `script()` will attempt to parse. */
export const SCRIPT_GLOB = "**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}";

export type FileFilter = {
  include: string | string[];
  exclude?: string | string[];
  /** Cheap pre-filter, so a task only pays for files it could possibly change. */
  where?: (content: string, file: string) => boolean;
};

export type Workspace = {
  cwd: string;
  /** Repo-relative POSIX path → current content. */
  files: Map<string, string>;
  /** Content as read, for diffing. */
  original: Map<string, string>;
  /** Parsed `package.json`, or `null` when the project has none. */
  pkg: Record<string, unknown> | null;
  /**
   * The manifest as it was read, before any task touched it.
   *
   * A prerequisite task rewrites dependency ranges, so by the time a later
   * task reads `pkg`, every project looks migrated. Asking whether the project
   * arrived on the target major already has to happen against this copy.
   */
  originalPkg: Record<string, unknown> | null;
  pkgIndent: string | number;
  pkgDirty: boolean;
};

const FIRST_INDENT = /\n([ \t]+)"/;

function detectIndent(source: string): string | number {
  const match = FIRST_INDENT.exec(source);
  const found = match?.[1];
  if (!found) {
    return 2;
  }
  return found.includes("\t") ? "\t" : found.length;
}

export function createWorkspace(
  cwd: string,
  files: Map<string, string>
): Workspace {
  const manifest = files.get("package.json");
  let pkg: Record<string, unknown> | null = null;

  if (manifest) {
    try {
      const parsed: unknown = JSON.parse(manifest);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        pkg = parsed as Record<string, unknown>;
      }
    } catch {
      // A malformed manifest is the user's problem to fix, not ours to guess
      // at. Every other surface still runs.
      pkg = null;
    }
  }

  return {
    cwd,
    files,
    original: new Map(files),
    pkg,
    originalPkg: pkg ? structuredClone(pkg) : null,
    pkgIndent: manifest ? detectIndent(manifest) : 2,
    pkgDirty: false,
  };
}

/** Serialise a mutated `package.json` back into the file map. */
export function finalizeWorkspace(workspace: Workspace): void {
  if (!(workspace.pkgDirty && workspace.pkg)) {
    return;
  }
  const previous = workspace.original.get("package.json") ?? "";
  const trailing = previous.endsWith("\n") ? "\n" : "";
  workspace.files.set(
    "package.json",
    JSON.stringify(workspace.pkg, null, workspace.pkgIndent) + trailing
  );
}

export type ScriptContext = { file: string; source: string; ast: File };

export type Location = { file: string; line: number };

/**
 * Everything a task can do to a project.
 *
 * Named for its holder, not its ecosystem, though it is not yet neutral of
 * one. `files`, `file`, `fixed` and `manual` would serve any language. `pkg`,
 * `originalPkg`, `manifest`, `dependency`, `renameDependency` and `script` are
 * npm and JavaScript to the core. A second ecosystem splits this type along
 * that line, since a Python migration wants `pyproject.toml` and its own
 * parser. Worth knowing before writing one, rather than during.
 */
export type TaskApi = {
  /** Parsed `package.json`, or `null`. Read-only. `dependency()` writes. */
  readonly pkg: Record<string, unknown> | null;

  /**
   * The manifest as it was read, before any task ran. See `Workspace`.
   *
   * Read this rather than `pkg` to ask what the project declared on arrival.
   * The dependency task runs first and rewrites those ranges.
   */
  readonly originalPkg: Record<string, unknown> | null;

  /**
   * Visit files matching a filter. Return new content to replace the file, or
   * `false` to leave it alone.
   */
  files(
    filter: FileFilter,
    visit: (content: string, file: string) => string | false
  ): void;

  /** Visit one file by path. `visit` is not called when the file is absent. */
  file(path: string, visit: (content: string) => string | false): void;

  /**
   * Visit every parseable script, applying returned edits.
   *
   * Files that fail to parse are skipped rather than reported. A migration
   * walks whatever the user has, which routinely includes Flow, Vue SFCs
   * renamed to `.ts`, and build output.
   */
  script(visit: (context: ScriptContext) => Edit[]): void;

  /**
   * Set a dependency range across whichever section declares it, or remove it
   * with `null`. Returns whether anything actually changed, so a task can
   * avoid reporting a fix it did not make.
   *
   * A name no section declares is not added. `dependency()` only moves what
   * the project already has. Use `renameDependency()` to swap one package for
   * another.
   */
  dependency(name: string, range: string | null): boolean;

  /**
   * Replace a declared dependency with a differently-named one, in place.
   *
   * A package renamed upstream has to be removed and added, and the two halves
   * cannot be separate `dependency()` calls. The second would find no section
   * declaring the new name, do nothing, and leave the project with neither
   * package. Keeping the key in its original position also holds the manifest
   * diff to one line.
   */
  renameDependency(from: string, to: string, range: string): boolean;

  /**
   * Mutate `package.json` directly, for fields `dependency()` does not cover
   * such as `engines` and `scripts`. Return `true` when something changed, so
   * that the manifest is re-serialised, and shows up in the diff, only when it
   * needs to be.
   */
  manifest(mutate: (pkg: Record<string, unknown>) => boolean): void;

  /** Record an automated change. */
  fixed(message: string, at: Location): void;

  /** Record something a human or agent has to finish. */
  manual(message: string, at: Location): void;
};

const DEPENDENCY_SECTIONS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
] as const;

function compileMatcher(filter: FileFilter): (file: string) => boolean {
  const include = picomatch(filter.include);
  const exclude = filter.exclude ? picomatch(filter.exclude) : null;
  return (file) => include(file) && !exclude?.(file);
}

/** Every dependency section of a manifest that is actually an object. */
function* dependencySections(
  pkg: Record<string, unknown>
): Generator<Record<string, string>> {
  for (const section of DEPENDENCY_SECTIONS) {
    const deps = pkg[section];
    if (deps && typeof deps === "object" && !Array.isArray(deps)) {
      yield deps as Record<string, string>;
    }
  }
}

/** Apply a range to every section that already declares `name`. */
function setDependency(
  pkg: Record<string, unknown>,
  name: string,
  range: string | null
): boolean {
  let changed = false;

  for (const entries of dependencySections(pkg)) {
    if (!(name in entries)) {
      continue;
    }
    if (range === null) {
      delete entries[name];
    } else if (entries[name] === range) {
      continue;
    } else {
      entries[name] = range;
    }
    changed = true;
  }

  return changed;
}

/**
 * Swap one dependency name for another, keeping its position in the section.
 *
 * The section object is rebuilt rather than mutated because deleting and
 * re-adding a key would move it to the end, turning a one-line manifest diff
 * into a reshuffle of the whole block.
 */
function renameDependency(
  pkg: Record<string, unknown>,
  from: string,
  to: string,
  range: string
): boolean {
  let changed = false;

  for (const section of DEPENDENCY_SECTIONS) {
    const deps = pkg[section];
    if (!deps || typeof deps !== "object" || Array.isArray(deps)) {
      continue;
    }
    const entries = deps as Record<string, string>;
    if (!(from in entries)) {
      continue;
    }

    pkg[section] = Object.fromEntries(
      Object.entries(entries).flatMap(([name, declared]) => {
        if (name === from) {
          return [[to, range] as const];
        }
        // A manifest that already declares the replacement keeps one copy.
        return name === to ? [] : [[name, declared] as const];
      })
    );
    changed = true;
  }

  return changed;
}

export type TaskIdentity = {
  id: string;
};

export function createApi(
  workspace: Workspace,
  task: TaskIdentity,
  findings: Finding[]
): TaskApi {
  const record = (kind: RawFinding["kind"], message: string, at: Location) => {
    findings.push({
      taskId: task.id,
      kind,
      file: at.file,
      line: at.line,
      message,
    });
  };

  const writeFile = (path: string, content: string) => {
    workspace.files.set(path, content);
  };

  /** Visit one script and apply what it asks for. Throws on a conflict. */
  const visitScript = (
    file: string,
    content: string,
    visit: (context: ScriptContext) => Edit[]
  ) => {
    const ast = parseSource(file, content);
    if (!ast) {
      return;
    }
    const edits = visit({ file, source: content, ast });
    if (edits.length > 0) {
      workspace.files.set(file, applyEdits(content, edits));
    }
  };

  /**
   * Visit every script, containing failure to the file that caused it.
   *
   * A file whose edits turn out to conflict must not take the rest of the
   * workspace down with it. The remaining files are unrelated and their
   * migration is still correct.
   *
   * Findings are recorded while visiting, before `applyEdits` has validated
   * anything, so a file that fails has to give its findings back. Reporting
   * "moved 2 imports" for a file that was never written is worse than
   * reporting nothing, because the summary is all most users read.
   *
   * Failures are re-thrown together at the end, so the runner still records
   * the task as errored rather than swallowing a bug.
   */
  const runScript = (visit: (context: ScriptContext) => Edit[]) => {
    const matches = compileMatcher({ include: SCRIPT_GLOB });
    const failures: string[] = [];

    for (const [file, content] of workspace.files) {
      if (!matches(file)) {
        continue;
      }

      const recorded = findings.length;
      try {
        visitScript(file, content, visit);
      } catch (error) {
        findings.length = recorded;
        failures.push(
          `${file}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    if (failures.length > 0) {
      throw new Error(
        `${failures.length} file(s) could not be migrated: ${failures.join("; ")}`
      );
    }
  };

  return {
    get pkg() {
      return workspace.pkg;
    },

    get originalPkg() {
      return workspace.originalPkg;
    },

    files(filter, visit) {
      const matches = compileMatcher(filter);
      for (const [file, content] of workspace.files) {
        if (!matches(file)) {
          continue;
        }
        if (filter.where && !filter.where(content, file)) {
          continue;
        }
        const updated = visit(content, file);
        if (typeof updated === "string" && updated !== content) {
          writeFile(file, updated);
        }
      }
    },

    file(path, visit) {
      const content = workspace.files.get(path);
      if (content === undefined) {
        return;
      }
      const updated = visit(content);
      if (typeof updated === "string" && updated !== content) {
        writeFile(path, updated);
      }
    },

    script: runScript,

    dependency(name, range) {
      if (!workspace.pkg) {
        return false;
      }
      const changed = setDependency(workspace.pkg, name, range);
      if (changed) {
        workspace.pkgDirty = true;
      }
      return changed;
    },

    renameDependency(from, to, range) {
      if (!workspace.pkg) {
        return false;
      }
      const changed = renameDependency(workspace.pkg, from, to, range);
      if (changed) {
        workspace.pkgDirty = true;
      }
      return changed;
    },

    manifest(mutate) {
      const pkg = workspace.pkg;
      if (!pkg) {
        return;
      }
      if (mutate(pkg) === true) {
        workspace.pkgDirty = true;
      }
    },

    fixed(message, at) {
      record("fixed", message, at);
    },

    manual(message, at) {
      record("manual", message, at);
    },
  };
}

/** A node's 1-indexed line, as a `Location`. */
export function locate(
  file: string,
  source: string,
  node: { start?: number | null }
): Location {
  return { file, line: lineAt(source, node.start ?? 0) };
}
