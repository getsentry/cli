/**
 * Reading declared version ranges out of a `package.json`.
 *
 * Shared between the task that raises floors and the tasks that only report
 * one. Both answer the same question: does this range still permit something
 * below the minimum. Answering it two ways would let a project be told to
 * upgrade something the migration had already bumped.
 */

/** Dependency sections a package could plausibly appear in. */
export const DEPENDENCY_SECTIONS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
] as const;

/** The range a manifest declares for `name`, in whichever section carries it. */
export function declaredRange(
  pkg: Record<string, unknown>,
  name: string
): string | null {
  for (const section of DEPENDENCY_SECTIONS) {
    const deps = pkg[section];
    if (deps && typeof deps === "object" && !Array.isArray(deps)) {
      const declared = (deps as Record<string, string>)[name];
      if (declared) {
        return declared;
      }
    }
  }
  return null;
}

/** Leading digits of a semver range, ignoring `^`, `~`, `>=` and friends. */
const FIRST_VERSION = /(\d+)\.(\d+)\.(\d+)|(\d+)\.(\d+)|(\d+)/;

/**
 * Whether a declared range clearly permits something below `floor`.
 *
 * A range with no readable version (`workspace:*`, `latest`, a git URL) is
 * not evidence of anything, so it reads as satisfied. Reporting on it would
 * put an entry in every monorepo's checklist that nobody can act on.
 */
export function belowFloor(range: string, floor: string): boolean {
  const match = FIRST_VERSION.exec(range);
  if (!match) {
    return false;
  }
  const declared = (match[0] ?? "").split(".").map(Number);
  const wanted = floor.split(".").map(Number);

  for (const [index, want] of wanted.entries()) {
    const have = declared[index] ?? 0;
    if (have !== want) {
      return have < want;
    }
  }
  return false;
}
