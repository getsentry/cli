/**
 * Tests for the v3→v4 wrapper codemod (`codemods/sentry-v3-to-v4.cjs`).
 *
 * Drives the transform through jscodeshift the same way `npx jscodeshift` does,
 * asserting the mechanical rewrites (import, constructor, method chain) and the
 * `// TODO(sentry-v4)` breadcrumbs for the option-shape changes.
 */

import { createRequire } from "node:module";
import jscodeshift from "jscodeshift";
import { describe, expect, test } from "vitest";

const require = createRequire(import.meta.url);
const transform = require("../../codemods/sentry-v3-to-v4.cjs") as (
  file: { path: string; source: string },
  api: { jscodeshift: typeof jscodeshift; j: typeof jscodeshift }
) => string | undefined;

/** Run the codemod on a source string, returning the transformed output. */
function run(source: string): string {
  const j = jscodeshift.withParser("tsx");
  const api = { jscodeshift: j, j };
  const out = transform({ path: "input.js", source }, api);
  return out ?? source;
}

/** Prepend a recognized SDK-instance declaration so method rewrites apply. */
function withCli(body: string): string {
  return `const cli = new SentryCli();\n${body}`;
}

describe("codemod: sentry-v3-to-v4", () => {
  test("changes the ESM import specifier but keeps the binding name", () => {
    const out = run(`import SentryCli from "@sentry/cli";`);
    expect(out).toContain('import SentryCli from "sentry"');
    expect(out).not.toContain("@sentry/cli");
  });

  test("changes the CommonJS require specifier but keeps the binding name", () => {
    const out = run(`const SentryCli = require("@sentry/cli");`);
    expect(out).toContain('const SentryCli = require("sentry")');
    expect(out).not.toContain("@sentry/cli");
  });

  test("preserves a custom binding name and all references (no dangling refs)", () => {
    const out = run(
      'import Sentry from "@sentry/cli";\nconst cli = new Sentry();\nexport { Sentry };'
    );
    expect(out).toContain('import Sentry from "sentry"');
    expect(out).toMatch(/const cli = Sentry\(\)/); // factory call, `new` dropped
    expect(out).toContain("export { Sentry }"); // reference preserved
    expect(out).not.toContain("createSentrySDK");
    expect(out).not.toContain("new Sentry");
  });

  test("rewrites the constructor (drops new + configFile, authToken → token)", () => {
    const out = run(
      `const cli = new SentryCli(null, { authToken: process.env.T, org: "acme" });`
    );
    expect(out).toContain("SentryCli({");
    expect(out).toContain("token: process.env.T");
    expect(out).toContain('org: "acme"');
    expect(out).not.toContain("authToken");
    expect(out).not.toContain("new SentryCli");
  });

  test("preserves a single non-object constructor arg with a TODO (no silent drop)", () => {
    const out = run("const cli = new SentryCli(myOptions);");
    // The user's config variable must survive, not be dropped.
    expect(out).toContain("SentryCli(myOptions)");
    expect(out).toContain("TODO(sentry-v4)");
  });

  test("flags authToken rename when options is a variable (can't rewrite in place)", () => {
    const out = run("const cli = new SentryCli(null, opts);");
    expect(out).toContain("SentryCli(opts)");
    expect(out).toMatch(/TODO\(sentry-v4\).*authToken/);
  });

  test("expands shorthand authToken to token: authToken (keeps the binding)", () => {
    const out = run("const cli = new SentryCli(null, { authToken });");
    expect(out).toMatch(/token:\s*authToken/); // not a bare `{ token }`
    expect(out).not.toMatch(/{\s*token\s*}/);
  });

  test("maps the canonical release flow", () => {
    const out = run(
      [
        `import SentryCli from "@sentry/cli";`,
        "const cli = new SentryCli(null, { authToken: t });",
        `await cli.releases.new("1.0.0");`,
        `await cli.releases.finalize("1.0.0");`,
        "const v = await cli.releases.proposeVersion();",
      ].join("\n")
    );
    expect(out).toContain('cli.release.create({\n  orgVersion: "1.0.0"\n})');
    expect(out).toContain('cli.release.finalize({\n  orgVersion: "1.0.0"\n})');
    expect(out).toContain('cli.release["propose-version"]()');
  });

  test("maps setCommits, inlining literal options, with a TODO breadcrumb", () => {
    const out = run(
      withCli(`await cli.releases.setCommits("1.0.0", { auto: true });`)
    );
    expect(out).toContain('cli.release["set-commits"]({');
    expect(out).toContain('orgVersion: "1.0.0"');
    expect(out).toMatch(/auto: true/);
    expect(out).not.toContain("...{"); // object literal inlined, not spread
    expect(out).toContain("TODO(sentry-v4)");
  });

  test("spreads a non-literal options argument", () => {
    const out = run(withCli("await cli.releases.setCommits(v, opts);"));
    expect(out).toMatch(/\.\.\.opts/);
  });

  test("maps uploadSourceMaps to sourcemap.upload with a TODO", () => {
    const out = run(
      withCli(
        `await cli.releases.uploadSourceMaps("1.0.0", { include: ["./dist"] });`
      )
    );
    expect(out).toContain("cli.sourcemap.upload({");
    expect(out).toContain('release: "1.0.0"');
    expect(out).toMatch(/TODO\(sentry-v4\).*directory/);
  });

  test("maps newDeploy to release.deploy", () => {
    const out = run(
      withCli(`await cli.releases.newDeploy("1.0.0", { env: "prod" });`)
    );
    expect(out).toContain("cli.release.deploy({");
    expect(out).toContain('orgVersionEnvironmentName: "1.0.0"');
    // env/name are part of the positional target in v4, not options — the
    // codemod must NOT spread them (would emit invalid params); flags instead.
    expect(out).not.toMatch(/env:\s*"prod"/);
    expect(out).toContain("TODO(sentry-v4)");
  });

  test("rewrites execute() to run(...) spreading the args array", () => {
    const out = run(
      withCli(`await cli.execute(["releases", "new", version], true);`)
    );
    expect(out).toMatch(/cli\.run\("releases",\s*"new",\s*version\)/);
    expect(out).not.toContain(".execute(");
    // argv tokens are raw v3 CLI args — flag them for remapping to v4.
    expect(out).toContain("TODO(sentry-v4)");
  });

  test("does NOT rewrite .execute() on unrelated (non-SDK) objects", () => {
    const out = run(`const db = getDb();\nawait db.execute("SELECT 1");`);
    expect(out).toContain('db.execute("SELECT 1")');
    expect(out).not.toContain(".run(");
  });

  test("does NOT rewrite a .releases chain on an unrelated object", () => {
    const src = 'const music = getCatalog();\nmusic.releases.new("album");\n';
    expect(run(src)).toBe(src);
  });

  test("leaves unrelated code untouched (returns undefined → original)", () => {
    const src = "const x = 1;\nconsole.log(x);\n";
    expect(run(src)).toBe(src);
  });
});
