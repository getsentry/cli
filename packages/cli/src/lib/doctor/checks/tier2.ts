// src/lib/doctor/checks/tier2.ts
/**
 * Tier 2: ecosystems, not platforms.
 *
 * Collect broadly, judge narrowly. An unrecognized key is captured and left
 * alone; only the handful of keys with an unambiguous correct answer are
 * judged here. Everything subtler is tier 3's problem.
 */

import { INIT_MARKERS } from "../markers.js";
import type { Capture, CapturedBlock, Check, CheckResult } from "../types.js";

/** Kinds produced by `autoInit` marker rules — config, not a code call. */
const AUTO_INIT_KINDS = new Set(
  INIT_MARKERS.filter((rule) => rule.autoInit).map((rule) => rule.kind)
);

/** Ecosystems that use a bundler/build plugin to upload symbolication data. */
const UPLOAD_EXPECTING_ECOSYSTEMS = new Set([
  "javascript",
  "java",
  "apple",
  "dart",
]);

function initSites(capture: Capture) {
  return capture.initSites.filter((b) => !AUTO_INIT_KINDS.has(b.kind));
}

function autoInitSites(capture: Capture) {
  return capture.initSites.filter((b) => AUTO_INIT_KINDS.has(b.kind));
}

const initPresent: Check = {
  id: "init.present",
  run: ({ capture }) => {
    if (capture.ecosystems.length === 0) {
      return {
        id: "init.present",
        status: "skip",
        detail:
          "No recognized ecosystem in this directory, so there is nothing to look for.",
      };
    }

    const explicit = initSites(capture);
    const auto = autoInitSites(capture);

    if (explicit.length > 0) {
      return {
        id: "init.present",
        status: "pass",
        detail: `Sentry is initialized in ${explicit.length} place(s).`,
        evidence: explicit.map((b) => ({ file: b.file, line: b.line })),
      };
    }
    // Android, Spring, .NET appsettings, and Laravel initialize from config.
    // Demanding a code call here is exactly the false-positive class this
    // design exists to avoid.
    if (auto.length > 0) {
      return {
        id: "init.present",
        status: "pass",
        detail: "Sentry is configured through this platform's manifest.",
        evidence: auto.map((b) => ({ file: b.file, line: b.line })),
      };
    }
    if (capture.incomplete) {
      return {
        id: "init.present",
        status: "skip",
        detail: `Search was incomplete, so a missing init call cannot be confirmed: ${capture.incomplete}`,
      };
    }
    return {
      id: "init.present",
      status: "fail",
      detail: "No Sentry initialization found in this project.",
      remediation:
        "Add a Sentry init call that runs before the rest of your application. `sentry init` will place it correctly for your framework.",
    };
  },
};

const androidDoubleInit: Check = {
  id: "android.double_init",
  run: ({ capture }) => {
    const manifests = capture.initSites.filter(
      (b) => b.kind === "android-manifest"
    );
    const code = capture.initSites.filter((b) => !AUTO_INIT_KINDS.has(b.kind));
    if (manifests.length === 0 || code.length === 0) {
      return {
        id: "android.double_init",
        status: "skip",
        detail:
          "No Android manifest alongside a code init, so auto-init cannot double-fire.",
      };
    }

    const flags = manifests.map((b) => b.keys["auto-init"]);
    if (flags.some((k) => k && !k.dynamic && k.value === "false")) {
      return {
        id: "android.double_init",
        status: "pass",
        detail:
          "`io.sentry.auto-init` is false, so the code init is the only one.",
        evidence: [...manifests, ...code].map((b) => ({
          file: b.file,
          line: b.line,
        })),
      };
    }
    if (flags.some((k) => k?.dynamic)) {
      return {
        id: "android.double_init",
        status: "skip",
        detail:
          "`auto-init` is set from a runtime expression; whether it is false could not be read.",
      };
    }

    return {
      id: "android.double_init",
      status: "warn",
      detail:
        "SentryAndroid.init runs in code while Android auto-init is still on, so Sentry initializes twice.",
      evidence: [...manifests, ...code].map((b) => ({
        file: b.file,
        line: b.line,
      })),
      remediation:
        "Set `io.sentry.auto-init` to `false` in AndroidManifest.xml when you call SentryAndroid.init yourself.",
    };
  },
};

const configDsnSet: Check = {
  id: "config.dsn_set",
  run: ({ capture }) => {
    const sites = capture.initSites;
    if (sites.length === 0) {
      return {
        id: "config.dsn_set",
        status: "skip",
        detail: "No init site captured, so its options could not be read.",
      };
    }

    const withDsn = sites.filter((b) => "dsn" in b.keys);
    if (withDsn.length === 0) {
      return {
        id: "config.dsn_set",
        status: "fail",
        detail: "The Sentry init call does not set a DSN.",
        evidence: sites.map((b) => ({ file: b.file, line: b.line })),
        remediation:
          "Pass `dsn` to your Sentry init call, or set SENTRY_DSN in the environment the app runs in.",
      };
    }

    // `dynamic: true` means the value is an expression we refused to evaluate.
    // That is a configured DSN, just not a readable one — reporting it as
    // absent would be the single most common false positive available.
    const allDynamic = withDsn.every((b) => b.keys.dsn?.dynamic);
    return {
      id: "config.dsn_set",
      status: "pass",
      detail: allDynamic
        ? "DSN is set from a runtime expression; its value could not be read statically."
        : "DSN is set in the init call.",
      evidence: withDsn.map((b) => ({ file: b.file, line: b.line })),
    };
  },
};

const configEnvironment: Check = {
  id: "config.environment",
  run: ({ capture }) => {
    const sites = capture.initSites;
    if (sites.length === 0) {
      return {
        id: "config.environment",
        status: "skip",
        detail: "No init site captured, so its options could not be read.",
      };
    }
    const set = sites.some((b) => "environment" in b.keys);
    return set
      ? {
          id: "config.environment",
          status: "pass",
          detail: "`environment` is set.",
        }
      : {
          id: "config.environment",
          status: "warn",
          detail:
            "`environment` is not set, so local and production events land together.",
          evidence: sites.map((b) => ({ file: b.file, line: b.line })),
          remediation:
            "Set `environment` in your Sentry init call, driven by your deployment environment rather than hardcoded.",
        };
  },
};

const configDebug: Check = {
  id: "config.debug",
  run: ({ capture }) => {
    const noisy = capture.initSites.filter(
      (b) => b.keys.debug?.dynamic === false && b.keys.debug.value === "true"
    );
    if (noisy.length === 0) {
      return {
        id: "config.debug",
        status: "pass",
        detail: "`debug` is not unconditionally enabled.",
      };
    }
    return {
      id: "config.debug",
      status: "warn",
      detail: "`debug` is enabled unconditionally.",
      evidence: noisy.map((b) => ({ file: b.file, line: b.line })),
      remediation:
        "Gate `debug` behind a development check rather than enabling it in every build — it logs on every event in production.",
    };
  },
};

/** Error `sampleRate` / `sample_rate` / `sample-rate` — 1.0 is the default. */
function isSampleRateKey(name: string): boolean {
  const n = name.replace(/[-_]/g, "").toLowerCase();
  // Replay on-error rate is meant to be 1.0.
  if (n.includes("onerror")) {
    return false;
  }
  return n.includes("sample") && n.endsWith("rate") && n !== "samplerate";
}

function judgeSampleRate(
  site: CapturedBlock,
  key: string,
  rate: number
): CheckResult | null {
  if (rate === 0) {
    return {
      id: "config.sample_rate",
      status: "warn",
      detail: `${key} is 0, so nothing is sent.`,
      evidence: [{ file: site.file, line: site.line }],
      remediation: `Raise ${key} above 0, or remove it if you do not want this signal.`,
    };
  }
  if (rate === 1) {
    return {
      id: "config.sample_rate",
      status: "warn",
      detail: `${key} is 1.0, which samples everything — fine in development, expensive in production.`,
      evidence: [{ file: site.file, line: site.line }],
      remediation: `Lower ${key} for production builds, or drive it from your environment.`,
    };
  }
  return null;
}

const configSampleRate: Check = {
  id: "config.sample_rate",
  run: ({ capture }) => {
    const results: CheckResult[] = [];

    for (const site of capture.initSites) {
      for (const [key, entry] of Object.entries(site.keys)) {
        if (
          !(isSampleRateKey(key) && entry) ||
          entry.dynamic ||
          entry.value === undefined
        ) {
          continue;
        }
        const rate = Number(entry.value);
        if (Number.isNaN(rate)) {
          continue;
        }
        const result = judgeSampleRate(site, key, rate);
        if (result) {
          results.push(result);
        }
      }
    }

    return results.length > 0
      ? results
      : {
          id: "config.sample_rate",
          status: "pass",
          detail: "No sampling option is set to an extreme value.",
        };
  },
};

const buildUploadConfigured: Check = {
  id: "build.upload_configured",
  run: ({ capture }) => {
    const relevant = capture.ecosystems.filter((e) =>
      UPLOAD_EXPECTING_ECOSYSTEMS.has(e)
    );
    if (relevant.length === 0) {
      return {
        id: "build.upload_configured",
        status: "skip",
        detail:
          "This ecosystem does not need uploaded symbolication data, or was not recognized.",
      };
    }
    if (capture.buildConfigs.length > 0) {
      return {
        id: "build.upload_configured",
        status: "pass",
        detail: "Build-time upload is configured.",
        evidence: capture.buildConfigs.map((b) => ({
          file: b.file,
          line: b.line,
        })),
      };
    }
    return {
      id: "build.upload_configured",
      status: "warn",
      detail: `No source-map or debug-file upload configuration found for ${relevant.join(", ")}.`,
      remediation:
        "Add the Sentry build plugin for your bundler (or `autoUploadProguardMapping` for Android, `sentry_upload_dsym` for Apple) so production stack traces are readable.",
    };
  },
};

const captureComplete: Check = {
  id: "capture.complete",
  run: ({ capture }) =>
    capture.incomplete
      ? {
          id: "capture.complete",
          status: "warn",
          detail: `Project search was incomplete: ${capture.incomplete}`,
          remediation:
            "Re-run from a narrower directory if findings look wrong — some files were not read.",
        }
      : {
          id: "capture.complete",
          status: "pass",
          detail: "Project search completed.",
        },
};

export const TIER2_CHECKS: readonly Check[] = [
  initPresent,
  androidDoubleInit,
  configDsnSet,
  configEnvironment,
  configDebug,
  configSampleRate,
  buildUploadConfigured,
  captureComplete,
];
