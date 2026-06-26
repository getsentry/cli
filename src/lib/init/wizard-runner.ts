/**
 * Sentry init runner.
 *
 * Owns the local CLI flow: UI lifecycle, preamble + git safety, readiness,
 * preflight (org/project/team resolution), deterministic Sentry project
 * creation, feature selection, the local Claude Agent SDK run, and final
 * verification. Model traffic is routed through the Sentry init gateway to the
 * Vercel AI Gateway; Sentry docs are fetched locally by the agent's docs tool.
 */

import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { promisify } from "node:util";
import { captureException, setTag } from "@sentry/node-core/light";
import { formatBanner } from "../banner.js";
import { detectAgent } from "../detect-agent.js";
import { EXIT, WizardError } from "../errors.js";
import {
  appendInitSystemPrompt,
  buildInitAgentPrompt,
} from "./agent/prompt.js";
import { runInitAgent } from "./agent/runner.js";
import {
  abortIfCancelled,
  featureHint,
  featureLabel,
  sortFeatures,
  WizardCancelledError,
} from "./clack-utils.js";
import {
  EXIT_VERIFICATION_FAILED,
  REQUIRED_FEATURE,
  SENTRY_INIT_ANTHROPIC_BASE_URL,
} from "./constants.js";
import { formatError, formatResult } from "./formatters.js";
import { checkGitStatus } from "./git.js";
import { resolveInitContext } from "./preflight.js";
import { checkReadiness } from "./readiness.js";
import { createSentryProject } from "./tools/create-sentry-project.js";
import { detectSentry } from "./tools/detect-sentry.js";
import type {
  ExistingProjectData,
  ResolvedInitContext,
  WizardOptions,
  WizardOutput,
  WorkflowRunResult,
} from "./types.js";
import { getUIAsync } from "./ui/factory.js";
import { LoggingUIPromptError } from "./ui/logging-ui.js";
import type { WelcomeOptions, WizardUI } from "./ui/types.js";

const execFileAsync = promisify(execFile);

/** Optional features offered when no `--features` flag is supplied. */
const DEFAULT_OPTIONAL_FEATURES = [
  "performanceMonitoring",
  "sessionReplay",
  "logs",
  "profiling",
  "sourceMaps",
  "userFeedback",
];

function buildWelcomeOptions(): WelcomeOptions {
  return {
    title: "Sentry Init",
    body: [
      "We'll use AI to inspect this project and configure Sentry.",
      "You choose the setup before any local files change.",
    ],
    punchline: "Continue to let Sentry use AI for setup.",
  };
}

function showCancelledFeedback(ui: WizardUI): void {
  ui.cancel("Setup cancelled.");
  ui.feedback("cancelled");
}

async function confirmExperimental(
  options: WizardOptions,
  ui: WizardUI
): Promise<boolean> {
  if (options.yes || options.dryRun) {
    return true;
  }
  if (ui.welcome) {
    const choice = await ui.welcome(buildWelcomeOptions());
    return abortIfCancelled(choice) === "continue";
  }
  const choice = await ui.select<"continue" | "exit">({
    message:
      "This is experimental and will modify files in this directory. Continue?",
    options: [
      { value: "continue", label: "Yes, continue" },
      { value: "exit", label: "No, exit" },
    ],
    initialValue: "continue",
  });
  return abortIfCancelled(choice) === "continue";
}

async function preamble(
  options: WizardOptions,
  ui: WizardUI
): Promise<boolean> {
  if (!(options.yes || options.dryRun || process.stdin.isTTY)) {
    throw new WizardError(
      "Interactive mode requires a terminal. Use --yes for non-interactive mode.",
      { rendered: false }
    );
  }

  if (!detectAgent()) {
    ui.banner(formatBanner());
  }
  ui.intro("sentry init");

  try {
    if (!(await confirmExperimental(options, ui))) {
      setTag("wizard.outcome", "bailed");
      showCancelledFeedback(ui);
      process.exitCode = 0;
      return false;
    }
  } catch (err) {
    if (err instanceof WizardCancelledError) {
      captureException(err);
      setTag("wizard.outcome", "bailed");
      showCancelledFeedback(ui);
      process.exitCode = 0;
      return false;
    }
    if (err instanceof LoggingUIPromptError) {
      throw new WizardError(
        "The interactive UI failed to load. Run with --yes for non-interactive mode.",
        { rendered: false }
      );
    }
    throw err;
  }

  if (options.dryRun) {
    ui.log.warn("Dry-run mode: no files will be modified.");
  }

  const gitOk = await checkGitStatus({
    cwd: options.directory,
    yes: options.yes || options.dryRun,
    ui,
  });
  if (!gitOk) {
    setTag("wizard.outcome", "bailed");
    showCancelledFeedback(ui);
    process.exitCode = 0;
    return false;
  }

  return true;
}

function projectName(context: ResolvedInitContext): string {
  return context.project ?? basename(context.directory) ?? "sentry-project";
}

function isExistingProjectData(value: unknown): value is ExistingProjectData {
  const data = value as ExistingProjectData;
  return (
    typeof data?.orgSlug === "string" &&
    typeof data.projectSlug === "string" &&
    typeof data.projectId === "string" &&
    typeof data.dsn === "string" &&
    typeof data.url === "string"
  );
}

async function warnIfSentryAlreadyPresent(
  context: ResolvedInitContext,
  ui: WizardUI
): Promise<void> {
  try {
    const result = await detectSentry(context.directory);
    const status = (result.data as { status?: string } | undefined)?.status;
    if (status === "installed") {
      ui.log.warn(
        "Sentry appears to already be set up in this project. The agent will update the existing configuration where needed."
      );
    }
  } catch {
    // Detection is best-effort; never block the run on it.
  }
}

async function ensureProject(
  context: ResolvedInitContext,
  ui: WizardUI
): Promise<ExistingProjectData> {
  const spin = ui.spinner();
  spin.start("Setting up Sentry project...");
  const result = await createSentryProject(
    {
      type: "tool",
      operation: "ensure-sentry-project",
      cwd: context.directory,
      params: { name: projectName(context), platform: "other" },
    },
    context
  );
  if (!(result.ok && isExistingProjectData(result.data))) {
    spin.stop("Project setup failed", 1);
    throw new WizardError(result.error ?? "Could not resolve Sentry project.");
  }
  spin.stop(result.message ?? "Sentry project ready");
  return result.data;
}

async function selectFeatures(
  context: ResolvedInitContext,
  ui: WizardUI
): Promise<string[]> {
  if (context.features?.length) {
    return context.features;
  }
  if (context.yes) {
    return [REQUIRED_FEATURE, "performanceMonitoring"];
  }

  ui.log.info(`${featureLabel(REQUIRED_FEATURE)} is always included.`);
  const selected = await ui.multiselect<string>({
    message: "Which Sentry features should be configured?",
    options: sortFeatures(DEFAULT_OPTIONAL_FEATURES).map((feature) => ({
      value: feature,
      label: featureLabel(feature),
      ...(featureHint(feature) ? { hint: featureHint(feature) } : {}),
    })),
    initialValues: ["performanceMonitoring"],
    required: false,
  });
  return [REQUIRED_FEATURE, ...abortIfCancelled(selected)];
}

async function gitStatusLines(cwd: string): Promise<Set<string>> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", cwd, "status", "--porcelain=v1", "--untracked-files=all"],
      { encoding: "utf8" }
    );
    return new Set(stdout.split("\n").filter(Boolean));
  } catch {
    return new Set();
  }
}

function changedFileAction(status: string): "create" | "delete" | "modify" {
  if (status.includes("D")) {
    return "delete";
  }
  if (status.includes("?")) {
    return "create";
  }
  return "modify";
}

function changedFilesFromStatus(
  before: Set<string>,
  after: Set<string>
): Array<{ action: string; path: string }> {
  return [...after]
    .filter((line) => !before.has(line))
    .map((line) => ({
      action: changedFileAction(line.slice(0, 2)),
      path: line.slice(3).trim(),
    }));
}

const SENTRY_INIT_RE = /Sentry\.init|sentry_sdk\.init|SentrySdk\.init/;

function changedFileHasSentryInit(
  changedFiles: WizardOutput["changedFiles"],
  cwd: string
): boolean {
  for (const file of changedFiles ?? []) {
    if (file.action === "delete") {
      continue;
    }
    try {
      const text = readFileSync(resolve(cwd, file.path), "utf8");
      if (SENTRY_INIT_RE.test(text)) {
        return true;
      }
    } catch {
      // File vanished or is not UTF-8; other changed files still get checked.
    }
  }
  return false;
}

function verifyChanges(output: WizardOutput, cwd: string): string[] {
  const warnings = [...(output.warnings ?? [])];

  try {
    const pkg = readFileSync(resolve(cwd, "package.json"), "utf8");
    if (!pkg.includes("@sentry/")) {
      warnings.push(
        "package.json does not appear to include a Sentry package."
      );
    }
  } catch {
    // Not a Node project (or no root package.json); skip this check.
  }

  if (!changedFileHasSentryInit(output.changedFiles, cwd)) {
    warnings.push("Could not find a Sentry init call in the changed files.");
  }

  return warnings;
}

async function runAgentFlow(
  context: ResolvedInitContext,
  ui: WizardUI
): Promise<void> {
  if (!context.authToken) {
    throw new WizardError("Not authenticated. Run `sentry auth login` first.");
  }

  await warnIfSentryAlreadyPresent(context, ui);

  const sentryProject = await ensureProject(context, ui);
  ui.setStep?.("ensure-sentry-project", "completed");

  ui.setStep?.("select-features", "in_progress");
  const features = await selectFeatures(context, ui);
  ui.setStep?.("select-features", "completed");

  const beforeStatus = await gitStatusLines(context.directory);
  ui.setStep?.("apply-codemods", "in_progress");
  const agentOutput = await runInitAgent({
    authToken: context.authToken,
    gatewayUrl: SENTRY_INIT_ANTHROPIC_BASE_URL,
    dryRun: context.dryRun,
    prompt: buildInitAgentPrompt({ context, sentryProject, features }),
    appendSystemPrompt: appendInitSystemPrompt(context.dryRun),
    ui,
    workingDirectory: context.directory,
  });
  ui.setStep?.("apply-codemods", "completed");

  ui.setStep?.("verify-changes", "in_progress");
  const afterStatus = await gitStatusLines(context.directory);
  const output: WizardOutput = {
    ...agentOutput,
    projectDir: context.directory,
    features,
    sentryProjectUrl: sentryProject.url,
    changedFiles: context.dryRun
      ? []
      : changedFilesFromStatus(beforeStatus, afterStatus),
  };
  if (!context.dryRun) {
    output.warnings = verifyChanges(output, context.directory);
  }
  ui.setStep?.("verify-changes", "completed");

  handleFinalResult({ status: "success", result: output }, ui);
}

function handleRunError(err: unknown, ui: WizardUI): void {
  if (err instanceof WizardCancelledError) {
    showCancelledFeedback(ui);
    process.exitCode = 0;
    return;
  }
  ui.setStep?.("apply-codemods", "failed");
  const message = err instanceof Error ? err.message : String(err);
  handleFinalResult(
    { status: "failed", error: message, result: { exitCode: 1, message } },
    ui
  );
  throw err instanceof WizardError ? err : new WizardError(message);
}

export async function runWizard(initialOptions: WizardOptions): Promise<void> {
  const { yes, dryRun, forceLegacyUi } = initialOptions;
  const initialWelcome = yes || dryRun ? undefined : buildWelcomeOptions();
  await using ui = await getUIAsync({
    yes,
    forceLegacy: forceLegacyUi,
    ...(initialWelcome ? { initialWelcome } : {}),
  });
  ui.setIntroMode?.(!yes);

  if (!(await preamble(initialOptions, ui))) {
    return;
  }

  await checkReadiness(ui);

  const context = await resolveInitContext(initialOptions, ui);
  if (!context) {
    return;
  }

  ui.setIntroMode?.(false);
  ui.setStep?.("ensure-sentry-project", "in_progress");

  try {
    await runAgentFlow(context, ui);
  } catch (err) {
    handleRunError(err, ui);
  }
}

export function handleFinalResult(
  result: WorkflowRunResult,
  ui: WizardUI
): void {
  if (result.status === "success") {
    setTag("wizard.outcome", "success");
    if (result.result?.features) {
      setTag("wizard.features", result.result.features.join(","));
    }
    formatResult(result, ui);
    return;
  }

  setTag("wizard.outcome", "failed");
  formatError(result, ui);
  process.exitCode = mapWorkflowExitCode(result.result?.exitCode);
}

function mapWorkflowExitCode(workflowCode: number | undefined): number {
  switch (workflowCode) {
    case EXIT_VERIFICATION_FAILED:
      return EXIT.WIZARD_VERIFY;
    default:
      return workflowCode ?? EXIT.WIZARD_CODEMOD;
  }
}
