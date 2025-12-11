import { buildCommand, numberParser } from "@stricli/core";
import type { SryContext } from "../../context.js";
import { listIssues, listProjects } from "../../lib/api-client.js";
import {
  getDefaultOrganization,
  getDefaultProject,
} from "../../lib/config.js";
import { detectDSN } from "../../lib/dsn-finder.js";
import type { SentryIssue } from "../../types/index.js";

interface ListFlags {
  readonly org?: string;
  readonly project?: string;
  readonly query?: string;
  readonly limit: number;
  readonly sort: "date" | "new" | "priority" | "freq" | "user";
  readonly json: boolean;
}

function formatIssue(issue: SentryIssue): string {
  const status =
    issue.status === "resolved"
      ? "✓"
      : issue.status === "ignored"
        ? "−"
        : "●";
  const level = issue.level.toUpperCase().padEnd(7);
  const count = `${issue.count}`.padStart(5);
  const shortId = issue.shortId.padEnd(15);

  return `${status} ${level} ${shortId} ${count}  ${issue.title}`;
}

export const listCommand = buildCommand({
  docs: {
    brief: "List issues in a project",
    fullDescription:
      "List issues from a Sentry project. By default, uses the project detected from your DSN " +
      "or configured defaults. Use --org and --project to specify explicitly.",
  },
  parameters: {
    flags: {
      org: {
        kind: "parsed",
        parse: String,
        brief: "Organization slug",
        optional: true,
      },
      project: {
        kind: "parsed",
        parse: String,
        brief: "Project slug",
        optional: true,
      },
      query: {
        kind: "parsed",
        parse: String,
        brief: "Search query (Sentry search syntax)",
        optional: true,
      },
      limit: {
        kind: "parsed",
        parse: numberParser,
        brief: "Maximum number of issues to return",
        default: 25,
      },
      sort: {
        kind: "parsed",
        parse: (value: string) => {
          const valid = ["date", "new", "priority", "freq", "user"];
          if (!valid.includes(value)) {
            throw new Error(`Invalid sort value. Must be one of: ${valid.join(", ")}`);
          }
          return value as "date" | "new" | "priority" | "freq" | "user";
        },
        brief: "Sort by: date, new, priority, freq, user",
        default: "date" as const,
      },
      json: {
        kind: "boolean",
        brief: "Output as JSON",
        default: false,
      },
    },
  },
  async func(this: SryContext, flags: ListFlags): Promise<void> {
    const { process } = this;

    // Determine organization and project
    let org = flags.org || getDefaultOrganization();
    let project = flags.project || getDefaultProject();

    // Try to detect from DSN if not specified
    if (!org || !project) {
      try {
        const detection = await detectDSN(process.cwd());
        if (detection) {
          process.stdout.write(
            `Detected Sentry project from ${detection.source}\n\n`
          );
          // Note: We'd need to look up org/project from DSN via API
          // For now, require explicit org/project
        }
      } catch {
        // Ignore detection errors
      }
    }

    if (!org || !project) {
      process.stderr.write(
        "Error: Organization and project are required.\n\n" +
          "Please specify them using:\n" +
          "  sry issue list --org <org-slug> --project <project-slug>\n\n" +
          "Or set defaults:\n" +
          "  sry config set defaults.organization <org-slug>\n" +
          "  sry config set defaults.project <project-slug>\n"
      );
      process.exitCode = 1;
      return;
    }

    try {
      const issues = await listIssues(org, project, {
        query: flags.query,
        limit: flags.limit,
        sort: flags.sort,
      });

      if (flags.json) {
        process.stdout.write(JSON.stringify(issues, null, 2) + "\n");
        return;
      }

      if (issues.length === 0) {
        process.stdout.write("No issues found.\n");
        return;
      }

      // Header
      process.stdout.write(
        `Issues in ${org}/${project} (showing ${issues.length}):\n\n`
      );
      process.stdout.write(
        "  STATUS  SHORT ID         COUNT  TITLE\n"
      );
      process.stdout.write(
        "─".repeat(80) + "\n"
      );

      // Issues
      for (const issue of issues) {
        process.stdout.write(formatIssue(issue) + "\n");
      }

      process.stdout.write(
        "\n" +
          `Tip: Use 'sry issue get <SHORT_ID>' to view issue details.\n`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`Error listing issues: ${message}\n`);
      process.exitCode = 1;
    }
  },
});

