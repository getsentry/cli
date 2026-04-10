export type DirEntry = {
  name: string;
  path: string;
  type: "file" | "directory";
};

export type WizardOptions = {
  directory: string;
  yes: boolean;
  dryRun: boolean;
  features?: string[];
  /** Explicit team slug to create the project under. Skips team resolution. */
  team?: string;
  /** Explicit org slug from CLI arg (e.g., "acme" from "acme/my-app"). Skips interactive org selection. */
  org?: string;
  /** Explicit project name from CLI arg (e.g., "my-app" from "acme/my-app"). Overrides wizard-detected name. */
  project?: string;
  /** Auth token for injecting into generated env files (e.g., .env.sentry-build-plugin). Never sent to the server. */
  authToken?: string;
};

// Local-op suspend payloads

export type LocalOpPayload =
  | ListDirPayload
  | ReadFilesPayload
  | FileExistsBatchPayload
  | RunCommandsPayload
  | ApplyPatchsetPayload
  | CreateSentryProjectPayload
  | DetectSentryPayload;

export type ListDirPayload = {
  type: "local-op";
  operation: "list-dir";
  cwd: string;
  params: {
    path: string;
    recursive?: boolean;
    maxDepth?: number;
    maxEntries?: number;
  };
};

export type ReadFilesPayload = {
  type: "local-op";
  operation: "read-files";
  cwd: string;
  params: {
    paths: string[];
    maxBytes?: number;
  };
};

export type FileExistsBatchPayload = {
  type: "local-op";
  operation: "file-exists-batch";
  cwd: string;
  params: {
    paths: string[];
  };
};

export type RunCommandsPayload = {
  type: "local-op";
  operation: "run-commands";
  cwd: string;
  params: {
    commands: string[];
    timeoutMs?: number;
  };
};

export type PatchEdit = {
  oldString: string;
  newString: string;
};

export type ApplyPatchsetPatch =
  | { path: string; action: "create"; patch: string }
  | { path: string; action: "modify"; edits: PatchEdit[] }
  | { path: string; action: "delete"; patch?: string };

export type ApplyPatchsetPayload = {
  type: "local-op";
  operation: "apply-patchset";
  cwd: string;
  params: {
    patches: ApplyPatchsetPatch[];
  };
};

export type CreateSentryProjectPayload = {
  type: "local-op";
  operation: "create-sentry-project";
  cwd: string;
  params: {
    name: string;
    platform: string;
  };
};

export type DetectSentryPayload = {
  type: "local-op";
  operation: "detect-sentry";
  /** Human-readable spinner hint from the server (≤ 120 chars, sensitive values redacted). */
  detail?: string;
  cwd: string;
  params: Record<string, never>;
};

export type LocalOpResult = {
  ok: boolean;
  error?: string;
  /** Optional user-facing message (e.g. "Using existing project 'foo'"). */
  message?: string;
  data?: unknown;
};

// Wizard output — typed shape of the `result` field returned by the server

export type WizardOutput = {
  platform?: string;
  projectDir?: string;
  features?: string[];
  commands?: string[];
  changedFiles?: Array<{ action: string; path: string }>;
  warnings?: string[];
  exitCode?: number;
  docsUrl?: string;
  sentryProjectUrl?: string;
  message?: string;
};

// Interactive suspend payloads

export type InteractivePayload =
  | SelectPayload
  | MultiSelectPayload
  | ConfirmPayload;

export type SelectPayload = {
  type: "interactive";
  kind: "select";
  prompt: string;
  options?: string[];
  apps?: Array<{ name: string; path: string; framework?: string }>;
};

export type MultiSelectPayload = {
  type: "interactive";
  kind: "multi-select";
  prompt: string;
  availableFeatures?: string[];
  options?: string[];
};

export type ConfirmPayload = {
  type: "interactive";
  kind: "confirm";
  prompt: string;
};

// Combined suspend payload — either a local-op or an interactive prompt

export type SuspendPayload = LocalOpPayload | InteractivePayload;

// Workflow run result

export type WorkflowRunResult = {
  status: "suspended" | "success" | "failed";
  suspended?: string[][];
  steps?: Record<string, { suspendPayload?: unknown }>;
  suspendPayload?: unknown;
  result?: WizardOutput;
  error?: string;
};
