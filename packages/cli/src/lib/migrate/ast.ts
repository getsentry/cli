/**
 * Parsing and AST helpers for migration tasks.
 *
 * Tasks operate on byte ranges rather than on a mutable AST. Every helper here
 * either finds nodes or produces an `Edit` describing a replacement. Only
 * touched bytes change, so a migration of a 400-line config file reads as the
 * four lines it actually altered. Same model as `codemods/sentry-v3-to-v4`.
 *
 * ### Why @babel/parser
 *
 * The CLI publishes with zero runtime dependencies and bundles everything at
 * build time, so parser size lands directly in the shipped artifact. Measured
 * with the repo's own esbuild config, the TypeScript compiler API bundles to
 * 3.40 MB and `@babel/parser` to 0.29 MB. Every task here is syntactic and
 * needs no type information, so that 12x buys nothing. `@babel/parser` also
 * has no transitive dependencies and reports exact `start`/`end` offsets on
 * every node, which is the edit model already.
 */

import { parse } from "@babel/parser";
import type {
  CallExpression,
  File,
  Identifier,
  ImportDeclaration,
  Node,
  ObjectExpression,
  ObjectMethod,
  ObjectProperty,
  StringLiteral,
} from "@babel/types";

/** Every extension a migration will attempt to parse as a script. */
export const JS_EXTENSIONS = [
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
] as const;

/** Node keys that hold metadata rather than child nodes. */
const SKIP_KEYS = new Set([
  "loc",
  "leadingComments",
  "trailingComments",
  "innerComments",
  "comments",
  "tokens",
  "errors",
  "extra",
]);

function isNode(value: unknown): value is Node {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { type?: unknown }).type === "string"
  );
}

/**
 * Parse a source file, returning `null` when it cannot be parsed.
 *
 * A migration run walks whatever the user has, which routinely includes files
 * this parser will not accept: Vue SFCs renamed to `.ts`, Flow, experimental
 * proposals, build output. Those get skipped and reported. A crash halfway
 * through would leave a partially migrated tree.
 */
export function parseSource(filename: string, source: string): File | null {
  // `.ts` and `.tsx` disagree about `<T>`: in `.ts` it is a type assertion or
  // a generic, in `.tsx` it opens an element. Enabling both plugins makes the
  // parser reject valid `.ts` generics, so pick by extension.
  const jsx = !(
    filename.endsWith(".ts") ||
    filename.endsWith(".mts") ||
    filename.endsWith(".cts")
  );

  try {
    return parse(source, {
      // Lets a CommonJS `instrument.cjs` and an ESM `instrument.mjs` both
      // parse without the caller having to know which it is.
      sourceType: "unambiguous",
      allowReturnOutsideFunction: true,
      plugins: jsx ? ["typescript", "jsx"] : ["typescript"],
    });
  } catch {
    return null;
  }
}

/** Depth-first walk over every node in the tree. */
export function walk(root: Node, visit: (node: Node) => void): void {
  visit(root);
  for (const key of Object.keys(root)) {
    if (SKIP_KEYS.has(key)) {
      continue;
    }
    const value = (root as unknown as Record<string, unknown>)[key];
    if (Array.isArray(value)) {
      for (const child of value) {
        if (isNode(child)) {
          walk(child, visit);
        }
      }
    } else if (isNode(value)) {
      walk(value, visit);
    }
  }
}

export function collect<T extends Node>(
  root: Node,
  predicate: (node: Node) => node is T
): T[] {
  const found: T[] = [];
  walk(root, (node) => {
    if (predicate(node)) {
      found.push(node);
    }
  });
  return found;
}

/** 1-indexed line number for a byte offset. */
export function lineAt(source: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < source.length; i++) {
    if (source[i] === "\n") {
      line += 1;
    }
  }
  return line;
}

/**
 * Byte range of a node. Babel marks `start`/`end` optional because they are
 * absent on synthesised nodes. Everything here comes from the parser, so they
 * are always present.
 */
export function rangeOf(node: Node): { start: number; end: number } {
  return { start: node.start ?? 0, end: node.end ?? 0 };
}

export const isImportDeclaration = (node: Node): node is ImportDeclaration =>
  node.type === "ImportDeclaration";

export const isCallExpression = (node: Node): node is CallExpression =>
  node.type === "CallExpression";

export const isStringLiteral = (node: Node): node is StringLiteral =>
  node.type === "StringLiteral";

export const isObjectExpression = (node: Node): node is ObjectExpression =>
  node.type === "ObjectExpression";

/** The static name of an object property key, or `null` if computed. */
export function propertyName(property: Node): string | null {
  if (property.type !== "ObjectProperty" && property.type !== "ObjectMethod") {
    return null;
  }
  if (property.computed) {
    return null;
  }
  const key = property.key;
  if (key.type === "Identifier") {
    return key.name;
  }
  if (key.type === "StringLiteral") {
    return key.value;
  }
  return null;
}

/**
 * Find a non-computed property or method by name.
 *
 * `findProperty` returns only `ObjectProperty`, because nearly every caller
 * immediately reads `.value`. A *callback* option is the exception: it is as
 * likely to be written `beforeSendMetric(metric) { … }` as
 * `beforeSendMetric: (metric) => …`, and a task that sees only the second
 * silently ignores half of real configs.
 */
export function findMember(
  object: ObjectExpression,
  name: string
): ObjectProperty | ObjectMethod | null {
  for (const property of object.properties) {
    if (
      (property.type === "ObjectProperty" ||
        property.type === "ObjectMethod") &&
      propertyName(property) === name
    ) {
      return property;
    }
  }
  return null;
}

/** Find a non-computed property by name on an object literal. */
export function findProperty(
  object: ObjectExpression,
  name: string
): ObjectProperty | null {
  for (const property of object.properties) {
    if (property.type === "ObjectProperty" && propertyName(property) === name) {
      return property;
    }
  }
  return null;
}

/**
 * `require("...")` source, or `null` if this is not a literal require call.
 */
function requireSource(node: CallExpression): string | null {
  if (node.callee.type !== "Identifier" || node.callee.name !== "require") {
    return null;
  }
  const first = node.arguments[0];
  return first && isStringLiteral(first) ? first.value : null;
}

const SENTRY_PACKAGE = /^@sentry\//;

/**
 * Local binding names that refer to a Sentry namespace: `import * as Sentry`,
 * `import Sentry from`, or `const Sentry = require(...)`.
 */
export function sentryNamespaceBindings(ast: File): Set<string> {
  const names = new Set<string>();

  walk(ast, (node) => {
    const name = namespaceBindingOf(node);
    if (name !== null) {
      names.add(name);
    }
  });

  return names;
}

/** The Sentry namespace name a node binds, if it binds one. */
function namespaceBindingOf(node: Node): string | null {
  if (isImportDeclaration(node) && SENTRY_PACKAGE.test(node.source.value)) {
    for (const specifier of node.specifiers) {
      if (
        specifier.type === "ImportNamespaceSpecifier" ||
        specifier.type === "ImportDefaultSpecifier"
      ) {
        return specifier.local.name;
      }
    }
    return null;
  }

  if (
    node.type !== "VariableDeclarator" ||
    node.id.type !== "Identifier" ||
    !node.init ||
    !isCallExpression(node.init)
  ) {
    return null;
  }

  const source = requireSource(node.init);
  return source && SENTRY_PACKAGE.test(source) ? node.id.name : null;
}

/** Local names bound to a named export of a `@sentry/*` package. */
export function sentryNamedBindings(ast: File, exported: string): Set<string> {
  const names = new Set<string>();

  walk(ast, (node) => {
    if (
      !(isImportDeclaration(node) && SENTRY_PACKAGE.test(node.source.value))
    ) {
      return;
    }
    for (const specifier of node.specifiers) {
      if (
        specifier.type === "ImportSpecifier" &&
        importedName(specifier.imported) === exported
      ) {
        names.add(specifier.local.name);
      }
    }
  });

  return names;
}

/**
 * The exported name a specifier refers to. Babel allows a string literal here
 * (`import { "a-b" as ab }`), so both shapes have to be handled everywhere a
 * specifier is matched by name.
 */
export function importedName(node: Identifier | StringLiteral): string {
  return node.type === "Identifier" ? node.name : node.value;
}

export const isIdentifier = (node: Node): node is Identifier =>
  node.type === "Identifier";

/**
 * Every options object literal passed to `Sentry.init(...)`.
 *
 * Covers `Sentry.init({...})`, a named `init({...})` imported from a Sentry
 * package, and the `require`-bound equivalents. A call whose argument is not
 * an inline object literal, such as `Sentry.init(buildOptions())`, is left
 * out. There is nothing to edit at the call site, and following the reference
 * would take type information the engine does not have. A task that cares
 * about that case detects it separately and annotates.
 */
export function findSentryInitOptions(ast: File): ObjectExpression[] {
  const namespaces = sentryNamespaceBindings(ast);
  const bareInit = sentryNamedBindings(ast, "init");
  const found: ObjectExpression[] = [];

  walk(ast, (node) => {
    if (!(isCallExpression(node) && isInitCall(node, namespaces, bareInit))) {
      return;
    }
    const first = node.arguments[0];
    if (first && isObjectExpression(first)) {
      found.push(first);
    }
  });

  return found;
}

/** `Sentry.init(...)` or a bare `init(...)` bound to a Sentry package. */
function isInitCall(
  call: CallExpression,
  namespaces: Set<string>,
  bareInit: Set<string>
): boolean {
  const callee = call.callee;

  if (callee.type === "Identifier") {
    return bareInit.has(callee.name);
  }

  return (
    callee.type === "MemberExpression" &&
    !callee.computed &&
    callee.property.type === "Identifier" &&
    callee.property.name === "init" &&
    callee.object.type === "Identifier" &&
    namespaces.has(callee.object.name)
  );
}

/**
 * Calls to a Sentry export, whichever way it was brought into scope.
 *
 * Integrations are called both as `Sentry.browserTracingIntegration()` and as
 * a bare `browserTracingIntegration()` after a named import. A task that
 * handles only one form silently misses half of real configurations.
 */
export function findSentryCalls(ast: File, exported: string): CallExpression[] {
  const namespaces = sentryNamespaceBindings(ast);
  const locals = sentryNamedBindings(ast, exported);

  return collect(ast, isCallExpression).filter((call) => {
    const callee = call.callee;
    if (callee.type === "Identifier") {
      return locals.has(callee.name);
    }
    return (
      callee.type === "MemberExpression" &&
      !callee.computed &&
      callee.property.type === "Identifier" &&
      callee.property.name === exported &&
      callee.object.type === "Identifier" &&
      namespaces.has(callee.object.name)
    );
  });
}

/** The options object literal of a call, or `null` when it has none. */
export function callOptions(call: CallExpression): ObjectExpression | null {
  const first = call.arguments[0];
  return first && isObjectExpression(first) ? first : null;
}

/**
 * Call expressions to a named function imported from any package, keyed by
 * the *exported* name. Used for framework wrappers such as
 * `withSentryConfig` and `sentrySvelteKit`, which are not namespaced.
 */
export function findCallsTo(ast: File, exported: string): CallExpression[] {
  const locals = new Set<string>();

  walk(ast, (node) => {
    if (isImportDeclaration(node)) {
      for (const specifier of node.specifiers) {
        if (
          specifier.type === "ImportSpecifier" &&
          importedName(specifier.imported) === exported
        ) {
          locals.add(specifier.local.name);
        } else if (
          specifier.type === "ImportDefaultSpecifier" &&
          specifier.local.name === exported
        ) {
          locals.add(specifier.local.name);
        }
      }
    }
  });

  // A wrapper may also be pulled straight off a require, or simply be in
  // scope in a plain-JS config. Falling back to the bare name is safe here
  // because these names are highly specific to Sentry.
  locals.add(exported);

  return collect(ast, isCallExpression).filter(
    (call) => call.callee.type === "Identifier" && locals.has(call.callee.name)
  );
}
