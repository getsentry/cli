/**
 * Tests for `sentry build upload`.
 *
 * Drives the command through its wrapper `loader()`. Real detection +
 * normalization run against in-memory ZIP fixtures (a "fake APK" is a ZIP with
 * an AndroidManifest.xml entry); the API `uploadBuild` and org/project
 * resolution are spied so no network is touched.
 */

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strToU8, zipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { uploadCommand } from "../../../src/commands/build/upload.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as preprod from "../../../src/lib/api/preprod-artifacts.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as resolveTarget from "../../../src/lib/resolve-target.js";

let tmpDir: string;

function createContext() {
  const writes: string[] = [];
  return {
    context: {
      stdout: {
        write: (data: string | Uint8Array) => {
          writes.push(
            typeof data === "string" ? data : new TextDecoder().decode(data)
          );
          return true;
        },
      },
      stderr: { write: () => true },
      cwd: tmpDir,
      env: {} as NodeJS.ProcessEnv,
      process: { ...process, exitCode: undefined } as typeof process,
    },
    output: () => writes.join(""),
    get exitCode() {
      return this.context.process.exitCode;
    },
  };
}

/** Write a fake APK (a ZIP with a root AndroidManifest.xml) to the temp dir. */
async function writeApk(name = "app-release.apk"): Promise<string> {
  const path = join(tmpDir, name);
  await writeFile(path, zipSync({ "AndroidManifest.xml": strToU8("xml") }));
  return path;
}

describe("build upload", () => {
  let uploadSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "build-upload-"));
    vi.spyOn(resolveTarget, "resolveOrgAndProject").mockResolvedValue({
      org: "test-org",
      project: "test-project",
    });
    uploadSpy = vi
      .spyOn(preprod, "uploadBuild")
      .mockResolvedValue("https://sentry.io/artifact/1");
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("uploads an APK and reports the artifact URL", async () => {
    const apk = await writeApk();
    const harness = createContext();
    const func = await uploadCommand.loader();

    await func.call(harness.context, {}, apk);

    expect(uploadSpy).toHaveBeenCalledTimes(1);
    const opts = uploadSpy.mock.calls[0]?.[0] as { org: string; project: string };
    expect(opts.org).toBe("test-org");
    expect(opts.project).toBe("test-project");
    expect(harness.output()).toContain("https://sentry.io/artifact/1");
    expect(harness.exitCode).toBeUndefined();
  });

  test("passes build metadata flags through to the API", async () => {
    const apk = await writeApk();
    const harness = createContext();
    const func = await uploadCommand.loader();

    await func.call(
      harness.context,
      {
        "build-configuration": "Release",
        "install-group": ["qa", "beta"],
      },
      apk
    );

    const meta = uploadSpy.mock.calls[0]?.[0] as {
      metadata: { buildConfiguration?: string; installGroups?: string[] };
    };
    expect(meta.metadata.buildConfiguration).toBe("Release");
    expect(meta.metadata.installGroups).toEqual(["qa", "beta"]);
  });

  test("rejects an unsupported file with a non-zero exit", async () => {
    const bad = join(tmpDir, "notes.txt");
    await writeFile(bad, "not a build");
    const harness = createContext();
    const func = await uploadCommand.loader();

    await func.call(harness.context, {}, bad);

    expect(uploadSpy).not.toHaveBeenCalled();
    expect(harness.exitCode).toBe(1);
    expect(harness.output()).toContain("Unsupported build format");
  });

  test("rejects a directory (iOS XCArchive) with a non-zero exit", async () => {
    const dir = join(tmpDir, "MyApp.xcarchive");
    await mkdir(dir);
    const harness = createContext();
    const func = await uploadCommand.loader();

    await func.call(harness.context, {}, dir);

    expect(uploadSpy).not.toHaveBeenCalled();
    expect(harness.exitCode).toBe(1);
    expect(harness.output()).toContain("XCArchive");
  });

  test("uploads the good build but exits non-zero when another fails", async () => {
    const apk = await writeApk("good.apk");
    const bad = join(tmpDir, "bad.txt");
    await writeFile(bad, "nope");
    const harness = createContext();
    const func = await uploadCommand.loader();

    await func.call(harness.context, {}, apk, bad);

    expect(uploadSpy).toHaveBeenCalledTimes(1);
    expect(harness.exitCode).toBe(1);
  });
});
