import { buildRouteMap } from "@stricli/core";
import { listCommand } from "./list.js";
import { viewCommand } from "./view.js";

export const issueRoute = buildRouteMap({
	routes: {
		list: listCommand,
		view: viewCommand,
	},
	docs: {
		brief: "Manage Sentry issues",
		fullDescription:
			"View and manage issues from your Sentry projects. " +
			"Use 'sentry issue list' to list issues and 'sentry issue view <id>' to view issue details.",
		hideRoute: {},
	},
});
