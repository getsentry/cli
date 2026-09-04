/**
 * The filesystem view detection runs against.
 *
 * Reads are by exact path and memoised, misses included. Every migration is
 * asked about the same project, and they mostly ask about the same few files.
 * Without caching, adding a migration would add a re-read of every one of them
 * for every project in every language that will never run it.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ProjectProbe } from "./framework.js";

export function createProbe(cwd: string): ProjectProbe {
  const contents = new Map<string, Promise<string | null>>();

  const read = (relativePath: string): Promise<string | null> => {
    const cached = contents.get(relativePath);
    if (cached) {
      return cached;
    }
    const pending = readFile(path.join(cwd, relativePath), "utf-8").catch(
      () => null
    );
    contents.set(relativePath, pending);
    return pending;
  };

  return {
    cwd,
    read,

    async json(relativePath) {
      const raw = await read(relativePath);
      if (raw === null) {
        return null;
      }
      try {
        const parsed: unknown = JSON.parse(raw);
        return parsed && typeof parsed === "object" && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)
          : null;
      } catch {
        // A malformed manifest is the user's problem to fix, not ours to guess
        // at. Detection treats it as absent rather than crashing the command.
        return null;
      }
    },

    async exists(relativePath) {
      return (await read(relativePath)) !== null;
    },
  };
}
