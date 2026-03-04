export type DirEntry = {
  name: string;
  path: string;
  type: "file" | "directory";
};

export type WizardOptions = {
  directory: string;
  force: boolean;
  yes: boolean;
  dryRun: boolean;
  features?: string[];
};

// Local-op suspend payloads

export type LocalOpPayload =
  | ListDirPayload
  | ReadFilesPayload
  | FileExistsBatchPayload
  | RunCommandsPayload
  | ApplyPatchsetPayload
  | CreateSentryProjectPayload;

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

export type ApplyPatchsetPayload = {
  type: "local-op";
  operation: "apply-patchset";
  cwd: string;
  params: {
    patches: Array<{
      path: string;
      action: "create" | "modify" | "delete";
      patch: string;
    }>;
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

export type LocalOpResult = {
  ok: boolean;
  error?: string;
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
  purpose?: string;
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
