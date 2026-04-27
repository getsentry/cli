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

// ── Tool payloads (unchanged — used by `lib/init/tools/registry.ts`). ──

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
  caseInsensitive?: boolean;
  multiline?: boolean;
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

// ── Wizard output ──────────────────────────────────────────────────

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

// ── Interactive payloads (the agent asks the user via a prompt). ──

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

export type InteractivePayload =
  | SelectPayload
  | MultiSelectPayload
  | ConfirmPayload;

// ── /api/init request body ────────────────────────────────────────

/**
 * Snapshot of the user's project captured locally before the workflow
 * starts. Embedded in the agent's user prompt so phase 1 doesn't need
 * to round-trip through the bridge for `list_dir` / `read_files`.
 */
export type InitProjectContext = {
  /** Recursive listing capped at depth 3 / 500 entries (POSIX paths). */
  dirListing: DirEntry[];
  /** path -> content (null when too big / unreadable). */
  configFiles: Record<string, string | null>;
  /** Heuristic check for an existing Sentry installation. */
  existingSentry: {
    status: "none" | "installed";
    signals: string[];
    dsn?: string;
  };
};

export type InitStartInput = {
  directory: string;
  yes: boolean;
  dryRun: boolean;
  features?: string[];
  org?: string;
  team?: string;
  project?: string;
  existingProject?: ExistingProjectData;
  sentryAuthToken?: string;
  cliVersion: string;
  projectContext?: InitProjectContext;
};

// ── Local-action resume body (CLI -> server). ─────────────────────

export type InitActionResumeBody =
  | { ok: true; output: Record<string, unknown> }
  | {
      ok: false;
      error: {
        message: string;
        code?: string;
        details?: unknown;
      };
    };

// ── Stream events emitted by the workflow (server -> CLI). ─────────

export type InitStatusEvent = {
  type: "status";
  message: string;
  phase?: string;
};

export type InitActionRequestEvent = {
  type: "action_request";
  actionId: string;
  kind: "tool" | "prompt";
  name: string;
  description?: string;
  payload: unknown;
};

export type InitActionResultEvent = {
  type: "action_result";
  actionId: string;
  ok: boolean;
  summary?: string;
};

export type InitWarningEvent = {
  type: "warning";
  message: string;
};

export type InitSummaryEvent = {
  type: "summary";
  output: WizardOutput;
};

export type InitErrorEvent = {
  type: "error";
  message: string;
  exitCode?: number;
  docsUrl?: string;
  commands?: string[];
  output?: WizardOutput;
};

export type InitDoneEvent = {
  type: "done";
  ok: boolean;
};

/**
 * Server-side stream keepalive. Emitted every ~30s by the workflow's
 * NDJSON wrapper to prevent Bun/undici's fetch-body idle timer from
 * dropping the connection during long agent steps. The CLI advances
 * its `nextStartIndex` cursor for the chunk and otherwise ignores it.
 */
export type InitHeartbeatEvent = {
  type: "heartbeat";
};

export type InitEvent =
  | InitStatusEvent
  | InitActionRequestEvent
  | InitActionResultEvent
  | InitWarningEvent
  | InitSummaryEvent
  | InitErrorEvent
  | InitDoneEvent
  | InitHeartbeatEvent;

// ── Run status response (CLI <- server, GET /api/init/:runId). ────

/**
 * Mirror of the server's `initStatusResponseSchema`. Returned by
 * `GET /api/init/:runId` and consumed by `fetchRunStatus` to decide
 * whether to reconnect to the stream or terminate the wizard.
 */
export type InitStatusResponse = {
  runId?: string;
  status:
    | "queued"
    | "running"
    | "waiting_for_action"
    | "completed"
    | "failed"
    | "cancelled";
  output?: WizardOutput;
  error?: {
    message: string;
    commands?: string[];
    docsUrl?: string;
    exitCode?: number;
    output?: WizardOutput;
  };
};
