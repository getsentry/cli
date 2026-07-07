/**
 * jscodeshift codemod: migrate the legacy `@sentry/cli` v3 Node wrapper
 * (`new SentryCli().releases.*`) to the v4 `sentry` package library API
 * (`createSentrySDK()`).
 *
 * Usage:
 *   npx jscodeshift -t codemods/sentry-v3-to-v4.cjs <path-to-your-src>
 *
 * What it does (mechanical, reliably):
 *   - Rewrites `import SentryCli from "@sentry/cli"` / `require("@sentry/cli")`
 *     to `import createSentrySDK from "sentry"` / `require("sentry")`.
 *   - Rewrites `new SentryCli(configFile, options)` to
 *     `createSentrySDK(options)` (drops the removed `configFile` arg, renames
 *     `authToken` → `token`).
 *   - Rewrites the release/sourcemap method chain:
 *       .releases.new(v)              → .release.create({ orgVersion: v })
 *       .releases.finalize(v)         → .release.finalize({ orgVersion: v })
 *       .releases.proposeVersion()    → .release["propose-version"]()
 *       .releases.setCommits(v, o)    → .release["set-commits"]({ orgVersion: v, ...o })
 *       .releases.uploadSourceMaps(v, o) → .sourcemap.upload({ release: v, ...o })
 *       .releases.newDeploy(v, o)     → .release.deploy({ orgVersionEnvironmentName: v, ...o })
 *       .execute(args)                → .run(...args)
 *
 * What it does NOT do (flagged with `// TODO(sentry-v4): ...`):
 *   - Fully remap option *names*. Several option shapes changed between the v3
 *     wrapper and the v4 SDK (e.g. `uploadSourceMaps({ include })` →
 *     `sourcemap.upload({ directory })`). The codemod spreads the old options
 *     object and leaves a TODO so you can review each call site.
 *
 * @param {{ path: string, source: string }} file - The file being transformed.
 * @param {{ jscodeshift: Function }} api - The jscodeshift API object.
 * @returns {string | undefined} The transformed source, or undefined if unchanged.
 */
"use strict";

/** Release-namespace method → [target route, target method] in the v4 SDK. */
const METHOD_MAP = {
  new: ["release", "create"],
  finalize: ["release", "finalize"],
  proposeVersion: ["release", "propose-version"],
  setCommits: ["release", "set-commits"],
  uploadSourceMaps: ["sourcemap", "upload"],
  newDeploy: ["release", "deploy"],
};

/** Methods whose first positional (a release/version) moves into the options object. */
const RESHAPE = {
  new: { key: "orgVersion" },
  finalize: { key: "orgVersion" },
  setCommits: { key: "orgVersion", spreadSecond: true, todo: "verify set-commits options (repo/commit/auto → commit/auto/local)" },
  uploadSourceMaps: { key: "release", spreadSecond: true, todo: "sourcemaps are debug-ID-first: map `include` → the `directory` positional and review options" },
  // Deploy is intentionally NOT spread: v4's `release.deploy` takes the
  // environment and name as part of the positional `orgVersionEnvironmentName`
  // (e.g. "org/version/env/name"), not as `env`/`name` option keys. Spreading
  // the v3 options would emit invalid params, so we flag it instead.
  newDeploy: { key: "orgVersionEnvironmentName", todo: "release.deploy: fold env/name into the positional target (org/version/env/name); pass url/started/finished/time as options" },
};

module.exports = function transform(file, api) {
  const j = api.jscodeshift;
  const root = j(file.source);
  let changed = false;

  /** Local identifiers bound to the SentryCli class (default import/require). */
  const sentryCliLocals = new Set(["SentryCli"]);

  /** Variable names bound to a SentryCli/SDK instance (e.g. `const cli = …`). */
  const instanceNames = new Set();

  /**
   * True when `node` is (or references) a Sentry CLI instance: a tracked
   * instance variable, an inline `createSentrySDK(...)` call, or an as-yet
   * unrewritten `new SentryCli(...)`. Used to avoid rewriting unrelated
   * `.execute()` / `.releases` members on foreign objects.
   */
  const isInstance = (node) =>
    (node.type === "Identifier" && instanceNames.has(node.name)) ||
    (node.type === "CallExpression" &&
      node.callee.type === "Identifier" &&
      node.callee.name === "createSentrySDK") ||
    (node.type === "NewExpression" &&
      node.callee.type === "Identifier" &&
      sentryCliLocals.has(node.callee.name));

  /** Build `obj.name` or, for non-identifier names, `obj["name"]` (computed). */
  const member = (obj, name) =>
    /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)
      ? j.memberExpression(obj, j.identifier(name), false)
      : j.memberExpression(obj, j.literal(name), true);

  /**
   * Attach a leading `// TODO(sentry-v4): <msg>` to the enclosing statement.
   * Matches both `*Statement` (e.g. ExpressionStatement) and `*Declaration`
   * (e.g. VariableDeclaration for `const cli = new SentryCli(…)`).
   */
  const addTodo = (path, msg) => {
    let p = path;
    while (p && !(p.node && /(Statement|Declaration)$/.test(p.node.type))) {
      p = p.parent;
    }
    const stmt = p && p.node;
    if (!stmt) {
      return;
    }
    stmt.comments = stmt.comments || [];
    stmt.comments.unshift(j.commentLine(` TODO(sentry-v4): ${msg}`, true, false));
  };

  // 1) Rewrite ESM import: import SentryCli from "@sentry/cli" → import createSentrySDK from "sentry"
  root
    .find(j.ImportDeclaration, { source: { value: "@sentry/cli" } })
    .forEach((path) => {
      changed = true;
      for (const spec of path.node.specifiers || []) {
        if (spec.type === "ImportDefaultSpecifier" && spec.local) {
          sentryCliLocals.add(spec.local.name);
        }
      }
      path.replace(
        j.importDeclaration(
          [j.importDefaultSpecifier(j.identifier("createSentrySDK"))],
          j.literal("sentry")
        )
      );
    });

  // 2) Rewrite CommonJS: const SentryCli = require("@sentry/cli") → const createSentrySDK = require("sentry")
  root
    .find(j.VariableDeclarator, {
      init: {
        type: "CallExpression",
        callee: { type: "Identifier", name: "require" },
        arguments: [{ value: "@sentry/cli" }],
      },
    })
    .forEach((path) => {
      changed = true;
      path.node.init.arguments[0] = j.literal("sentry");
      if (path.node.id.type === "Identifier") {
        sentryCliLocals.add(path.node.id.name);
        path.node.id = j.identifier("createSentrySDK");
      }
    });

  // 3) Rewrite `new SentryCli(configFile?, options?)` → `createSentrySDK(options?)`
  root.find(j.NewExpression).forEach((path) => {
    const callee = path.node.callee;
    if (callee.type !== "Identifier" || !sentryCliLocals.has(callee.name)) {
      return;
    }
    changed = true;
    // Record the variable this instance is bound to, so later passes only
    // rewrite `.execute()` / `.releases.*` on genuine SDK instances.
    const parent = path.parent && path.parent.node;
    if (parent) {
      if (parent.type === "VariableDeclarator" && parent.id.type === "Identifier") {
        instanceNames.add(parent.id.name);
      } else if (
        parent.type === "AssignmentExpression" &&
        parent.left.type === "Identifier"
      ) {
        instanceNames.add(parent.left.name);
      }
    }
    const args = path.node.arguments;
    // The v3 constructor is (configFile, options); v4 takes just options.
    let options = null;
    let ambiguous = false;
    if (args.length >= 2) {
      // (configFile, options) — drop configFile, keep options.
      options = args[1];
    } else if (args.length === 1) {
      if (args[0].type === "ObjectExpression") {
        // A lone object is options (the v3 configFile is always a string/null).
        options = args[0];
      } else {
        // A lone non-object arg is ambiguous: v3's first param is a configFile
        // path (dropped in v4), but it may be an options variable. Preserve it
        // rather than silently dropping the user's config, and flag it.
        options = args[0];
        ambiguous = true;
      }
    }
    if (options && options.type === "ObjectExpression") {
      for (const prop of options.properties) {
        if (prop.key && (prop.key.name === "authToken" || prop.key.value === "authToken")) {
          prop.key = j.identifier("token");
        }
      }
    }
    path.replace(
      j.callExpression(j.identifier("createSentrySDK"), options ? [options] : [])
    );
    if (ambiguous) {
      addTodo(
        path,
        "verify this argument: v3's first constructor param was a configFile path (removed in v4); v4 takes an options object. Drop it if it's a config path, or map authToken→token if it's options"
      );
    }
  });

  // 4) Rewrite method chains: `<recv>.releases.<method>(...)` and `<recv>.execute(...)`
  root.find(j.CallExpression).forEach((path) => {
    const callee = path.node.callee;
    if (callee.type !== "MemberExpression" || callee.computed) {
      return;
    }
    const methodName = callee.property.name;

    // 4a) `<recv>.execute(args, live)` → `<recv>.run(...args)`
    // Gated on a known SDK instance so we never touch unrelated `.execute()`
    // APIs (DB clients, query builders, etc.).
    if (methodName === "execute" && isInstance(callee.object)) {
      const recv = callee.object;
      const first = path.node.arguments[0];
      let runArgs;
      if (first && first.type === "ArrayExpression") {
        runArgs = first.elements;
      } else if (first) {
        runArgs = [j.spreadElement(first)];
      } else {
        runArgs = [];
      }
      path.replace(
        j.callExpression(j.memberExpression(recv, j.identifier("run")), runArgs)
      );
      changed = true;
      return;
    }

    // 4b) `<recv>.releases.<method>(...)`
    const obj = callee.object;
    if (
      obj.type !== "MemberExpression" ||
      obj.computed ||
      obj.property.name !== "releases" ||
      !METHOD_MAP[methodName] ||
      !isInstance(obj.object)
    ) {
      return;
    }
    changed = true;
    const recv = obj.object; // the sdk instance expression
    const [route, target] = METHOD_MAP[methodName];
    const args = path.node.arguments;
    const reshape = RESHAPE[methodName];

    let callArgs = [];
    if (reshape) {
      const props = [];
      if (args[0]) {
        props.push(j.property("init", j.identifier(reshape.key), args[0]));
      }
      if (reshape.spreadSecond && args[1]) {
        // Inline the properties of an object literal for clean output;
        // spread anything else (variable, call, etc.).
        if (args[1].type === "ObjectExpression") {
          props.push(...args[1].properties);
        } else {
          props.push(j.spreadElement(args[1]));
        }
      }
      callArgs = [j.objectExpression(props)];
    }

    path.replace(
      j.callExpression(member(j.memberExpression(recv, j.identifier(route)), target), callArgs)
    );
    if (reshape && reshape.todo) {
      addTodo(path, reshape.todo);
    }
  });

  return changed ? root.toSource({ quote: "double" }) : undefined;
};
