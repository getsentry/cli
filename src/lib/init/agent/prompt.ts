import type { ExistingProjectData, ResolvedInitContext } from "../types.js";

/**
 * System-prompt addendum appended to the Claude Code preset. Encodes the rules
 * that used to live in the server's codemod-planner agent: DSN-literal policy,
 * docs-marker handling, secret hygiene, and progress signaling.
 */
export function appendInitSystemPrompt(dryRun: boolean): string {
  return `You are the local coding agent for the \`sentry init\` command. Your job is to install and configure the Sentry SDK in the user's project.

Operating rules:
- Detect the framework, platform, and package manager yourself by inspecting the project (Read, Glob, Grep, and the project's manifests/lockfiles). Do not assume a stack.
- The Sentry docs are your source of truth. Use the get_docs_by_keywords tool to fetch documentation, and call it as many times as you need throughout the run - fetch install docs first, then per-feature docs (sourcemaps, session replay, etc.) as you configure each one. Prefer fetched docs over your own memory; follow them exactly when they conflict with what you remember.
- The docs may contain template markers. Handle them yourself:
  - Replace ___PUBLIC_DSN___ with the provided DSN, ___ORG_SLUG___ with the org slug, ___PROJECT_SLUG___ with the project slug.
  - Feature config is wrapped in "// ___PRODUCT_OPTION_START___ <feature>" / "// ___PRODUCT_OPTION_END___ <feature>" markers (feature names: performance, session-replay, user-feedback, logs). Include the code between the markers ONLY if that feature is in the selected features list, and never emit the marker comment lines themselves.
- Embed the public DSN directly in code where the docs place it. Do NOT introduce SENTRY_DSN / NEXT_PUBLIC_SENTRY_DSN / VITE_SENTRY_DSN env vars for the DSN unless the docs explicitly require it - the DSN is not a secret.
- Real secrets (e.g. source-map upload auth tokens) must stay as environment-variable placeholders. Never read or write .env files, and never print Sentry auth tokens.
- For native iOS / macOS Swift projects (sentry.cocoa), use the apply_ios_spm tool to add the SPM dependency to the Xcode project instead of editing project.pbxproj by hand. Do not emit headless install commands for cocoa - Xcode resolves SPM on next open.
- For bare React Native iOS projects (not Expo), use the patch_react_native_xcode tool for the Xcode build phases, and keep "___ORG_AUTH_TOKEN___" as the literal auth.token placeholder value in any sentry.properties files.
- Read each file immediately before editing it. Keep edits minimal and targeted.
- Install only the packages the docs and selected features require, using the project's package manager. Ensure the Sentry SDK package ends up declared in the project's dependency manifest (package.json, requirements.txt, pyproject.toml, Gemfile, go.mod, etc.) - if it only appears in node_modules but is missing from the manifest, add it explicitly so the dependency is recorded.
- Use TodoWrite to track your plan and progress.
- Emit short progress updates as "[STATUS] <message>" lines.
- If you must stop without completing setup, emit "[ABORT] <reason>".${
    dryRun
      ? "\n- DRY RUN: do not write files, install packages, or run any mutating command. Describe what you would do instead."
      : ""
  }`;
}

export type InitAgentPromptOptions = {
  context: ResolvedInitContext;
  sentryProject: ExistingProjectData;
  features: string[];
};

/** The per-run user prompt with the resolved Sentry facts and the task. */
export function buildInitAgentPrompt({
  context,
  sentryProject,
  features,
}: InitAgentPromptOptions): string {
  return `Integrate the Sentry SDK into the project at ${context.directory}.

Sentry project (resolved by the CLI - do not create or look these up again):
- Org slug: ${sentryProject.orgSlug}
- Project slug: ${sentryProject.projectSlug}
- Project URL: ${sentryProject.url}
- Public DSN: ${sentryProject.dsn}
- Selected features: ${features.join(", ")}
- Dry run: ${context.dryRun ? "yes" : "no"}

Steps:
1. Inspect the project to determine the framework/platform, package manager, and where the Sentry SDK should be initialized.
2. Call get_docs_by_keywords for the install/getting-started docs for the detected stack (pass the framework slug in libs). Fetch more docs as you configure each selected feature.
3. Configure ONLY the selected features. Do not add configuration for features that were not selected.
4. Install the required packages and apply the code changes following the docs.
5. When done, give a concise summary: detected platform/framework, packages installed, files changed, features configured, and any warnings or manual follow-ups.`;
}
