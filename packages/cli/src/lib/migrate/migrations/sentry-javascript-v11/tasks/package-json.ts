/**
 * `package.json`: dependency moves and declared version floors.
 *
 * These edit the manifest but never install. Running a package manager mid-
 * migration means a lockfile diff burying the real change, a live resolution
 * of an alpha version that can fail, and a much harder answer to "what did
 * this tool actually do to my repo". `git checkout` has to be a complete undo.
 */

import type { TaskApi } from "../../../api.js";
import { defineMigrationTask } from "../../../framework.js";
import { isAlreadyOnV11, NOT_SDK_VERSIONED } from "../detect.js";
import { guide } from "../guide.js";
import {
  belowFloor,
  declaredRange,
  DEPENDENCY_SECTIONS as SECTIONS,
} from "../versions.js";

const SDK_RANGE = "^11.0.0";

/** Packages that no longer exist, and what replaces them. */
const REPLACEMENTS: Record<string, { with: string | null; why: string }> = {
  "@sentry/types": {
    with: null,
    why: "no longer published; types come from `@sentry/core`",
  },
  "@sentry/node-core": {
    with: null,
    why: "merged back into `@sentry/node`",
  },
  "@sentry/tanstackstart": {
    with: "@sentry/tanstackstart-react",
    why: "replaced by `@sentry/tanstackstart-react`",
  },
};

/** Every `@sentry/*` package declared anywhere in the manifest. */
function sentryPackages(pkg: Record<string, unknown>): string[] {
  const names = new Set<string>();
  for (const section of SECTIONS) {
    const deps = pkg[section];
    if (deps && typeof deps === "object" && !Array.isArray(deps)) {
      for (const name of Object.keys(deps)) {
        if (name.startsWith("@sentry/")) {
          names.add(name);
        }
      }
    }
  }
  return [...names];
}

export const sentryDependencies = defineMigrationTask({
  id: "package-json",
  description: "Move `@sentry/*` dependencies onto the v11 line",
  // Covers three package moves at once; the guide index is the honest link.
  docs: guide(),
  run: ({ api }) => {
    const pkg = api.pkg;
    if (!pkg) {
      return;
    }

    for (const name of sentryPackages(pkg)) {
      const replacement = REPLACEMENTS[name];
      if (replacement) {
        replacePackage(api, name, replacement);
        continue;
      }

      if (NOT_SDK_VERSIONED.has(name) || !belowV11(pkg, name)) {
        continue;
      }

      if (api.dependency(name, SDK_RANGE)) {
        api.fixed(`\`${name}\` → \`${SDK_RANGE}\``, {
          file: "package.json",
          line: 1,
        });
      }
    }
  },
});

/**
 * Swap out a package that no longer exists.
 *
 * A rename is one operation rather than a removal plus an addition.
 * `dependency()` only touches names a section already declares, so setting the
 * replacement separately would do nothing and leave the project with neither
 * package, while the finding claimed the swap had happened.
 */
function replacePackage(
  api: TaskApi,
  name: string,
  replacement: { with: string | null; why: string }
): void {
  const changed = replacement.with
    ? api.renameDependency(name, replacement.with, SDK_RANGE)
    : api.dependency(name, null);

  if (!changed) {
    return;
  }

  api.fixed(
    replacement.with
      ? `\`${name}\` → \`${replacement.with}\` (${replacement.why})`
      : `removed \`${name}\` (${replacement.why})`,
    { file: "package.json", line: 1 }
  );
}

const NODE_FLOOR = "20.19.0";
const TYPESCRIPT_FLOOR = "5.0.4";
const V11_FLOOR = "11.0.0";

/**
 * Whether a declared range still permits a pre-v11 SDK.
 *
 * Without this check a re-run would rewrite `^11.5.0` back down to `^11.0.0`
 * and report it as a fix. `sentry migrate` promises to be safe to run again,
 * and a tool that silently downgrades a version range on every run is not.
 */
function belowV11(pkg: Record<string, unknown>, name: string): boolean {
  const declared = declaredRange(pkg, name);
  return declared !== null && belowFloor(declared, V11_FLOOR);
}

/**
 * Raise declared version floors to what v11 requires.
 *
 * The manifest is only half of each of these. `engines.node` is a
 * declaration. The runtime that actually runs the app lives in a Dockerfile, a
 * CI image or a serverless runtime setting. So the fix is paired with a manual
 * finding naming the other half. Updating the declaration alone and reporting
 * success is the more dangerous outcome, because it reads as done.
 */
export const versionFloors = defineMigrationTask({
  id: "version-floors",
  description: "Raise declared Node and TypeScript floors to the v11 minimums",
  docs: guide("node-version"),
  run: ({ api }) => {
    const pkg = api.pkg;
    if (!pkg) {
      return;
    }

    api.manifest((manifest) => {
      const engines = manifest.engines;
      if (!engines || typeof engines !== "object" || Array.isArray(engines)) {
        return false;
      }
      const entries = engines as Record<string, string>;
      if (!(entries.node && belowFloor(entries.node, NODE_FLOOR))) {
        return false;
      }
      entries.node = `>=${NODE_FLOOR}`;
      api.fixed(`engines.node → \`>=${NODE_FLOOR}\``, {
        file: "package.json",
        line: 1,
      });
      return true;
    });

    // The runtime floor is environment advice, not a code change, so there is
    // nothing to detect it against and it would otherwise be emitted on every
    // run forever. That also keeps the report non-empty forever, so a finished
    // project could never be told it was finished. A project already on the
    // v11 line has had this advice and acted on it.
    if (!isAlreadyOnV11(api.originalPkg)) {
      api.manual(
        `Node.js ${NODE_FLOOR} is the v11 minimum. Check your Dockerfiles, CI images and serverless runtime settings, not just \`engines\`.`,
        { file: "package.json", line: 1 }
      );
    }

    for (const section of SECTIONS) {
      const deps = pkg[section];
      if (!deps || typeof deps !== "object" || Array.isArray(deps)) {
        continue;
      }
      const declared = (deps as Record<string, string>).typescript;
      if (declared && belowFloor(declared, TYPESCRIPT_FLOOR)) {
        api.dependency("typescript", `^${TYPESCRIPT_FLOOR}`);
        api.fixed(`\`typescript\` → \`^${TYPESCRIPT_FLOOR}\``, {
          file: "package.json",
          line: 1,
        });
        break;
      }
    }
  },
});
