export type DirEntry = {
  name: string;
  path: string;
  type: "file" | "directory";
};

export type ExistingProjectData = {
  orgSlug: string;
  projectSlug: string;
  projectId: string;
  dsn: string;
  url: string;
};

export type WizardOptions = {
  directory: string;
  yes: boolean;
  dryRun: boolean;
  features?: string[];
  team?: string;
  org?: string;
  project?: string;
};

export type ResolvedInitContext = {
  directory: string;
  yes: boolean;
  dryRun: boolean;
  features?: string[];
  org: string;
  /**
   * Resolved team slug for init operations.
   * Omitted when init defers empty-org auto-creation until project creation.
   */
  team?: string;
  project?: string;
  authToken?: string;
  existingProject?: ExistingProjectData;
};

export type InteractiveContext = Pick<ResolvedInitContext, "yes" | "dryRun">;

// Tool suspend payloads
export type ToolPayload =
  | ListDirPayload
  | ReadFilesPayload
  | FileExistsBatchPayload
  | RunCommandsPayload
  | ApplyPatchsetPayload
  | GrepPayload
  | GlobPayload
  | CreateSentryProjectPayload
  | EnsureSentryProjectPayload
  | DetectSentryPayload;

export type ToolOperation = ToolPayload["operation"];

export type ListDirPayload = {
  type: "tool";
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
  type: "tool";
  operation: "read-files";
  cwd: string;
  params: {
    paths: string[];
    maxBytes?: number;
  };
};

export type FileExistsBatchPayload = {
  type: "tool";
  operation: "file-exists-batch";
  cwd: string;
  params: {
    paths: string[];
  };
};

export type RunCommandsPayload = {
  type: "tool";
  operation: "run-commands";
  cwd: string;
  params: {
    commands: string[];
    timeoutMs?: number;
  };
};

export type GrepSearch = {
  pattern: string;
  path?: string;
  include?: string;
};

export type GrepPayload = {
  type: "tool";
  operation: "grep";
  cwd: string;
  params: {
    searches: GrepSearch[];
    maxResultsPerSearch?: number;
  };
};

export type GlobPayload = {
  type: "tool";
  operation: "glob";
  cwd: string;
  params: {
    patterns: string[];
    path?: string;
    maxResults?: number;
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
  type: "tool";
  operation: "apply-patchset";
  cwd: string;
  params: {
    patches: ApplyPatchsetPatch[];
  };
};

export type CreateSentryProjectPayload = {
  type: "tool";
  operation: "create-sentry-project";
  /** Human-readable spinner hint from the server (≤ 120 chars, sensitive values redacted). */
  detail?: string;
  cwd: string;
  params: {
    name: string;
    platform: string;
  };
};

export type EnsureSentryProjectPayload = {
  type: "tool";
  operation: "ensure-sentry-project";
  /** Human-readable spinner hint from the server (≤ 120 chars, sensitive values redacted). */
  detail?: string;
  cwd: string;
  params: {
    name: string;
    platform: string;
  };
};

export type DetectSentryPayload = {
  type: "tool";
  operation: "detect-sentry";
  detail?: string;
  cwd: string;
  params: Record<string, never>;
};

export type ToolResult = {
  ok: boolean;
  error?: string;
  message?: string;
  data?: unknown;
};

// Wizard output
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

// Interactive payloads
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

export type SuspendPayload = ToolPayload | InteractivePayload;

export type WorkflowRunResult = {
  status: "suspended" | "success" | "failed";
  suspended?: string[][];
  steps?: Record<string, { suspendPayload?: unknown }>;
  suspendPayload?: unknown;
  result?: WizardOutput;
  error?: string;
};
