/**
 * Loads the Claude Agent SDK. Today this is a plain dynamic import (works in
 * dev via tsx and in plain Node installs). The single-binary (Node SEA) build
 * extracts the SDK assets and points the SDK at the embedded platform
 * executable; that wiring is layered in by the build packaging step and goes
 * through this loader so the rest of the agent code stays unaware of it.
 */

export type SdkContentPart = {
  type?: string;
  text?: string;
  name?: string;
  input?: unknown;
};

export type SdkMessage = {
  type?: string;
  subtype?: string;
  is_error?: boolean;
  message?: { content?: unknown };
  content?: unknown;
  result?: unknown;
};

export type SdkToolResult = {
  content: Array<{ type: "text"; text: string }>;
};

export type AgentSdk = {
  query: (args: {
    prompt: AsyncIterable<unknown> | string;
    options: Record<string, unknown>;
  }) => AsyncIterable<SdkMessage>;
  tool: (
    name: string,
    description: string,
    inputSchema: Record<string, unknown>,
    handler: (
      args: Record<string, unknown>,
      extra: unknown
    ) => Promise<SdkToolResult>
  ) => unknown;
  createSdkMcpServer: (options: {
    name: string;
    version?: string;
    tools: unknown[];
  }) => unknown;
};

let cached: AgentSdk | null = null;

export async function loadAgentSdk(): Promise<AgentSdk> {
  if (!cached) {
    cached = (await import(
      "@anthropic-ai/claude-agent-sdk"
    )) as unknown as AgentSdk;
  }
  return cached;
}
