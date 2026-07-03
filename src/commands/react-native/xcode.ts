/**
 * sentry react-native xcode
 *
 * Upload React Native sourcemaps from an Xcode build phase. Runs in three modes:
 *
 *  - **debug** — a non-release build with no packager fetch: just run the RN
 *    build script and exit.
 *  - **fetch** — a simulator build with `--allow-fetch`: download the bundle +
 *    sourcemap from the running packager, then upload.
 *  - **wrap** — a release build: run the RN build script with this CLI standing
 *    in for `NODE_BINARY`/`HERMES_CLI_PATH` (see `wrap-call.ts`), read back the
 *    produced bundle + sourcemap from a JSON report, then upload.
 *
 * Mirrors the legacy `sentry-cli react-native xcode`.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import type { SentryContext } from "../../context.js";
import type { ArtifactFile } from "../../lib/api/sourcemaps.js";
import { uploadSourcemaps } from "../../lib/api/sourcemaps.js";
import { buildCommand } from "../../lib/command.js";
import { ContextError, ValidationError } from "../../lib/errors.js";
import { mdKvTable, renderMarkdown } from "../../lib/formatters/markdown.js";
import { CommandOutput } from "../../lib/formatters/output.js";
import { logger } from "../../lib/logger.js";
import type { SourceMapReport } from "../../lib/react-native/wrap-call.js";
import {
  findHermesc,
  findNode,
  resolveReleaseAndDist,
} from "../../lib/react-native/xcode-env.js";
import { resolveOrgAndProject } from "../../lib/resolve-target.js";
import { injectDebugId } from "../../lib/sourcemap/debug-id.js";

const log = logger.withTag("react-native.xcode");

const USAGE_HINT = "sentry react-native xcode";
const DEFAULT_PACKAGER_URL = "http://127.0.0.1:8081/";
const DEFAULT_BUILD_SCRIPT =
  "../node_modules/react-native/scripts/react-native-xcode.sh";

/** Matches one or more trailing slashes. */
const TRAILING_SLASHES = /\/+$/;

/** Flags accepted by `react-native xcode`. */
type XcodeFlags = {
  force?: boolean;
  "allow-fetch"?: boolean;
  "fetch-from"?: string;
  "build-script"?: string;
  dist?: string[];
  wait?: boolean;
  "wait-for"?: number;
  "no-auto-release"?: boolean;
};

/** Structured result for the xcode command. */
type XcodeResult = {
  mode: "debug" | "fetch" | "wrap";
  bundle?: string;
  sourcemap?: string;
  debugId?: string;
  release?: string;
  dist?: string[];
  uploads: number;
};

/** A resolved bundle + sourcemap pair to upload. */
type BundlePair = { bundle: string; sourcemap: string };

function formatResult(data: XcodeResult): string {
  const rows: [string, string][] = [["Mode", data.mode]];
  if (data.bundle) {
    rows.push(["Bundle", data.bundle]);
  }
  if (data.sourcemap) {
    rows.push(["Sourcemap", data.sourcemap]);
  }
  if (data.debugId) {
    rows.push(["Debug ID", data.debugId]);
  }
  if (data.release) {
    rows.push(["Release", data.release]);
  }
  if (data.dist && data.dist.length > 0) {
    rows.push(["Distributions", data.dist.join(", ")]);
  }
  return renderMarkdown(mdKvTable(rows));
}

/** Whether the build script should be wrapped (release build or forced). */
function shouldWrap(flags: XcodeFlags, env: NodeJS.ProcessEnv): boolean {
  if (flags.force) {
    return true;
  }
  const configuration = env.CONFIGURATION;
  if (configuration === undefined) {
    throw new ValidationError(
      "Need to run this from Xcode (CONFIGURATION is not set).",
      "CONFIGURATION"
    );
  }
  return !configuration.includes("Debug");
}

/** Resolve the RN build script path (canonicalized). */
function resolveScript(flags: XcodeFlags, cwd: string): string {
  const script = resolve(cwd, flags["build-script"] ?? DEFAULT_BUILD_SCRIPT);
  if (!existsSync(script)) {
    throw new ValidationError(
      `React Native build script not found: ${script}`,
      "build-script"
    );
  }
  return script;
}

/** Run the build script directly, propagating its exit status. */
function runScript(
  script: string,
  args: string[],
  env: NodeJS.ProcessEnv
): number {
  const rv = spawnSync(script, args, { stdio: "inherit", env });
  return rv.status ?? (rv.error ? 1 : 0);
}

/** Poll a URL until it responds or the timeout elapses. */
async function waitUntilAvailable(
  url: string,
  timeoutMs: number
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { method: "GET" });
      if (res.status < 500) {
        return true;
      }
    } catch (err) {
      log.debug("Packager not up yet", err);
    }
    await sleep(500);
  }
  return false;
}

/** Fetch the bundle + sourcemap from the running RN packager. */
async function fetchFromPackager(
  fetchUrl: string,
  tempDir: string
): Promise<BundlePair> {
  const url = fetchUrl.replace(TRAILING_SLASHES, "");
  if (!(await waitUntilAvailable(url, 10_000))) {
    throw new ValidationError(
      "React Native packager did not respond in time.",
      "fetch-from"
    );
  }
  const bundle = join(tempDir, "index.ios.bundle");
  const sourcemap = join(tempDir, "index.ios.map");
  const bundleRes = await fetch(
    `${url}/index.ios.bundle?platform=ios&dev=true`
  );
  writeFileSync(bundle, Buffer.from(await bundleRes.arrayBuffer()));
  const mapRes = await fetch(`${url}/index.ios.map?platform=ios&dev=true`);
  writeFileSync(sourcemap, Buffer.from(await mapRes.arrayBuffer()));
  return { bundle, sourcemap };
}

/** Run the wrapped build and read the produced bundle/sourcemap paths. */
function runWrappedBuild(
  script: string,
  scriptArgs: string[],
  ctx: SentryContext,
  tempDir: string
): { status: number; pair: BundlePair | null } {
  const reportPath = join(tempDir, "sourcemap-report.json");
  writeFileSync(reportPath, "{}");
  const node = findNode(ctx.env);
  const hermesc = findHermesc(ctx.env);
  const self = ctx.process.execPath;

  const env: NodeJS.ProcessEnv = {
    ...ctx.env,
    NODE_BINARY: self,
    SENTRY_RN_REAL_NODE_BINARY: node,
    SENTRY_RN_SOURCEMAP_REPORT: reportPath,
    __SENTRY_RN_WRAP_XCODE_CALL: "1",
  };
  if (existsSync(hermesc)) {
    env.HERMES_CLI_PATH = self;
    env.SENTRY_RN_REAL_HERMES_CLI_PATH = hermesc;
  }

  const status = runScript(script, scriptArgs, env);

  const report = JSON.parse(
    readFileSync(reportPath, "utf-8")
  ) as SourceMapReport;
  if (!(report.packager_bundle_path && report.packager_sourcemap_path)) {
    return { status, pair: null };
  }
  // Prefer the Hermes bundle + combined sourcemap when present.
  if (report.hermes_bundle_path && report.hermes_sourcemap_path) {
    log.info("Using Hermes bundle and combined source map.");
    return {
      status,
      pair: {
        bundle: report.hermes_bundle_path,
        sourcemap: report.hermes_sourcemap_path,
      },
    };
  }
  log.info("Using React Native Packager bundle and source map.");
  return {
    status,
    pair: {
      bundle: report.packager_bundle_path,
      sourcemap: report.packager_sourcemap_path,
    },
  };
}

/** Inject a debug id and upload the bundle/sourcemap pair. */
async function uploadPair(
  pair: BundlePair,
  ctx: SentryContext,
  flags: XcodeFlags
): Promise<{
  debugId: string;
  release?: string;
  dist: string[];
  uploads: number;
}> {
  const resolved = await resolveOrgAndProject({
    cwd: ctx.cwd,
    usageHint: USAGE_HINT,
  });
  if (!resolved) {
    throw new ContextError("Organization and project", USAGE_HINT);
  }
  const { org, project } = resolved;

  const { debugId } = await injectDebugId(pair.bundle, pair.sourcemap);
  const files: ArtifactFile[] = [
    {
      path: pair.bundle,
      debugId,
      type: "minified_source",
      url: `~/${basename(pair.bundle)}`,
      sourcemapFilename: basename(pair.sourcemap),
    },
    {
      path: pair.sourcemap,
      debugId,
      type: "source_map",
      url: `~/${basename(pair.sourcemap)}`,
    },
  ];

  const { release, dist } = await resolveReleaseAndDist(
    ctx.env,
    ctx.cwd,
    flags["no-auto-release"] ?? false
  );
  // Explicit --dist overrides the environment/plist-derived distribution.
  let dists: string[] = [];
  if (flags.dist && flags.dist.length > 0) {
    dists = flags.dist;
  } else if (dist) {
    dists = [dist];
  }

  let uploads = 0;
  if (dists.length > 0) {
    for (const d of dists) {
      await uploadSourcemaps({ org, project, release, dist: d, files });
      uploads += 1;
    }
  } else {
    await uploadSourcemaps({ org, project, release, files });
    uploads = 1;
  }
  return { debugId, release, dist: dists, uploads };
}

export const xcodeCommand = buildCommand({
  docs: {
    brief: "Upload React Native sourcemaps (Xcode build step)",
    fullDescription:
      "Upload React Native sourcemaps from an Xcode build phase. In a release " +
      "build the RN build script is wrapped so the produced bundle and " +
      "sourcemap are captured and uploaded; in a simulator build with " +
      "`--allow-fetch` they are fetched from the packager; in a debug build " +
      "the script simply runs.\n\n" +
      "Release/distribution come from `SENTRY_RELEASE`/`SENTRY_DIST` or the " +
      "app Info.plist (unless `--no-auto-release`). The CLI always waits for " +
      "server-side assembly; `--wait`/`--wait-for` are accepted for " +
      "compatibility.",
  },
  auth: false,
  output: {
    human: formatResult,
  },
  parameters: {
    flags: {
      force: {
        kind: "boolean",
        brief: "Run even in a debug configuration",
        optional: true,
      },
      "allow-fetch": {
        kind: "boolean",
        brief: "Fetch sourcemaps from the packager on simulator builds",
        optional: true,
      },
      "fetch-from": {
        kind: "parsed",
        parse: String,
        brief: `Packager URL to fetch from (default: ${DEFAULT_PACKAGER_URL})`,
        optional: true,
      },
      "build-script": {
        kind: "parsed",
        parse: String,
        brief: "Path to the react-native-xcode.sh build script",
        optional: true,
      },
      dist: {
        kind: "parsed",
        parse: String,
        variadic: true,
        brief: "Distribution(s) to publish (repeatable)",
        optional: true,
      },
      wait: {
        kind: "boolean",
        brief: "Accepted for compatibility (the CLI always waits for assembly)",
        optional: true,
      },
      "wait-for": {
        kind: "parsed",
        parse: Number,
        brief: "Accepted for compatibility (the CLI always waits for assembly)",
        optional: true,
      },
      "no-auto-release": {
        kind: "boolean",
        brief: "Don't read the release from Xcode project files",
        optional: true,
      },
    },
    aliases: { f: "force" },
    positional: {
      kind: "array",
      parameter: {
        placeholder: "script-arg",
        brief: "Extra arguments passed to the build script",
        parse: String,
      },
    },
  },
  async *func(this: SentryContext, flags: XcodeFlags, ...scriptArgs: string[]) {
    const wrap = shouldWrap(flags, this.env);
    const script = resolveScript(flags, this.cwd);

    const simulator = this.env.PLATFORM_NAME?.endsWith("simulator") ?? false;
    const fetchUrl =
      flags["allow-fetch"] && simulator
        ? (flags["fetch-from"] ?? DEFAULT_PACKAGER_URL)
        : undefined;

    // Debug build with no fetch: just run the script and exit.
    if (!(wrap || fetchUrl)) {
      log.info("Running in debug mode, skipping script wrapping.");
      const status = runScript(script, scriptArgs, this.env);
      if (status !== 0) {
        this.process.exitCode = status;
      }
      yield new CommandOutput<XcodeResult>({ mode: "debug", uploads: 0 });
      return { hint: "Ran the React Native build script (debug mode)." };
    }

    const tempDir = mkdtempSync(join(tmpdir(), "sentry-rn-xcode-"));
    let mode: "fetch" | "wrap";
    let pair: BundlePair | null;
    if (fetchUrl) {
      mode = "fetch";
      log.info(`Fetching sourcemaps from ${fetchUrl}`);
      pair = await fetchFromPackager(fetchUrl, tempDir);
    } else {
      mode = "wrap";
      const result = runWrappedBuild(script, scriptArgs, this, tempDir);
      if (result.status !== 0) {
        this.process.exitCode = result.status;
      }
      pair = result.pair;
      if (!pair) {
        log.warn("Build produced no packager sourcemaps.");
        yield new CommandOutput<XcodeResult>({ mode, uploads: 0 });
        return { hint: "No sourcemaps were produced by the build." };
      }
    }

    log.info("Processing React Native sourcemaps for Sentry upload.");
    const { debugId, release, dist, uploads } = await uploadPair(
      pair,
      this,
      flags
    );

    yield new CommandOutput<XcodeResult>({
      mode,
      bundle: pair.bundle,
      sourcemap: pair.sourcemap,
      debugId,
      release,
      dist: dist.length > 0 ? dist : undefined,
      uploads,
    });
    return { hint: `Uploaded sourcemaps with debug ID ${debugId}.` };
  },
});
