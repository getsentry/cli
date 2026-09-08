/**
 * Helpers shared by more than one task.
 *
 * Several v11 changes are "delete an option from `Sentry.init()`" with nothing
 * framework-specific about them, so the mechanics live here once and the tasks
 * stay a declaration of *which* option and *why*.
 */

import type {
  File,
  Node,
  ObjectExpression,
  ObjectProperty,
} from "@babel/types";
import { locate, type ScriptContext, type TaskApi } from "../../../api.js";
import {
  callOptions,
  collect,
  findProperty,
  findSentryCalls,
  findSentryInitOptions,
  importedName,
  isIdentifier,
  isImportDeclaration,
  isStringLiteral,
  rangeOf,
  sentryNamespaceBindings,
  walk,
} from "../../../ast.js";
import { removeEntries, replaceNode } from "../../../edits.js";
import type { Edit } from "../../../types.js";

/**
 * The v10 escape hatch for unreleased options. Several removed options could
 * live either at the top level or nested here, so every option task has to
 * check both.
 */
export const EXPERIMENTS = "_experiments";

export type OptionRemoval = {
  /** Option name, checked at the top level and inside `_experiments`. */
  key: string;
  /** Shown in CLI output and in the migration report. */
  message: string;
};

/** What a task hands to a per-file helper: the API plus the parsed file. */
export type TaskFile = ScriptContext & { api: TaskApi };

/**
 * Remove options from every `Sentry.init()` call in one file.
 *
 * When the last remaining key is removed from `_experiments`, the now-empty
 * `_experiments` object goes too. Leaving `_experiments: {}` behind is a
 * migration that technically worked and visibly did not.
 */
export function removeInitOptions(
  context: TaskFile,
  removals: OptionRemoval[]
): Edit[] {
  const edits: Edit[] = [];
  for (const options of findSentryInitOptions(context.ast)) {
    edits.push(...removeFromInit(context, options, removals));
  }
  return edits;
}

/**
 * Remove several options from one `Sentry.init()` object.
 *
 * Every removal against one object is decided together rather than one at a
 * time, because entries of the same list interact: two adjacent options each
 * need a separator, and only `removeEntries` can hand out the one comma
 * between them. See its docstring.
 */
function removeFromInit(
  { api, file, source }: TaskFile,
  options: ObjectExpression,
  removals: OptionRemoval[]
): Edit[] {
  const experiments = findProperty(options, EXPERIMENTS);
  const nestedHolder = objectValueOf(experiments);

  const fromOptions: ObjectProperty[] = [];
  const fromExperiments: ObjectProperty[] = [];

  for (const removal of removals) {
    const direct = findProperty(options, removal.key);
    if (direct) {
      fromOptions.push(direct);
      api.fixed(removal.message, locate(file, source, direct));
    }

    const nested = nestedHolder
      ? findProperty(nestedHolder, removal.key)
      : null;
    if (nested) {
      fromExperiments.push(nested);
      api.fixed(
        `${removal.message} (was under \`${EXPERIMENTS}\`)`,
        locate(file, source, nested)
      );
    }
  }

  return collapse(source, options, {
    experiments,
    nestedHolder,
    fromOptions,
    fromExperiments,
  });
}

/** The object literal a property holds, when it holds one. */
function objectValueOf(
  property: ObjectProperty | null
): ObjectExpression | null {
  return property?.value.type === "ObjectExpression" ? property.value : null;
}

/**
 * Turn a set of doomed properties into edits, taking any container they empty
 * with them.
 *
 * Removing the last key from `_experiments` should take `_experiments` too,
 * and emptying the options object should collapse it to `{}` rather than leave
 * `{\n  }` behind. Neither is cosmetic: a migration that leaves visible debris
 * reads as one that half-worked.
 */
function collapse(
  source: string,
  options: ObjectExpression,
  targets: {
    experiments: ObjectProperty | null;
    nestedHolder: ObjectExpression | null;
    fromOptions: ObjectProperty[];
    fromExperiments: ObjectProperty[];
  }
): Edit[] {
  const { experiments, nestedHolder, fromOptions, fromExperiments } = targets;

  if (fromOptions.length === 0 && fromExperiments.length === 0) {
    return [];
  }

  const emptiesExperiments =
    nestedHolder !== null &&
    fromExperiments.length === nestedHolder.properties.length;

  const doomed =
    emptiesExperiments && experiments
      ? [...fromOptions, experiments]
      : fromOptions;

  if (doomed.length === options.properties.length) {
    return [replaceNode(options, "{}")];
  }

  return [
    ...removeEntries(source, options.properties, doomed),
    ...(emptiesExperiments || !nestedHolder
      ? []
      : removeEntries(source, nestedHolder.properties, fromExperiments)),
  ];
}

/**
 * Rewrite module specifier strings, using a mapper.
 *
 * Covers `import`, `export … from` and `require()` in one pass, because a
 * project that uses CommonJS in one file and ESM in another is ordinary rather
 * than exotic.
 */
export function rewriteModuleSources(
  { api, file, source, ast }: TaskFile,
  rewrite: (specifier: string) => string | null,
  describe: (from: string, to: string) => string
): Edit[] {
  const edits: Edit[] = [];

  for (const target of moduleSpecifiers(ast)) {
    const replacement = rewrite(target.value);
    if (replacement === null || replacement === target.value) {
      continue;
    }
    edits.push(replaceNode(target.node, JSON.stringify(replacement)));
    api.fixed(
      describe(target.value, replacement),
      locate(file, source, target.node)
    );
  }

  return edits;
}

/** Every module-specifier string node in a file, in source order. */
export function moduleSpecifiers(
  ast: File
): Array<{ node: Node; value: string }> {
  const found: Array<{ node: Node; value: string }> = [];
  walk(ast, (node) => {
    const target = moduleSpecifier(node);
    if (target) {
      found.push(target);
    }
  });
  return found;
}

/** The module-specifier string node of an import, re-export or require. */
export function moduleSpecifier(
  node: Node
): { node: Node; value: string } | null {
  if (
    (node.type === "ImportDeclaration" ||
      node.type === "ExportNamedDeclaration" ||
      node.type === "ExportAllDeclaration") &&
    node.source
  ) {
    return { node: node.source, value: node.source.value };
  }

  if (
    node.type === "CallExpression" &&
    node.callee.type === "Identifier" &&
    node.callee.name === "require"
  ) {
    const first = node.arguments[0];
    if (first && isStringLiteral(first)) {
      return { node: first, value: first.value };
    }
  }

  return null;
}

/**
 * Move named imports of `symbols` from one module to another.
 *
 * When every specifier in a declaration moves, the specifier list stays put and
 * only the module string changes. When some stay behind, a second import is
 * added above and the moved specifiers are removed from the original, copying
 * their own source text so a local alias survives.
 */
export function moveSpecifiers(
  { api, file, source, ast }: TaskFile,
  config: {
    from: string;
    to: string;
    symbols: Set<string>;
    /** Overrides the default finding message, given the moved export names. */
    describe?: (moved: string[]) => string;
  }
): Edit[] {
  const edits: Edit[] = [];

  for (const declaration of collect(ast, isImportDeclaration)) {
    if (declaration.source.value !== config.from) {
      continue;
    }

    const moving = declaration.specifiers.filter(
      (specifier) =>
        specifier.type === "ImportSpecifier" &&
        config.symbols.has(importedName(specifier.imported))
    );

    if (moving.length === 0) {
      continue;
    }

    if (moving.length === declaration.specifiers.length) {
      edits.push(replaceNode(declaration.source, JSON.stringify(config.to)));
    } else {
      // Removals from one specifier list have to be decided together. See
      // `removeEntries`. Preserve local aliases by copying each specifier's
      // own source text rather than rebuilding it from the exported name.
      edits.push(...removeEntries(source, declaration.specifiers, moving));
      const moved = moving
        .map((specifier) => {
          const { start, end } = rangeOf(specifier);
          return source.slice(start, end);
        })
        .join(", ");
      const at = rangeOf(declaration).start;
      edits.push({
        start: at,
        end: at,
        text: `import { ${moved} } from ${JSON.stringify(config.to)};\n`,
      });
    }

    const names = moving.map((specifier) =>
      specifier.type === "ImportSpecifier"
        ? importedName(specifier.imported)
        : ""
    );
    api.fixed(
      config.describe?.(names) ??
        `moved ${moving.length} import(s) from \`${config.from}\` to \`${config.to}\``,
      locate(file, source, declaration)
    );
  }

  return edits;
}

/**
 * Identifiers that name something rather than reference a binding: the `foo`
 * in `x.foo`, in `{ foo: 1 }`, and the public half of `export { local as foo }`.
 *
 * Renaming these would rewrite an unrelated object's key or silently change
 * this module's own public API. The shorthand forms `{ foo }` and
 * `export { foo }` are left out, because there the same identifier is also the
 * reference, and Babel reports it twice over one range.
 */
function namingIdentifiers(ast: File): Set<Node> {
  const naming = new Set<Node>();

  walk(ast, (node) => {
    if (
      node.type === "MemberExpression" &&
      !node.computed &&
      node.property.type === "Identifier"
    ) {
      naming.add(node.property);
    }
    if (
      (node.type === "ObjectProperty" || node.type === "ObjectMethod") &&
      !node.computed &&
      node.key.type === "Identifier"
    ) {
      naming.add(node.key);
    }
    if (
      node.type === "ExportSpecifier" &&
      node.exported.start !== node.local.start
    ) {
      naming.add(node.exported);
    }
  });

  return naming;
}

/** `Sentry.<name>` accesses, where `Sentry` is bound to a Sentry package. */
function namespacedAccesses(
  ast: File,
  name: string,
  namespaces: Set<string>
): Set<Node> {
  const found = new Set<Node>();

  walk(ast, (node) => {
    if (
      node.type === "MemberExpression" &&
      !node.computed &&
      node.property.type === "Identifier" &&
      node.property.name === name &&
      node.object.type === "Identifier" &&
      namespaces.has(node.object.name)
    ) {
      found.add(node.property);
    }
  });

  return found;
}

/**
 * Rename an exported symbol and every reference to it.
 *
 * Only bare references to a binding this file imported from Sentry are
 * renamed, plus member accesses on a Sentry namespace. An identifier that
 * merely shares the name is left alone. A project is free to have its own
 * `inboundFiltersIntegration` key on an unrelated object, and rewriting it
 * would break code the migration was never asked to touch. That is why the
 * rename is anchored on an import: without one, nothing in the file refers to
 * the Sentry export at all.
 */
export function renameSentryExport(
  { api, file, source, ast }: TaskFile,
  from: string,
  to: string
): Edit[] {
  const edits: Edit[] = [];
  const claimed = new Set<Node>();
  const naming = namingIdentifiers(ast);
  const namespaced = namespacedAccesses(
    ast,
    from,
    sentryNamespaceBindings(ast)
  );
  let renamedBinding = false;

  walk(ast, (node) => {
    if (
      node.type !== "ImportSpecifier" ||
      importedName(node.imported) !== from
    ) {
      return;
    }

    claimed.add(node.imported);
    claimed.add(node.local);

    // Babel gives the shorthand `{ name }` two nodes over one range; replacing
    // the specifier once covers both.
    if (node.imported.start === node.local.start) {
      edits.push(replaceNode(node, to));
      renamedBinding = true;
    } else {
      edits.push(replaceNode(node.imported, to));
    }
    api.fixed(`\`${from}\` → \`${to}\``, locate(file, source, node));
  });

  for (const identifier of collect(ast, isIdentifier)) {
    if (identifier.name !== from || claimed.has(identifier)) {
      continue;
    }
    if (
      namespaced.has(identifier) ||
      (renamedBinding && !naming.has(identifier))
    ) {
      edits.push(replaceNode(identifier, to));
    }
  }

  return edits;
}

export type IntegrationOptionRemoval = {
  /** Option name, checked at the top level and inside `_experiments`. */
  option: string;
  /** Shown in CLI output and in the migration report. */
  message: string;
  /**
   * Receives the removed property, so a task can read the value it carried
   * before it disappears. Several v11 changes move an option's value into a
   * different integration rather than dropping it.
   */
  onFound?: (property: ObjectProperty, options: ObjectExpression) => void;
};

/**
 * Remove options from every call to one of `integrations`.
 *
 * Takes the full list of options rather than one at a time because two of them
 * may be adjacent entries of the same object literal, and adjacent removals
 * have to be decided together. See `removeEntries`.
 */
export function removeIntegrationOptions(
  context: TaskFile,
  config: {
    integrations: string[];
    options: IntegrationOptionRemoval[];
  }
): Edit[] {
  const { ast } = context;
  const edits: Edit[] = [];
  const visited = new Set<ObjectExpression>();

  for (const name of config.integrations) {
    for (const call of findSentryCalls(ast, name)) {
      const options = callOptions(call);
      if (options && !visited.has(options)) {
        visited.add(options);
        edits.push(...removeFromOptions(context, options, config.options));
      }
    }
  }

  return edits;
}

/** Remove options from a single integration's options object. */
function removeFromOptions(
  { api, file, source }: TaskFile,
  options: ObjectExpression,
  removals: IntegrationOptionRemoval[]
): Edit[] {
  const experiments = findProperty(options, EXPERIMENTS);
  const nestedHolder = objectValueOf(experiments);

  const fromOptions: ObjectProperty[] = [];
  const fromExperiments: ObjectProperty[] = [];

  for (const removal of removals) {
    // The option may sit at the top level or under `_experiments`.
    for (const [holder, doomed] of [
      [options, fromOptions],
      [nestedHolder, fromExperiments],
    ] as const) {
      const property = holder ? findProperty(holder, removal.option) : null;
      if (!property) {
        continue;
      }
      removal.onFound?.(property, options);
      doomed.push(property);
      api.fixed(removal.message, locate(file, source, property));
    }
  }

  return collapse(source, options, {
    experiments,
    nestedHolder,
    fromOptions,
    fromExperiments,
  });
}
