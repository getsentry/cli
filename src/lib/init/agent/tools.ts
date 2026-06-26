/**
 * In-process MCP server exposing Sentry-specific tools to the local agent.
 *
 * Tools are defined with the SDK's `tool()` + `createSdkMcpServer()` (the same
 * pattern PostHog's wizard uses) and run in the CLI process - no subprocess,
 * no remote service. The docs tool is the agent's source of truth for SDK
 * setup and is meant to be called repeatedly throughout the run; the framework
 * tools apply deterministic Xcode transforms the agent can reach for when it
 * detects a native iOS / React Native project.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { z } from "zod";
import { getDocsByKeywords } from "../docs/keyword-lookup.js";
import { safePath } from "../tools/shared.js";
import { buildPbxprojCodemod } from "./framework/ios-spm.js";
import { patchReactNativeXcode } from "./framework/react-native-xcode.js";
import { loadAgentSdk, type SdkToolResult } from "./sdk-loader.js";

export const SENTRY_TOOLS_SERVER = "sentry";

/** Fully-qualified tool names as the agent sees them (mcp__<server>__<tool>). */
export const SENTRY_TOOL_NAMES = [
  "mcp__sentry__get_docs_by_keywords",
  "mcp__sentry__apply_ios_spm",
  "mcp__sentry__patch_react_native_xcode",
];

function textResult(text: string): SdkToolResult {
  return { content: [{ type: "text" as const, text }] };
}

function applyIosSpmTool(root: string, relativePath: string): string {
  const absolute = safePath(root, relativePath);
  const content = readFileSync(absolute, "utf8");
  const codemod = buildPbxprojCodemod(content, relativePath);
  if (!codemod) {
    return `No change: sentry-cocoa already present in ${relativePath} (or the file could not be parsed).`;
  }
  writeFileSync(absolute, codemod.content, "utf8");
  return `Added sentry-cocoa SPM dependency to ${relativePath}.`;
}

function patchRnXcodeTool(root: string, relativePath: string): string {
  const absolute = safePath(root, relativePath);
  const content = readFileSync(absolute, "utf8");
  const patched = patchReactNativeXcode(content);
  if (!patched) {
    return `No change: React Native Sentry build phases already present in ${relativePath} (or it is an Expo project).`;
  }
  writeFileSync(absolute, patched, "utf8");
  return `Patched React Native Xcode build phases for Sentry in ${relativePath}.`;
}

/**
 * Build the in-process Sentry tools MCP server. `workingDirectory` scopes the
 * framework file transforms - they only ever touch files under it.
 */
export async function createSentryToolsServer(options: {
  workingDirectory: string;
}): Promise<unknown> {
  const { workingDirectory } = options;
  const { tool, createSdkMcpServer } = await loadAgentSdk();

  const getDocs = tool(
    "get_docs_by_keywords",
    "Fetch focused Sentry documentation pages from docs.sentry.io by keyword. " +
      "Call this whenever you need Sentry setup details - repeatedly and as " +
      "often as needed throughout the run (e.g. 'nextjs install', then later " +
      "'nextjs sourcemaps', then 'react session replay privacy'). Pass the " +
      "library/framework slugs you detected in `libs` and a short description " +
      "of the stack in `stackSummary` to improve results. Returns Markdown " +
      "excerpts with source URLs. Always prefer these docs over prior memory.",
    {
      keywords: z
        .array(z.string().min(1))
        .min(1)
        .describe(
          "Topics to look up, e.g. ['install','sourcemaps','session replay']"
        ),
      libs: z
        .array(z.string())
        .optional()
        .describe(
          "Detected framework/library slugs, e.g. ['nextjs'] or ['django']"
        ),
      stackSummary: z
        .string()
        .optional()
        .describe(
          "Short free-text stack description, e.g. 'Next.js 15 App Router, pnpm'"
        ),
      maxPages: z
        .number()
        .int()
        .min(1)
        .max(8)
        .optional()
        .describe("Maximum doc pages to return (default 4)"),
    },
    async (args) =>
      textResult(
        await getDocsByKeywords({
          keywords: (args.keywords as string[] | undefined) ?? [],
          libs: args.libs as string[] | undefined,
          stackSummary: args.stackSummary as string | undefined,
          maxPages: args.maxPages as number | undefined,
        })
      )
  );

  const applyIosSpm = tool(
    "apply_ios_spm",
    "Add the sentry-cocoa Swift Package Manager dependency to an Xcode " +
      "project's project.pbxproj. Use this for native iOS/macOS Swift projects " +
      "(sentry.cocoa) instead of hand-editing the .pbxproj, which is fragile. " +
      "Pass the project.pbxproj path relative to the project directory. " +
      "Idempotent: a no-op if sentry-cocoa is already referenced.",
    {
      pbxprojPath: z
        .string()
        .min(1)
        .describe(
          "Path to project.pbxproj relative to the project directory, " +
            "e.g. 'MyApp.xcodeproj/project.pbxproj'"
        ),
    },
    async (args) =>
      textResult(applyIosSpmTool(workingDirectory, args.pbxprojPath as string))
  );

  const patchRnXcode = tool(
    "patch_react_native_xcode",
    "Patch a bare React Native iOS project's Xcode build phases for Sentry: " +
      "switch the bundle phase to sentry-xcode.sh and add a debug-symbol " +
      "upload phase. Use only for bare React Native (not Expo). Pass the " +
      "project.pbxproj path relative to the project directory. Idempotent.",
    {
      pbxprojPath: z
        .string()
        .min(1)
        .describe(
          "Path to ios/<App>.xcodeproj/project.pbxproj relative to the project directory"
        ),
    },
    async (args) =>
      textResult(patchRnXcodeTool(workingDirectory, args.pbxprojPath as string))
  );

  return createSdkMcpServer({
    name: SENTRY_TOOLS_SERVER,
    version: "1.0.0",
    tools: [getDocs, applyIosSpm, patchRnXcode],
  });
}
