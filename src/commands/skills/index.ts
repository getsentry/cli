import { buildRouteMap } from "@stricli/core";
import { addCommand } from "./add.js";
import { listCommand } from "./list.js";

export const skillsRoute = buildRouteMap({
  routes: {
    list: listCommand,
    add: addCommand,
  },
  docs: {
    brief: "Manage Sentry agent skills for AI coding assistants",
    fullDescription:
      "Install and manage Sentry agent skills from getsentry/skills.\n\n" +
      "Skills provide reusable instructions for AI coding assistants like Claude Code and OpenCode.\n" +
      "Use 'sentry skills list' to see available skills and 'sentry skills add' to install them.",
  },
});
