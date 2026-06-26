/**
 * OS sandbox configuration for the Claude Agent SDK, mirroring how PostHog's
 * wizard contains the agent: restrict filesystem writes to the project (plus
 * package-manager caches and temp) and restrict network egress to package
 * registries, GitHub, the model gateway, and docs.sentry.io. This is the
 * primary defense against a prompt-injected agent exfiltrating data or writing
 * outside the project; `canUseTool` and `safePath` are belt-and-suspenders.
 *
 * `failIfUnavailable: false` so hosts without sandbox support (e.g. Linux
 * without bubblewrap) degrade gracefully rather than aborting the run.
 */

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { SENTRY_INIT_GATEWAY_URL } from "../constants.js";

export function findPnpmWorkspaceRoot(projectDir: string): string | undefined {
  let current = path.resolve(projectDir);
  for (;;) {
    if (existsSync(path.join(current, "pnpm-workspace.yaml"))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return;
    }
    current = parent;
  }
}

function allowWritePaths(projectDir: string, agentTempDir: string): string[] {
  const normalized = path.resolve(projectDir);
  const workspaceRoot = findPnpmWorkspaceRoot(normalized);
  const home = process.env.HOME ?? homedir();
  return [
    normalized,
    `${normalized}/**`,
    ...(workspaceRoot && workspaceRoot !== normalized
      ? [workspaceRoot, `${workspaceRoot}/**`]
      : []),
    agentTempDir,
    `${agentTempDir}/**`,
    "/tmp",
    "/tmp/**",
    "/private/tmp",
    "/private/tmp/**",
    // Package-manager stores, caches, and toolchains so installs and
    // self-updates work without escaping the user's setup.
    `${home}/.npm/**`,
    `${home}/.cache/**`,
    `${home}/Library/Caches/**`,
    `${home}/Library/pnpm/**`,
    `${home}/.local/share/pnpm/**`,
    `${home}/.pnpm-store/**`,
    `${home}/.yarn/**`,
    `${home}/.bun/install/**`,
    `${home}/.bundle/**`,
    `${home}/.gem/**`,
  ];
}

const BASE_ALLOWED_DOMAINS = [
  // Model endpoints (gateway + direct/BYO-key fallback).
  "api.anthropic.com",
  "ai-gateway.vercel.sh",
  // Package registries.
  "registry.npmjs.org",
  "pypi.org",
  "files.pythonhosted.org",
  "rubygems.org",
  "repo.maven.apache.org",
  // Source hosting (some SDK installs/scripts fetch from GitHub).
  "github.com",
  "api.github.com",
  "raw.githubusercontent.com",
  "objects.githubusercontent.com",
  // Sentry docs (the local docs tool fetches these).
  "docs.sentry.io",
];

function gatewayHosts(): string[] {
  try {
    return [new URL(SENTRY_INIT_GATEWAY_URL).hostname];
  } catch {
    return [];
  }
}

export function buildAgentSandbox(
  workingDirectory: string,
  agentTempDir: string
) {
  return {
    enabled: true,
    failIfUnavailable: false,
    allowUnsandboxedCommands: false,
    filesystem: {
      allowWrite: allowWritePaths(workingDirectory, agentTempDir),
    },
    network: {
      allowedDomains: [
        ...new Set([...BASE_ALLOWED_DOMAINS, ...gatewayHosts()]),
      ],
    },
  };
}
