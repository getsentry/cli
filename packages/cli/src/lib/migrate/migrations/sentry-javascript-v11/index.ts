/**
 * The Sentry JavaScript SDK 10.x → 11.x migration.
 */

import { defineMigration } from "../../framework.js";
import { detectJavascriptV11, wantsFile } from "./detect.js";
import { guide } from "./guide.js";
import { astroRuntimeOptions } from "./tasks/astro.js";
import {
  browserUserTiming,
  browserWebVitalOptions,
  consoleBreadcrumbs,
  trackFetchStreamPerformance,
} from "./tasks/browser-integrations.js";
import {
  cloudflareInstrumentD1,
  cloudflarePrototypeMethods,
} from "./tasks/cloudflare.js";
import { dataCollection } from "./tasks/data-collection.js";
import { environmentChecks } from "./tasks/environment.js";
import { eventFiltersRename } from "./tasks/event-filters.js";
import {
  aiExportsMoved,
  nodeCoreMerged,
  sentryTypesRemoved,
} from "./tasks/imports.js";
import {
  enableLogsRemoved,
  enableMetricsRemoved,
  ignoreTransactionsRemoved,
} from "./tasks/init-options.js";
import { judgmentChecks } from "./tasks/judgment-checks.js";
import {
  cloudflareNodejsCompatSubpath,
  cloudflareWrapRequestHandler,
  instrumentStateGraphRename,
  sveltekitVitePlugin,
} from "./tasks/module-moves.js";
import { optionDetectors, removedExports } from "./tasks/needs-judgment.js";
import { nextjsRemovedOptions } from "./tasks/nextjs.js";
import { nodeLoaderEntryPoints } from "./tasks/node-entry-points.js";
import { enableOpenTelemetrySetup } from "./tasks/opentelemetry-setup.js";
import { sentryDependencies, versionFloors } from "./tasks/package-json.js";
import {
  buildReport,
  CHECKLIST_FILE,
  GENERATED_MARKER,
  writeMigrationReport,
} from "./tasks/report.js";
import { requireToImport } from "./tasks/run-commands.js";
import { sourceMapsOptionsHoist } from "./tasks/source-maps.js";

export const sentryJavascriptV11 = defineMigration({
  id: "sentry-javascript-v11",
  description: "JavaScript SDK 10.x → 11.x",
  requires: "a package.json declaring an @sentry/* package on the 10.x line",
  changelog: guide(),

  detect: detectJavascriptV11,
  workspace: { wants: wantsFile },

  collect: ({ tasks }) => {
    // Prerequisites: without these the project will not install or build,
    // so they run first and their diff is the one to read.
    tasks.add(sentryDependencies, { prerequisite: true });
    tasks.add(versionFloors, { prerequisite: true });

    // Package moves before symbol rules, so a redirected import is already in
    // its new home when a rule keyed on that package looks for it.
    tasks.add(sentryTypesRemoved, { prerequisite: false });
    tasks.add(nodeCoreMerged, { prerequisite: false });
    tasks.add(aiExportsMoved, { prerequisite: false });

    tasks.add(eventFiltersRename, { prerequisite: false });
    tasks.add(enableLogsRemoved, { prerequisite: false });
    tasks.add(enableMetricsRemoved, { prerequisite: false });
    tasks.add(ignoreTransactionsRemoved, { prerequisite: false });
    tasks.add(sourceMapsOptionsHoist, { prerequisite: false });
    tasks.add(nextjsRemovedOptions, { prerequisite: false });
    tasks.add(requireToImport, { prerequisite: false });
    tasks.add(nodeLoaderEntryPoints, { prerequisite: false });

    // Entry-point and symbol moves.
    tasks.add(cloudflareNodejsCompatSubpath, { prerequisite: false });
    tasks.add(cloudflareWrapRequestHandler, { prerequisite: false });
    tasks.add(sveltekitVitePlugin, { prerequisite: false });
    tasks.add(instrumentStateGraphRename, { prerequisite: false });

    // Removed integration options.
    tasks.add(browserUserTiming, { prerequisite: false });
    tasks.add(trackFetchStreamPerformance, { prerequisite: false });
    tasks.add(browserWebVitalOptions, { prerequisite: false });
    tasks.add(consoleBreadcrumbs, { prerequisite: false });

    // Cloudflare, and the OpenTelemetry setup flag.
    tasks.add(cloudflareInstrumentD1, { prerequisite: false });
    tasks.add(cloudflarePrototypeMethods, { prerequisite: false });
    tasks.add(enableOpenTelemetrySetup, { prerequisite: false });
    tasks.add(dataCollection, { prerequisite: false });
    tasks.add(astroRuntimeOptions, { prerequisite: false });

    // Detector-only: these never fix anything, they turn "check whether this
    // applies to you" into a file and a line number.
    for (const detector of optionDetectors) {
      tasks.add(detector, { prerequisite: false });
    }
    tasks.add(removedExports, { prerequisite: false });

    // Checks: broader than the detectors and less certain, for changes that
    // live outside anything this migration can parse.
    for (const check of [...judgmentChecks, ...environmentChecks]) {
      tasks.add(check, { prerequisite: false });
    }

    // Last, so the report sees every finding the tasks above produced.
    tasks.add(writeMigrationReport, { prerequisite: false });
  },

  report: {
    file: CHECKLIST_FILE,
    marker: GENERATED_MARKER,
    taskId: writeMigrationReport.id,
    build: ({ findings, tasks }) => buildReport(findings, tasks),
  },
});
