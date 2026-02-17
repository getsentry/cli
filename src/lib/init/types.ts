import type { Writer } from "../../types/index.js";

export interface WizardOptions {
  directory: string;
  force: boolean;
  yes: boolean;
  dryRun: boolean;
  features?: string[];
  stdout: Writer;
  stderr: Writer;
  stdin: NodeJS.ReadStream & { fd: 0 };
}

// ── Local-op suspend payloads ──────────────────────────────

export type LocalOpPayload =
  | ListDirPayload
  | ReadFilesPayload
  | FileExistsBatchPayload
  | RunCommandsPayload
  | ApplyPatchsetPayload;

export interface ListDirPayload {
  type: "local-op";
  operation: "list-dir";
  cwd: string;
  params: {
    path: string;
    recursive?: boolean;
    maxDepth?: number;
    maxEntries?: number;
  };
}

export interface ReadFilesPayload {
  type: "local-op";
  operation: "read-files";
  cwd: string;
  params: {
    paths: string[];
    maxBytes?: number;
  };
}

export interface FileExistsBatchPayload {
  type: "local-op";
  operation: "file-exists-batch";
  cwd: string;
  params: {
    paths: string[];
  };
}

export interface RunCommandsPayload {
  type: "local-op";
  operation: "run-commands";
  cwd: string;
  params: {
    commands: string[];
    timeoutMs?: number;
  };
}

export interface ApplyPatchsetPayload {
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
}

export interface LocalOpResult {
  ok: boolean;
  error?: string;
  data?: unknown;
}

// ── Interactive suspend payloads ───────────────────────────

export interface InteractivePayload {
  type: "interactive";
  prompt: string;
  kind: "select" | "multi-select" | "confirm";
  [key: string]: unknown;
}

// ── Workflow run result ────────────────────────────────────

export interface WorkflowRunResult {
  status: "suspended" | "success" | "failed";
  suspended?: string[][];
  steps?: Record<string, { suspendPayload?: unknown }>;
  suspendPayload?: unknown;
  result?: unknown;
  error?: string;
}
