import { buildCommand, numberParser } from "@stricli/core";
import type { SryContext } from "../../context.js";
import { listProjects, listOrganizations } from "../../lib/api-client.js";
import { getDefaultOrganization } from "../../lib/config.js";
import type { SentryProject } from "../../types/index.js";

interface ListFlags {
  readonly org?: string;
  readonly limit: number;
  readonly json: boolean;
  readonly platform?: string;
}

function formatProject(
  project: SentryProject,
  maxSlugLen: number,
  showOrg: boolean,
  orgSlug?: string
): string {
  const slug = showOrg
    ? `${orgSlug}/${project.slug}`.padEnd(maxSlugLen)
    : project.slug.padEnd(maxSlugLen);
  const platform = (project.platform || "").padEnd(20);
  const name = project.name;
  return `${slug}  ${platform}  ${name}`;
}

export const listCommand = buildCommand({
  docs: {
    brief: "List projects",
    fullDescription:
      "List projects in an organization. If no organization is specified, " +
      "uses the default organization or lists projects from all accessible organizations.\n\n" +
      "Examples:\n" +
      "  sry project list\n" +
      "  sry project list --org my-org\n" +
      "  sry project list --limit 10\n" +
      "  sry project list --json\n" +
      "  sry project list --platform javascript",
  },
  parameters: {
    positional: {
      kind: "tuple",
      parameters: [
        {
          brief: "Organization slug (optional)",
          parse: String,
          optional: true,
        },
      ],
    },
    flags: {
      org: {
        kind: "parsed",
        parse: String,
        brief: "Organization slug",
        optional: true,
      },
      limit: {
        kind: "parsed",
        parse: numberParser,
        brief: "Maximum number of projects to list",
        default: 30,
      },
      json: {
        kind: "boolean",
        brief: "Output JSON",
        default: false,
      },
      platform: {
        kind: "parsed",
        parse: String,
        brief: "Filter by platform (e.g., javascript, python)",
        optional: true,
      },
    },
  },
  async func(
    this: SryContext,
    flags: ListFlags,
    orgArg?: string
  ): Promise<void> {
    const { process } = this;

    try {
      // Determine organization
      const orgSlug = orgArg || flags.org || getDefaultOrganization();

      let allProjects: Array<SentryProject & { orgSlug?: string }> = [];
      let showOrg = false;

      if (orgSlug) {
        // List projects for specific org
        const projects = await listProjects(orgSlug);
        allProjects = projects.map((p) => ({ ...p, orgSlug }));
      } else {
        // List projects from all organizations
        showOrg = true;
        const orgs = await listOrganizations();
        for (const org of orgs) {
          try {
            const projects = await listProjects(org.slug);
            allProjects.push(
              ...projects.map((p) => ({ ...p, orgSlug: org.slug }))
            );
          } catch {
            // Skip orgs we can't access
          }
        }
      }

      // Filter by platform if specified
      if (flags.platform) {
        allProjects = allProjects.filter(
          (p) =>
            p.platform?.toLowerCase().includes(flags.platform!.toLowerCase())
        );
      }

      // Limit results
      const limitedProjects = allProjects.slice(0, flags.limit);

      if (flags.json) {
        process.stdout.write(JSON.stringify(limitedProjects, null, 2) + "\n");
        return;
      }

      if (limitedProjects.length === 0) {
        if (orgSlug) {
          process.stdout.write(
            `No projects found in organization '${orgSlug}'.\n`
          );
        } else {
          process.stdout.write("No projects found.\n");
        }
        return;
      }

      // Calculate max slug length for alignment
      const maxSlugLen = Math.max(
        ...limitedProjects.map((p) =>
          showOrg ? `${p.orgSlug}/${p.slug}`.length : p.slug.length
        ),
        4 // minimum "SLUG" header length
      );

      // Print header
      process.stdout.write(
        `${"SLUG".padEnd(maxSlugLen)}  ${"PLATFORM".padEnd(20)}  NAME\n`
      );

      // Print projects
      for (const project of limitedProjects) {
        process.stdout.write(
          formatProject(project, maxSlugLen, showOrg, project.orgSlug) + "\n"
        );
      }

      if (allProjects.length > flags.limit) {
        process.stdout.write(
          `\nShowing ${flags.limit} of ${allProjects.length} projects\n`
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`Error listing projects: ${message}\n`);
      process.exitCode = 1;
    }
  },
});

