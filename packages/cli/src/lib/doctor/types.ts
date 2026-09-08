/**
 * Shared types for `sentry doctor` and the check runner.
 *
 * Checks are pure functions over `(Capture, ServerFacts)`. That purity is what
 * makes them fixture-testable with no mocking, and what lets a check that
 * cannot determine an answer degrade to `skip` for free.
 */

import { captureException } from "@sentry/node-core/light";
import type { DetectedDsn } from "../dsn/types.js";
import { logger } from "../logger.js";

/**
 * Re-exported so doctor modules have one import site. The DSN library already
 * models everything we need — `raw`, `publicKey`, `host`, `projectId`,
 * `source`, `sourcePath` — so we do not define a competing shape.
 */
export type { DetectedDsn } from "../dsn/types.js";

/**
 * `pass` means determined-good. `skip` means could-not-determine and always
 * carries a reason. Conflating the two is the one thing this design forbids
 * outright: a silent `pass` on an undetermined check is a lie.
 */
export type CheckStatus = "pass" | "fail" | "warn" | "skip";

/** A file (and optionally line) the user can open to see what a check saw. */
export type Evidence = { file: string; line?: number };

export type CheckResult = {
  id: string;
  status: CheckStatus;
  /** Human-readable one-liner. For `skip`, this MUST explain why. */
  detail: string;
  evidence?: Evidence[];
  /** Imperative fix text, safe to hand to a coding agent verbatim. */
  remediation?: string;
};

/**
 * A captured config key. `dynamic: true` means the value is an expression we
 * refused to evaluate (`process.env.X`, a function call) — the key is present
 * but its value is unknowable statically, so checks must not assume.
 */
export type CapturedKey = { value?: string; dynamic: boolean };

/** A verbatim slice of a config file, already redacted. */
export type CapturedBlock = {
  /** e.g. `"init"`, `"gradle"`, `"webpack-plugin"`. */
  kind: string;
  file: string;
  line: number;
  text: string;
  keys: Record<string, CapturedKey>;
};

export type ParsedManifest = {
  file: string;
  /** Dependency name → declared version spec. */
  deps: Record<string, string>;
};

export type Capture = {
  cwd: string;
  ecosystems: string[];
  dsns: DetectedDsn[];
  initSites: CapturedBlock[];
  buildConfigs: CapturedBlock[];
  /** Keyed by manifest path relative to `cwd`. */
  manifests: Record<string, ParsedManifest>;
  /** Set when discovery was cut short; checks downgrade `fail` to `skip`. */
  incomplete?: string;
};

export type ProjectKeyFact = { publicKey: string; isActive: boolean };

/**
 * Everything the Sentry API told us. Every field is optional because every
 * field independently may be unavailable (offline, unauthenticated, wrong org),
 * and an absent field must produce `skip`, never `fail`.
 */
export type ServerFacts = {
  reachable: boolean;
  unreachableReason?: string;
  org?: string;
  project?: string;
  projectPlatform?: string;
  /** ISO timestamp of the project's first event, or `null` if never. */
  firstEvent?: string | null;
  /** ISO timestamp of the most recent issue's `lastSeen`, or `null` if none. */
  lastIssueSeen?: string | null;
  keys?: ProjectKeyFact[];
  dsnMatchesProject?: boolean;
  environments?: string[];
  hasUploadedArtifacts?: boolean;
  /** Newest release, or `null` when the project has none. */
  latestRelease?: { version: string; lastEvent?: string | null } | null;
};

export type CheckContext = { capture: Capture; server: ServerFacts };

export type Check = {
  id: string;
  run(ctx: CheckContext): CheckResult | CheckResult[];
};

/**
 * Run every check, isolating failures. A check that throws is a doctor bug,
 * not a user finding — it becomes a `skip` plus a telemetry report so the run
 * still produces a complete report.
 */
export function runChecks(
  registry: readonly Check[],
  ctx: CheckContext
): CheckResult[] {
  const results: CheckResult[] = [];

  for (const check of registry) {
    try {
      const produced = check.run(ctx);
      if (Array.isArray(produced)) {
        results.push(...produced);
      } else {
        results.push(produced);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.debug(`doctor: check "${check.id}" threw`, error);
      captureException(error, { tags: { "doctor.check": check.id } });
      results.push({
        id: check.id,
        status: "skip",
        detail: `Check could not run: ${message}`,
      });
    }
  }

  return results;
}
