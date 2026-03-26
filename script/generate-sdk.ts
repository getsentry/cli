#!/usr/bin/env bun
/**
 * Generate typed SDK methods from the Stricli command tree.
 *
 * Walks the route tree via introspection, extracts flag definitions,
 * and generates src/sdk.generated.ts with typed parameter interfaces
 * and method implementations that call invokeCommand() directly.
 *
 * Run: bun run generate:sdk
 */

import { routes } from "../src/app.js";
import {
  type Command,
  type FlagDef,
  isCommand,
} from "../src/lib/introspect.js";

// ---------------------------------------------------------------------------
// SDK Command Configuration
// ---------------------------------------------------------------------------

/**
 * Positional argument handling config.
 * - `null` — no positional arg
 * - `{ name, required? }` — single named positional
 * - `{ format, params }` — composite positional (e.g., "{org}/{project}")
 */
type PositionalConfig =
  | null
  | { name: string; required?: boolean }
  | { format: string; params: string[] };

/** Configuration for a single SDK command. */
type SDKCommandConfig = {
  /** CLI command path segments */
  path: string[];
  /** SDK namespace (e.g., "organizations") */
  namespace: string;
  /** SDK method name (e.g., "list") */
  method: string;
  /** TypeScript return type string */
  returnType: string;
  /** How to handle positional args */
  positional: PositionalConfig;
  /** Extra type imports needed for the return type */
  typeImports?: string[];
};

const SDK_COMMANDS: SDKCommandConfig[] = [
  // Organizations
  {
    path: ["org", "list"],
    namespace: "organizations",
    method: "list",
    returnType: "SentryOrganization[]",
    positional: null,
    typeImports: ["SentryOrganization"],
  },
  {
    path: ["org", "view"],
    namespace: "organizations",
    method: "get",
    returnType: "SentryOrganization",
    positional: { name: "org", required: false },
    typeImports: ["SentryOrganization"],
  },
  // Projects
  {
    path: ["project", "list"],
    namespace: "projects",
    method: "list",
    returnType:
      "{ data: SentryProject[]; hasMore: boolean; nextCursor?: string }",
    positional: { name: "target", required: false },
    typeImports: ["SentryProject"],
  },
  {
    path: ["project", "view"],
    namespace: "projects",
    method: "get",
    returnType: "SentryProject[]",
    positional: { name: "target", required: false },
    typeImports: ["SentryProject"],
  },
  // Issues
  {
    path: ["issue", "list"],
    namespace: "issues",
    method: "list",
    returnType:
      "{ data: SentryIssue[]; hasMore: boolean; nextCursor?: string }",
    positional: {
      format: "{org}/{project}",
      params: ["org", "project"],
    },
    typeImports: ["SentryIssue"],
  },
  {
    path: ["issue", "view"],
    namespace: "issues",
    method: "get",
    returnType: "SentryIssue & { event: SentryEvent | null }",
    positional: { name: "issueId", required: true },
    typeImports: ["SentryIssue", "SentryEvent"],
  },
  // Events
  {
    path: ["event", "view"],
    namespace: "events",
    method: "get",
    returnType: "SentryEvent",
    positional: { name: "eventId", required: true },
    typeImports: ["SentryEvent"],
  },
  // Traces
  {
    path: ["trace", "list"],
    namespace: "traces",
    method: "list",
    returnType:
      "{ data: TransactionListItem[]; hasMore: boolean; nextCursor?: string }",
    positional: { name: "target", required: false },
    typeImports: ["TransactionListItem"],
  },
  {
    path: ["trace", "view"],
    namespace: "traces",
    method: "get",
    returnType:
      "{ traceId: string; duration: number; spanCount: number; spans: TraceSpan[] }",
    positional: { name: "traceId", required: true },
    typeImports: ["TraceSpan"],
  },
  // Spans
  {
    path: ["span", "list"],
    namespace: "spans",
    method: "list",
    returnType:
      "{ data: SpanListItem[]; hasMore: boolean; nextCursor?: string }",
    positional: { name: "target", required: false },
    typeImports: ["SpanListItem"],
  },
  // Teams
  {
    path: ["team", "list"],
    namespace: "teams",
    method: "list",
    returnType: "{ data: SentryTeam[]; hasMore: boolean; nextCursor?: string }",
    positional: { name: "target", required: false },
    typeImports: ["SentryTeam"],
  },
];

/** Flags that are internal to the CLI framework — never exposed as SDK params */
const INTERNAL_FLAGS = new Set([
  "json",
  "web",
  "fresh",
  "compact",
  "log-level",
  "verbose",
  "fields",
]);

// ---------------------------------------------------------------------------
// Introspection
// ---------------------------------------------------------------------------

/**
 * Resolve a command from the route tree by path.
 *
 * Uses Stricli's `getRoutingTargetForInput` which exists on the runtime
 * RouteMap objects but isn't in our simplified introspect.ts types.
 */
function resolveCommandFromRoutes(path: string[]): Command {
  // biome-ignore lint/suspicious/noExplicitAny: Stricli runtime route objects have getRoutingTargetForInput
  let target: any = routes;
  for (const segment of path) {
    if (!target || typeof target.getRoutingTargetForInput !== "function") {
      throw new Error(`Expected route map at ${segment}`);
    }
    target = target.getRoutingTargetForInput(segment);
    if (!target) {
      throw new Error(`Command not found: ${path.join(" ")}`);
    }
  }
  if (!isCommand(target)) {
    throw new Error(`Not a command: ${path.join(" ")}`);
  }
  return target as Command;
}

/** Extracted SDK flag info. */
type SdkFlagInfo = {
  name: string;
  kind: "boolean" | "parsed" | "enum";
  tsType: string;
  optional: boolean;
  default?: unknown;
  brief?: string;
  values?: string[];
};

/** Infer the TypeScript type for a single flag definition. */
function inferFlagType(def: FlagDef): {
  tsType: string;
  kind: SdkFlagInfo["kind"];
  values?: string[];
} {
  if (def.kind === "boolean") {
    return { tsType: "boolean", kind: "boolean" };
  }

  if (def.kind === "enum") {
    const enumDef = def as FlagDef & { values?: readonly string[] };
    if (enumDef.values) {
      const values = [...enumDef.values];
      const tsType = values.map((v: string) => `"${v}"`).join(" | ");
      return { tsType, kind: "enum", values };
    }
    return { tsType: "string", kind: "enum" };
  }

  // kind === "parsed" — infer from default value
  if (def.default !== undefined && typeof def.default === "number") {
    return { tsType: "number", kind: "parsed" };
  }
  if (def.default !== undefined && typeof def.default === "string") {
    const numVal = Number(def.default);
    if (!Number.isNaN(numVal) && def.default !== "") {
      return { tsType: "number", kind: "parsed" };
    }
  }
  return { tsType: "string", kind: "parsed" };
}

/** Extract SDK-relevant flag info from a Stricli Command's parameters. */
function extractSdkFlags(command: Command): SdkFlagInfo[] {
  const flagDefs = command.parameters?.flags;
  if (!flagDefs) {
    return [];
  }

  const flags: SdkFlagInfo[] = [];

  for (const [name, def] of Object.entries(flagDefs) as [string, FlagDef][]) {
    if (INTERNAL_FLAGS.has(name)) {
      continue;
    }
    if (def.hidden) {
      continue;
    }

    const { tsType, kind, values } = inferFlagType(def);
    const optional = def.optional === true || def.default !== undefined;

    flags.push({
      name,
      kind,
      tsType,
      optional,
      default: def.default,
      brief: def.brief,
      values,
    });
  }

  return flags;
}

// ---------------------------------------------------------------------------
// Code Generation
// ---------------------------------------------------------------------------

function generateParamsInterface(
  config: SDKCommandConfig,
  flags: SdkFlagInfo[]
): { name: string; code: string } {
  const interfaceName = `${capitalize(config.namespace)}${capitalize(config.method)}Params`;
  const lines: string[] = [];

  if (config.positional) {
    if ("format" in config.positional) {
      for (const param of config.positional.params) {
        lines.push(`  /** ${capitalize(param)} slug */`);
        lines.push(`  ${param}: string;`);
      }
    } else {
      const req = config.positional.required ? "" : "?";
      lines.push(`  /** ${capitalize(config.positional.name)} identifier */`);
      lines.push(`  ${config.positional.name}${req}: string;`);
    }
  }

  for (const flag of flags) {
    const opt = flag.optional ? "?" : "";
    if (flag.brief) {
      lines.push(`  /** ${flag.brief} */`);
    }
    lines.push(`  ${camelCase(flag.name)}${opt}: ${flag.tsType};`);
  }

  const code = `export type ${interfaceName} = {\n${lines.join("\n")}\n};`;
  return { name: interfaceName, code };
}

function generateMethodBody(
  config: SDKCommandConfig,
  flags: SdkFlagInfo[]
): string {
  const flagEntries = flags.map((f) => {
    const camel = camelCase(f.name);
    if (f.name !== camel) {
      return `"${f.name}": params?.${camel}`;
    }
    return `${f.name}: params?.${camel}`;
  });

  let positionalExpr = "[]";
  if (config.positional) {
    if ("format" in config.positional) {
      const template = config.positional.format.replace(
        /\{(\w+)\}/g,
        (_, p) => `\${params.${p}}`
      );
      positionalExpr = `[\`${template}\`]`;
    } else if (config.positional.required) {
      positionalExpr = `[params.${config.positional.name}]`;
    } else {
      positionalExpr = `params?.${config.positional.name} ? [params.${config.positional.name}] : []`;
    }
  }

  const flagObj =
    flagEntries.length > 0 ? `{ ${flagEntries.join(", ")} }` : "{}";

  return `invoke<${config.returnType}>(${JSON.stringify(config.path)}, ${flagObj}, ${positionalExpr})`;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function camelCase(s: string): string {
  return s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

/** Check if all positional params are optional for a given config. */
function isAllOptional(config: SDKCommandConfig): boolean {
  if (!config.positional) {
    return true;
  }
  if ("format" in config.positional) {
    return false;
  }
  return !config.positional.required;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const typeImports = new Set<string>();
const paramInterfaces: string[] = [];
const namespaces = new Map<string, string[]>();

for (const config of SDK_COMMANDS) {
  const command = resolveCommandFromRoutes(config.path);
  const flags = extractSdkFlags(command);

  const params = generateParamsInterface(config, flags);
  paramInterfaces.push(params.code);

  const allOptional = isAllOptional(config);
  const paramsArg = allOptional
    ? `params?: ${params.name}`
    : `params: ${params.name}`;

  const body = generateMethodBody(config, flags);
  const brief = command.brief || `${config.method} ${config.namespace}`;
  const methodCode = `    /** ${brief} */\n    ${config.method}: (${paramsArg}): Promise<${config.returnType}> =>\n      ${body},`;

  if (!namespaces.has(config.namespace)) {
    namespaces.set(config.namespace, []);
  }
  const methods = namespaces.get(config.namespace);
  if (methods) {
    methods.push(methodCode);
  }

  for (const t of config.typeImports ?? []) {
    typeImports.add(t);
  }
}

// Build output
const output = `// Auto-generated by script/generate-sdk.ts — DO NOT EDIT
// Run \`bun run generate:sdk\` to regenerate.

import type { buildInvoker } from "./lib/sdk-invoke.js";
import type {
  ${Array.from(typeImports).sort().join(",\n  ")},
} from "./types/index.js";

// --- Parameter types ---

${paramInterfaces.join("\n\n")}

// --- SDK factory ---

/** Invoke function type from sdk-invoke.ts */
type Invoke = ReturnType<typeof buildInvoker>;

/**
 * Create the typed SDK method tree.
 * Called by createSentrySDK() with a bound invoker.
 * @internal
 */
export function createSDKMethods(invoke: Invoke) {
  return {
${Array.from(namespaces.entries())
  .map(([ns, methods]) => `    ${ns}: {\n${methods.join("\n")}\n    },`)
  .join("\n")}
  };
}

/** Return type of createSDKMethods — the typed SDK interface. */
export type SentrySDK = ReturnType<typeof createSDKMethods>;
`;

const outPath = "./src/sdk.generated.ts";
await Bun.write(outPath, output);
console.log(`Generated ${outPath}`);
