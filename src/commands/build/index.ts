import { buildRouteMap } from "@stricli/core";
import { uploadCommand } from "./upload.js";

export const buildCommandRoute = buildRouteMap({
	routes: {
		upload: uploadCommand,
	},
	docs: {
		brief: "Manage builds",
		fullDescription:
			"Manage builds on Sentry.\n\n" +
			"Commands:\n" +
			"  upload  Upload build artifacts",
		hideRoute: {},
	},
});
