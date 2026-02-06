/**
 * sentry build upload
 *
 * Upload build artifacts to Sentry.
 * Wraps: sentry-cli build upload
 */

import { buildCommand } from "@stricli/core";
import type { SentryContext } from "../../context.js";
import { runSentryCli } from "../../lib/sentry-cli-runner.js";

export const uploadCommand = buildCommand({
	docs: {
		brief: "Upload build artifacts",
		fullDescription:
			"Upload build artifacts to Sentry.\n\n" +
			"Wraps: sentry-cli build upload\n\n" +
			"Note: This command is restricted to Sentry SaaS.\n\n" +
			"Examples:\n" +
			"  sentry build upload",
	},
	parameters: {
		flags: {},
		positional: {
			kind: "array",
			parameter: {
				brief: "Arguments to pass to sentry-cli",
				parse: String,
				placeholder: "args",
			},
		},
	},
	async func(this: SentryContext, _flags: Record<string, never>, ...args: string[]): Promise<void> {
		await runSentryCli(["build", "upload", ...args]);
	},
});
