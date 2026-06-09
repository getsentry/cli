/**
 * sentry code-mappings upload <path>
 *
 * Bulk-upload code mappings (stack trace root → source code root) for
 * a Sentry project. Code mappings link stack trace paths to source code
 * paths in your repository, enabling source context and stack trace linking.
 *
 * ## Flow
 *
 * 1. Read and validate the JSON input file
 * 2. Resolve org/project via standard cascade
 * 3. Infer repository name and default branch from git remote (or flags)
 * 4. Upload in batches of 300
 * 5. Report created/updated/errors counts
 */

import { execSync } from "node:child_process";
import { readFile } from "node:fs/promises";

import type { SentryContext } from "../../context.js";
import {
  CodeMappingSchema,
  uploadCodeMappings,
} from "../../lib/api/code-mappings.js";
import { buildCommand } from "../../lib/command.js";
import { ContextError, ValidationError } from "../../lib/errors.js";
import { mdKvTable, renderMarkdown } from "../../lib/formatters/markdown.js";
import { CommandOutput } from "../../lib/formatters/output.js";
import { logger } from "../../lib/logger.js";
import { resolveOrgAndProject } from "../../lib/resolve-target.js";

const log = logger.withTag("code-mappings.upload");

// ── Types ───────────────────────────────────────────────────────────

/** Structured result for the upload command. */
type CodeMappingsUploadResult = {
  org: string;
  project: string;
  repository: string;
  defaultBranch: string;
  created: number;
  updated: number;
  errors: number;
  totalMappings: number;
  errorDetails: Array<{
    stackRoot: string;
    sourceRoot: string;
    detail: string;
  }>;
};

// ── Formatter ───────────────────────────────────────────────────────

const USAGE_HINT = "sentry code-mappings upload <path>";

/** Format human-readable output for upload results. */
function formatUploadResult(data: CodeMappingsUploadResult): string {
  const rows: [string, string][] = [
    ["Organization", data.org],
    ["Project", data.project],
    ["Repository", data.repository],
    ["Default branch", data.defaultBranch],
    ["Total mappings", String(data.totalMappings)],
    ["Created", String(data.created)],
    ["Updated", String(data.updated)],
  ];

  if (data.errors > 0) {
    rows.push(["Errors", String(data.errors)]);
  }

  let output = renderMarkdown(mdKvTable(rows));

  if (data.errorDetails.length > 0) {
    output += "\n\nErrors:\n";
    for (const err of data.errorDetails) {
      output += `  ${err.stackRoot} → ${err.sourceRoot}: ${err.detail}\n`;
    }
  }

  return output;
}

/** SSH remote URL pattern: git@host:path.git — captures the full path after `:` */
const SSH_REMOTE_RE = /:(.+?)(?:\.git)?$/;
/** HTTPS remote URL pattern: https://host/path.git — captures the path after the host */
const HTTPS_REMOTE_RE = /^https?:\/\/[^/]+\/(.+?)(?:\.git)?$/;

// ── Helpers ─────────────────────────────────────────────────────────

/**
 * Infer the repository name and the remote used from local git remotes.
 *
 * Tries remotes in order: upstream → origin. Extracts `owner/repo` from
 * the remote URL. Falls back to the next remote if the URL can't be parsed.
 *
 * Returns both the repo name and which remote was used (for branch inference).
 */
function inferRepo(): { name: string; remote: string } | null {
  for (const remote of ["upstream", "origin"]) {
    try {
      const remoteUrl = execSync(`git remote get-url ${remote}`, {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "ignore"],
      }).trim();
      const name = extractRepoName(remoteUrl);
      if (name) {
        return { name, remote };
      }
      log.debug(`Could not parse repo name from '${remote}' URL: ${remoteUrl}`);
    } catch {
      log.debug(`No '${remote}' remote found`);
    }
  }
  return null;
}

/**
 * Extract the repository path from a git remote URL.
 *
 * Handles HTTPS, SSH, and git:// URLs. Supports nested paths for
 * GitLab subgroups (e.g., `group/subgroup/project`).
 */
function extractRepoName(url: string): string | null {
  // SSH: git@github.com:owner/repo.git or git@gitlab.com:group/sub/project.git
  const sshMatch = url.match(SSH_REMOTE_RE);
  if (sshMatch?.[1]) {
    return sshMatch[1];
  }
  // HTTPS: https://github.com/owner/repo.git or https://gitlab.com/group/sub/project.git
  const httpsMatch = url.match(HTTPS_REMOTE_RE);
  if (httpsMatch?.[1]) {
    return httpsMatch[1];
  }
  return null;
}

/**
 * Infer the default branch from a git remote's HEAD ref.
 *
 * @param remote - The remote name to check (e.g., "origin", "upstream")
 */
function inferDefaultBranch(remote: string): string {
  try {
    const output = execSync(`git symbolic-ref refs/remotes/${remote}/HEAD`, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "ignore"],
    }).trim();
    // refs/remotes/origin/main → main
    const parts = output.split("/");
    return parts.at(-1) ?? "main";
  } catch {
    log.debug(
      `Could not infer default branch from '${remote}' remote HEAD, using 'main'`
    );
    return "main";
  }
}

/**
 * Read and validate the code mappings JSON file.
 */
async function readAndValidateMappings(
  path: string
): Promise<Array<{ stackRoot: string; sourceRoot: string }>> {
  let content: string;
  try {
    content = await readFile(path, "utf-8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      throw new ValidationError(
        `Code mappings file '${path}' does not exist.`,
        "path"
      );
    }
    if (code === "EISDIR") {
      throw new ValidationError(
        `Path '${path}' is a directory, not a code mappings file.`,
        "path"
      );
    }
    const msg = err instanceof Error ? err.message : String(err);
    throw new ValidationError(
      `Cannot read code mappings file '${path}': ${msg}`,
      "path"
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new ValidationError(
      `Invalid code mappings file '${path}': not valid JSON`,
      "path"
    );
  }

  if (!Array.isArray(parsed)) {
    throw new ValidationError(
      `Invalid code mappings file '${path}': expected a JSON array`,
      "path"
    );
  }

  if (parsed.length === 0) {
    throw new ValidationError(
      `Code mappings file '${path}' contains no mappings`,
      "path"
    );
  }

  // Validate each entry
  const mappings: Array<{ stackRoot: string; sourceRoot: string }> = [];
  for (let i = 0; i < parsed.length; i++) {
    const result = CodeMappingSchema.safeParse(parsed[i]);
    if (!result.success) {
      const issues = result.error.issues
        .map((iss) => `${iss.path.join(".")}: ${iss.message}`)
        .join(", ");
      throw new ValidationError(
        `Invalid code mapping at index ${i}: ${issues}`,
        "path"
      );
    }
    mappings.push(result.data);
  }

  return mappings;
}

// ── Command ─────────────────────────────────────────────────────────

export const uploadCommand = buildCommand({
  auth: true,
  docs: {
    brief: "Upload code mappings for stack trace linking",
    fullDescription:
      "Bulk-upload code mappings (stack trace root → source code root) for " +
      "a Sentry project. Code mappings link stack trace paths to source code " +
      "paths in your repository, enabling source context, suspect commits, " +
      "and stack trace linking.\n\n" +
      "The input file must be a JSON array of objects with `stackRoot` and " +
      "`sourceRoot` fields.\n\n" +
      "Usage:\n" +
      "  sentry code-mappings upload mappings.json\n" +
      "  sentry code-mappings upload mappings.json --repo owner/repo\n" +
      "  sentry code-mappings upload mappings.json --repo owner/repo --default-branch develop\n" +
      "  sentry code-mappings upload mappings.json --json\n\n" +
      "Requires an Organization Token with `org:ci` scope.",
  },
  output: {
    human: formatUploadResult,
  },
  parameters: {
    positional: {
      kind: "tuple",
      parameters: [
        {
          brief: "Path to the code mappings JSON file",
          parse: String,
          placeholder: "path",
        },
      ],
    },
    flags: {
      repo: {
        kind: "parsed",
        parse: String,
        brief:
          "Repository name (e.g., owner/repo). Auto-detected from git remote if omitted.",
        optional: true,
      },
      "default-branch": {
        kind: "parsed",
        parse: String,
        brief:
          "Default branch name. Auto-detected from git remote HEAD if omitted.",
        optional: true,
      },
    },
  },
  async *func(
    this: SentryContext,
    flags: {
      repo?: string;
      "default-branch"?: string;
    },
    mappingPath: string
  ) {
    // 1. Read and validate the mappings file
    const mappings = await readAndValidateMappings(mappingPath);

    // 2. Resolve org/project
    const resolved = await resolveOrgAndProject({
      cwd: this.cwd,
      usageHint: USAGE_HINT,
    });
    if (!resolved) {
      throw new ContextError("Organization and project", USAGE_HINT);
    }
    const { org, project } = resolved;

    // 3. Resolve repository name and the remote it came from
    const repoInfo = flags.repo ? null : inferRepo();
    const repository = flags.repo ?? repoInfo?.name ?? null;
    if (!repository) {
      throw new ContextError(
        "Repository name",
        "sentry code-mappings upload <path> --repo <owner/repo>",
        [
          "Could not auto-detect repository from git remotes",
          "Provide --repo explicitly",
        ]
      );
    }

    // 4. Resolve default branch (from the same remote that provided the repo name)
    const defaultBranch =
      flags["default-branch"] ??
      inferDefaultBranch(repoInfo?.remote ?? "origin");

    log.info(
      `Uploading ${mappings.length} code mapping(s) for ${org}/${project} → ${repository}`
    );

    // 5. Upload
    const response = await uploadCodeMappings({
      org,
      project,
      repository,
      defaultBranch,
      mappings,
    });

    // 6. Collect error details
    const errorDetails = response.mappings
      .filter((m) => m.status === "error")
      .map((m) => ({
        stackRoot: m.stackRoot,
        sourceRoot: m.sourceRoot,
        detail: m.detail ?? "Unknown error",
      }));

    // 7. Yield result
    yield new CommandOutput<CodeMappingsUploadResult>({
      org,
      project,
      repository,
      defaultBranch,
      created: response.created,
      updated: response.updated,
      errors: response.errors,
      totalMappings: mappings.length,
      errorDetails,
    });

    if (response.errors > 0) {
      process.exitCode = 1;
      return {
        hint: `Created: ${response.created}, Updated: ${response.updated}, Errors: ${response.errors}`,
      };
    }

    return {
      hint: `Created: ${response.created}, Updated: ${response.updated}`,
    };
  },
});
