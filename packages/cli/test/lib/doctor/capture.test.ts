import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { capture } from "../../../src/lib/doctor/capture.js";

let root: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "doctor-capture-"));
  await mkdir(join(root, "src"), { recursive: true });

  await writeFile(
    join(root, "package.json"),
    JSON.stringify({
      name: "fixture",
      dependencies: { "@sentry/node": "^8.42.0" },
    })
  );
  await writeFile(
    join(root, "src", "instrument.ts"),
    [
      "import * as Sentry from '@sentry/node';",
      "",
      "Sentry.init({",
      "  dsn: 'https://abc123@o1.ingest.sentry.io/42',",
      "  environment: 'production',",
      "  tracesSampleRate: 1.0,",
      "});",
    ].join("\n")
  );
  await writeFile(
    join(root, "vite.config.ts"),
    [
      "import { sentryVitePlugin } from '@sentry/vite-plugin';",
      "export default {",
      "  plugins: [sentryVitePlugin({",
      "    org: 'acme',",
      "    project: 'web',",
      "    authToken: 'sntrys_supersecret',",
      "  })],",
      "};",
    ].join("\n")
  );
});

describe("capture", () => {
  it("finds the init site with its scalar keys", async () => {
    const result = await capture(root);
    const init = result.initSites.find((b) => b.kind === "init");

    expect(init?.file).toBe("src/instrument.ts");
    expect(init?.line).toBe(3);
    expect(init?.keys.environment).toEqual({
      value: "production",
      dynamic: false,
    });
    expect(init?.keys.tracesSampleRate).toEqual({
      value: "1.0",
      dynamic: false,
    });
  });

  it("finds the build config", async () => {
    const result = await capture(root);
    expect(result.buildConfigs.some((b) => b.file === "vite.config.ts")).toBe(
      true
    );
  });

  it("redacts secrets but keeps the DSN public key", async () => {
    const result = await capture(root);
    const all = [...result.initSites, ...result.buildConfigs]
      .map((b) => b.text)
      .join("\n");

    expect(all).not.toContain("sntrys_supersecret");
    expect(all).toContain("[REDACTED]");
    expect(all).toContain("abc123");
  });

  it("records ecosystems and Sentry dependencies", async () => {
    const result = await capture(root);
    expect(result.ecosystems).toContain("javascript");
    expect(result.manifests["package.json"]?.deps["@sentry/node"]).toBe(
      "^8.42.0"
    );
  });

  it("marks the capture incomplete when the budget is exhausted", async () => {
    const result = await capture(root, { timeBudgetMs: 0 });
    expect(result.incomplete).toBeTruthy();
  });
});
