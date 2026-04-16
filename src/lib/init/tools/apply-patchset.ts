import fs from "node:fs";
import path from "node:path";
import { replace } from "../replacers.js";
import type {
  ApplyPatchsetPatch,
  ApplyPatchsetPayload,
  ToolResult,
} from "../types.js";
import { isEnvFile, prettyPrintJson, safePath } from "./shared.js";
import type { InitToolDefinition, ToolContext } from "./types.js";

/** Pattern matching empty or placeholder SENTRY_AUTH_TOKEN values in env files. */
const EMPTY_AUTH_TOKEN_RE =
  /^(SENTRY_AUTH_TOKEN[ \t]*=[ \t]*)(?:['"]?[ \t]*['"]?)?[ \t]*$/m;

const VALID_PATCH_ACTIONS = new Set(["create", "modify", "delete"]);

/**
 * Apply a batch of file creates, modifications, and deletes.
 */
export async function applyPatchset(
  payload: ApplyPatchsetPayload,
  context: Pick<ToolContext, "dryRun" | "authToken">
): Promise<ToolResult> {
  if (context.dryRun) {
    return applyPatchsetDryRun(payload);
  }

  for (const patch of payload.params.patches) {
    safePath(payload.cwd, patch.path);
    if (!VALID_PATCH_ACTIONS.has(patch.action)) {
      return {
        ok: false,
        error: `Unknown patch action: "${patch.action}" for path "${patch.path}"`,
      };
    }
  }

  const applied: Array<{ path: string; action: string }> = [];

  for (const patch of payload.params.patches) {
    const absPath = safePath(payload.cwd, patch.path);

    if (patch.action === "modify") {
      try {
        await fs.promises.access(absPath);
      } catch {
        return {
          ok: false,
          error: `Cannot modify "${patch.path}": file does not exist`,
          data: { applied },
        };
      }
    }

    await applySinglePatch(absPath, patch, context.authToken);
    applied.push({ path: patch.path, action: patch.action });
  }

  return { ok: true, data: { applied } };
}

function applyPatchsetDryRun(payload: ApplyPatchsetPayload): ToolResult {
  const applied: Array<{ path: string; action: string }> = [];

  for (const patch of payload.params.patches) {
    safePath(payload.cwd, patch.path);
    if (!VALID_PATCH_ACTIONS.has(patch.action)) {
      return {
        ok: false,
        error: `Unknown patch action: "${patch.action}" for path "${patch.path}"`,
      };
    }
    applied.push({ path: patch.path, action: patch.action });
  }

  return { ok: true, data: { applied } };
}

async function applySinglePatch(
  absPath: string,
  patch: ApplyPatchsetPatch,
  authToken?: string
): Promise<void> {
  switch (patch.action) {
    case "create": {
      await fs.promises.mkdir(path.dirname(absPath), { recursive: true });
      const content = resolvePatchContent(
        patch as ApplyPatchsetPatch & { patch: string },
        authToken
      );
      await fs.promises.writeFile(absPath, content, "utf-8");
      break;
    }
    case "modify": {
      const content = await applyEdits(absPath, patch.path, patch.edits);
      await fs.promises.writeFile(absPath, content, "utf-8");
      break;
    }
    case "delete": {
      try {
        await fs.promises.unlink(absPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          throw error;
        }
      }
      break;
    }
    default:
      break;
  }
}

function resolvePatchContent(
  patch: { path: string; patch: string },
  authToken?: string
): string {
  let content = patch.path.endsWith(".json")
    ? prettyPrintJson(patch.patch)
    : patch.patch;

  if (authToken && isEnvFile(patch.path) && EMPTY_AUTH_TOKEN_RE.test(content)) {
    content = content.replace(
      EMPTY_AUTH_TOKEN_RE,
      (_, prefix) => `${prefix}${authToken}`
    );
  }

  return content;
}

async function applyEdits(
  absPath: string,
  filePath: string,
  edits: Array<{ oldString: string; newString: string }>
): Promise<string> {
  let content = await fs.promises.readFile(absPath, "utf-8");

  for (let i = 0; i < edits.length; i += 1) {
    const edit = edits[i];
    if (!edit) {
      continue;
    }
    try {
      content = replace(content, edit.oldString, edit.newString);
    } catch (error) {
      throw new Error(
        `Edit #${i + 1} failed on "${filePath}": ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  return content;
}

/**
 * Tool definition for file patch application.
 */
export const applyPatchsetTool: InitToolDefinition<"apply-patchset"> = {
  operation: "apply-patchset",
  describe: (payload) => {
    const [first] = payload.params.patches;
    if (payload.params.patches.length === 1 && first) {
      const verb =
        first.action === "create"
          ? "Creating"
          : first.action === "modify"
            ? "Modifying"
            : first.action === "delete"
              ? "Deleting"
              : "Updating";
      const fileName = first.path.split(/[/\\]/u).at(-1) ?? first.path;
      return `${verb} \`${fileName}\`...`;
    }
    return `Applying ${payload.params.patches.length} file changes...`;
  },
  execute: applyPatchset,
};

