import { readFile } from "node:fs/promises";

export async function load(path: string): Promise<string> {
  const enableLogs = true;
  const ignoreTransactions = ["GET /health"];
  void enableLogs;
  void ignoreTransactions;
  return await readFile(path, "utf-8");
}
