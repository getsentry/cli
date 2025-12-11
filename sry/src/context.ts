import type { StricliContext } from "@stricli/core";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

export interface SryContext extends StricliContext {
  readonly fs: typeof fs;
  readonly path: typeof path;
  readonly os: typeof os;
  readonly env: NodeJS.ProcessEnv;
  readonly cwd: string;
  readonly homeDir: string;
  readonly configDir: string;
}

export function buildContext(process: NodeJS.Process): SryContext {
  const homeDir = os.homedir();
  const configDir = path.join(homeDir, ".sry");

  return {
    process,
    fs,
    path,
    os,
    env: process.env,
    cwd: process.cwd(),
    homeDir,
    configDir,
  };
}

