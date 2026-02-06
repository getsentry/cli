import { buildRouteMap } from "@stricli/core";
import { archiveCommand } from "./archive.js";
import { deleteCommand } from "./delete.js";
import { finalizeCommand } from "./finalize.js";
import { infoCommand } from "./info.js";
import { listCommand } from "./list.js";
import { newCommand } from "./new.js";
import { proposeVersionCommand } from "./propose-version.js";
import { restoreCommand } from "./restore.js";
import { setCommitsCommand } from "./set-commits.js";

export const releasesRoute = buildRouteMap({
  routes: {
    new: newCommand,
    finalize: finalizeCommand,
    list: listCommand,
    info: infoCommand,
    delete: deleteCommand,
    archive: archiveCommand,
    restore: restoreCommand,
    "set-commits": setCommitsCommand,
    "propose-version": proposeVersionCommand,
  },
  docs: {
    brief: "Manage releases on Sentry",
    fullDescription:
      "Manage releases on Sentry.\n\n" +
      "Commands:\n" +
      "  new              Create a new release\n" +
      "  finalize         Finalize a release\n" +
      "  list             List releases\n" +
      "  info             Show release info\n" +
      "  delete           Delete a release\n" +
      "  archive          Archive a release\n" +
      "  restore          Restore an archived release\n" +
      "  set-commits      Associate commits with a release\n" +
      "  propose-version  Propose a version string",
    hideRoute: {},
  },
});
