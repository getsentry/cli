#!/usr/bin/env bun

/**
 * Lint script for the .NET source code
 *
 * Runs `dotnet format` against the solution and optionally verifies that no
 * changes are needed (useful in CI to enforce formatting without auto-fixing).
 *
 * Usage:
 *   bun run script/dotnet-lint.ts           # Format in place
 *   bun run script/dotnet-lint.ts --check   # Exit non-zero if any changes would be made
 */

import { $ } from "bun";

const SOLUTION = "src/dotnet/Sentry.Cli.slnx";

const check = process.argv.includes("--check");

try {
  if (check) {
    await $`dotnet format ${SOLUTION} --verify-no-changes`;
  } else {
    await $`dotnet format ${SOLUTION}`;
  }
} catch {
  process.exit(1);
}
