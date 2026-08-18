/**
 * Tier 1: what the server knows, which is true regardless of platform.
 *
 * These checks read no source files, so they cover every SDK with no
 * per-platform code — and they are the only tier that can say "this has never
 * worked" with certainty.
 */

import {
  isPlaceholderNumericId,
  isPlaceholderPublicKey,
} from "../../dsn/index.js";
import type { Check, CheckContext, CheckResult } from "../types.js";

/** Days after which "no recent events" becomes worth mentioning. */
const STALE_EVENT_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Uniform skip when the server could not be consulted. */
function unreachable(id: string, ctx: CheckContext): CheckResult | null {
  if (ctx.server.reachable) {
    return null;
  }
  return {
    id,
    status: "skip",
    detail:
      ctx.server.unreachableReason ??
      "Could not reach Sentry, so this could not be determined.",
  };
}

/** Uniform skip when a specific fact was not returned. */
function missing(id: string, what: string): CheckResult {
  return {
    id,
    status: "skip",
    detail: `Sentry did not return ${what}, so this could not be determined.`,
  };
}

function daysSince(iso: string): number {
  return (Date.now() - new Date(iso).getTime()) / MS_PER_DAY;
}

const dsnPresent: Check = {
  id: "dsn.present",
  run: ({ capture }) => {
    const first = capture.dsns[0];
    if (!first) {
      return {
        id: "dsn.present",
        status: "fail",
        detail: "No DSN found anywhere in this project.",
        remediation:
          "Add your project's DSN. Run `sentry init` to configure it, or set the SENTRY_DSN environment variable.",
      };
    }
    return {
      id: "dsn.present",
      status: "pass",
      detail: `DSN found (${first.source}).`,
      evidence: first.sourcePath ? [{ file: first.sourcePath }] : undefined,
    };
  },
};

const dsnPlaceholder: Check = {
  id: "dsn.placeholder",
  run: ({ capture }) => {
    const first = capture.dsns[0];
    if (!first) {
      return {
        id: "dsn.placeholder",
        status: "skip",
        detail: "No DSN to inspect.",
      };
    }

    const bogus =
      isPlaceholderPublicKey(first.publicKey) ||
      isPlaceholderNumericId(first.projectId);

    return bogus
      ? {
          id: "dsn.placeholder",
          status: "fail",
          detail:
            "The configured DSN is the documentation example, not a real project DSN.",
          evidence: first.sourcePath ? [{ file: first.sourcePath }] : undefined,
          remediation:
            "Replace the placeholder DSN with your project's real DSN from Settings → Client Keys (DSN).",
        }
      : {
          id: "dsn.placeholder",
          status: "pass",
          detail: "DSN is not a placeholder.",
        };
  },
};

const dsnConflict: Check = {
  id: "dsn.conflict",
  run: ({ capture }) => {
    const distinct = new Set(capture.dsns.map((d) => d.raw));
    if (distinct.size <= 1) {
      return {
        id: "dsn.conflict",
        status: "pass",
        detail: "One DSN configured.",
      };
    }
    return {
      id: "dsn.conflict",
      status: "warn",
      detail: `${distinct.size} different DSNs are configured; events will be split across projects.`,
      evidence: capture.dsns.flatMap((d) =>
        d.sourcePath ? [{ file: d.sourcePath }] : []
      ),
      remediation:
        "Pick one DSN and remove the others, or confirm that each package is intentionally reporting to its own project.",
    };
  },
};

const dsnResolves: Check = {
  id: "dsn.resolves",
  run: (ctx) => {
    const skipped = unreachable("dsn.resolves", ctx);
    if (skipped) {
      return skipped;
    }
    if (ctx.server.dsnMatchesProject === false) {
      return {
        id: "dsn.resolves",
        status: "fail",
        detail:
          "The configured DSN does not match any Sentry project you can access.",
        remediation:
          "Confirm the DSN belongs to a project in an organization you are a member of, then copy it again from Settings → Client Keys (DSN).",
      };
    }
    if (ctx.server.dsnMatchesProject === undefined) {
      return missing("dsn.resolves", "a project for this DSN");
    }
    return {
      id: "dsn.resolves",
      status: "pass",
      detail: `DSN resolves to ${ctx.server.org}/${ctx.server.project}.`,
    };
  },
};

const projectFirstEvent: Check = {
  id: "project.first_event",
  run: (ctx) => {
    const skipped = unreachable("project.first_event", ctx);
    if (skipped) {
      return skipped;
    }
    const { firstEvent, org, project, projectPlatform } = ctx.server;
    if (firstEvent === undefined) {
      return missing("project.first_event", "first-event data");
    }
    if (firstEvent === null) {
      const label = projectPlatform
        ? `${projectPlatform}/${project}`
        : `${org}/${project}`;
      return {
        id: "project.first_event",
        status: "fail",
        detail: `${label} has never received an event.`,
        remediation:
          "Sentry is configured but nothing has ever arrived. Confirm the SDK is initialized before your app does any work, that initialization actually runs in the environment you are testing, and that outbound HTTPS to the ingest host is allowed. Run `sentry doctor --send-test-event` to test the path end to end.",
      };
    }
    return {
      id: "project.first_event",
      status: "pass",
      detail: `First event received ${firstEvent}.`,
    };
  },
};

const projectLastEvent: Check = {
  id: "project.last_event",
  run: (ctx) => {
    const skipped = unreachable("project.last_event", ctx);
    if (skipped) {
      return skipped;
    }
    const { lastIssueSeen } = ctx.server;
    if (lastIssueSeen === undefined) {
      return missing("project.last_event", "recent issue data");
    }
    if (lastIssueSeen === null) {
      return {
        id: "project.last_event",
        status: "skip",
        detail: "This project has no issues, so recency cannot be determined.",
      };
    }

    const age = daysSince(lastIssueSeen);
    return age > STALE_EVENT_DAYS
      ? {
          id: "project.last_event",
          status: "warn",
          detail: `The most recent event is ${Math.round(age)} days old.`,
          remediation:
            "Confirm your deployed build still initializes Sentry — a quiet project usually means the SDK stopped running, not that the errors stopped.",
        }
      : {
          id: "project.last_event",
          status: "pass",
          detail: `Most recent event ${lastIssueSeen}.`,
        };
  },
};

const projectKeyActive: Check = {
  id: "project.key_active",
  run: (ctx) => {
    const skipped = unreachable("project.key_active", ctx);
    if (skipped) {
      return skipped;
    }
    const { keys } = ctx.server;
    const dsn = ctx.capture.dsns[0];
    if (!keys) {
      return missing("project.key_active", "client keys");
    }
    if (!dsn) {
      return {
        id: "project.key_active",
        status: "skip",
        detail: "No DSN to match against the project's client keys.",
      };
    }

    const match = keys.find((k) => k.publicKey === dsn.publicKey);
    if (!match) {
      return {
        id: "project.key_active",
        status: "fail",
        detail:
          "This DSN's key is not among the project's client keys — it was deleted or belongs elsewhere.",
        remediation:
          "Copy a current DSN from Settings → Client Keys (DSN) and replace the one in your project.",
      };
    }
    return match.isActive
      ? {
          id: "project.key_active",
          status: "pass",
          detail: "DSN key is active.",
        }
      : {
          id: "project.key_active",
          status: "fail",
          detail: "This DSN's key has been deactivated; events are rejected.",
          remediation:
            "Re-enable the key in Settings → Client Keys (DSN), or switch your project to an active key.",
        };
  },
};

const projectEnvironments: Check = {
  id: "project.environments",
  run: (ctx) => {
    const skipped = unreachable("project.environments", ctx);
    if (skipped) {
      return skipped;
    }
    const { environments } = ctx.server;
    if (!environments) {
      return missing("project.environments", "environment data");
    }
    if (environments.length === 0) {
      return {
        id: "project.environments",
        status: "warn",
        detail: "No environments are recorded; every event is unattributed.",
        remediation:
          "Set `environment` in your Sentry init call (or the SENTRY_ENVIRONMENT variable) so production and local events can be told apart.",
      };
    }
    return {
      id: "project.environments",
      status: "pass",
      detail: `${environments.length} environment(s): ${environments.join(", ")}.`,
    };
  },
};

const releaseAttribution: Check = {
  id: "release.attribution",
  run: (ctx) => {
    const skipped = unreachable("release.attribution", ctx);
    if (skipped) {
      return skipped;
    }
    const { latestRelease } = ctx.server;
    if (latestRelease === undefined) {
      return missing("release.attribution", "release data");
    }
    if (latestRelease === null) {
      return {
        id: "release.attribution",
        status: "warn",
        detail: "No releases exist, so events cannot be tied to a version.",
        remediation:
          "Set `release` in your Sentry init call and create the release during your build so regressions can be attributed to a version.",
      };
    }
    if (!latestRelease.lastEvent) {
      return {
        id: "release.attribution",
        status: "warn",
        detail: `Release ${latestRelease.version} exists but no events are attributed to it.`,
        remediation:
          "Make the `release` value your SDK reports match the release you create at build time — they are usually mismatched when this happens.",
      };
    }
    return {
      id: "release.attribution",
      status: "pass",
      detail: `Events are attributed to release ${latestRelease.version}.`,
    };
  },
};

const artifactsUploaded: Check = {
  id: "artifacts.uploaded",
  run: (ctx) => {
    const skipped = unreachable("artifacts.uploaded", ctx);
    if (skipped) {
      return skipped;
    }
    const { hasUploadedArtifacts } = ctx.server;
    if (hasUploadedArtifacts === undefined) {
      return missing("artifacts.uploaded", "debug-file data");
    }
    return hasUploadedArtifacts
      ? {
          id: "artifacts.uploaded",
          status: "pass",
          detail: "Debug files have been uploaded for this project.",
        }
      : {
          id: "artifacts.uploaded",
          status: "fail",
          detail:
            "No source maps or debug files exist for this project; stack traces will stay unreadable.",
          remediation:
            "Enable upload in your build: the Sentry bundler plugin for JavaScript, `autoUploadProguardMapping` for Android, or `sentry_upload_dsym` for Apple. Then run a release build and confirm files appear under Settings → Debug Files.",
        };
  },
};

export const TIER1_CHECKS: readonly Check[] = [
  dsnPresent,
  dsnPlaceholder,
  dsnConflict,
  dsnResolves,
  projectFirstEvent,
  projectLastEvent,
  projectKeyActive,
  projectEnvironments,
  releaseAttribution,
  artifactsUploaded,
];
