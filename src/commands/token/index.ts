import { buildRouteMap } from "../../lib/route-map.js";
import { createCommand } from "./create.js";
import { deleteCommand } from "./delete.js";
import { listCommand } from "./list.js";

export const tokenRoute = buildRouteMap({
  routes: {
    create: createCommand,
    delete: deleteCommand,
    list: listCommand,
  },
  defaultCommand: "list",
  docs: {
    brief: "Manage org auth tokens",
    fullDescription:
      "Create, list, and delete organization auth tokens.\n\n" +
      "Org auth tokens are used for CI pipelines, release management,\n" +
      "and other automated workflows. They are scoped to org:ci.\n\n" +
      "Alias: `sentry tokens` → `sentry token list`",
  },
});
