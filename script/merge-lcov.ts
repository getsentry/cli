#!/usr/bin/env bun
/**
 * Merge multiple LCOV coverage files by taking the MAX hit count per line.
 *
 * The getsentry/codecov-action aggregates multiple coverage files by summing
 * all statements — if a source file appears in two lcov files, its hit counts
 * get doubled rather than merged. This script merges lcov files properly:
 * for each source file, it takes the maximum DA (line hit count) across all
 * input files, producing a single lcov with the best coverage from any suite.
 *
 * All summary fields (LF, LH, FNF, FNH, BRF, BRH) are recomputed from the
 * merged data rather than taking the max from inputs.
 *
 * Usage: bun run script/merge-lcov.ts file1.lcov file2.lcov [file3.lcov ...]
 * Output: merged lcov to stdout
 */

export type FileData = {
  /** DA entries: line number → max hit count */
  da: Map<number, number>;
  /** FN entries: function name → "lineNo,name" */
  fn: Map<string, string>;
  /** FNDA entries: function name → max execution count */
  fnda: Map<string, number>;
  /** BRDA entries: "line,block,branch" key → max taken count (string, "-" = not taken) */
  brda: Map<string, string>;
  /** Max FNF seen from inputs (fallback when no FN/FNDA entries available) */
  fnfMax: number;
  /** Max FNH seen from inputs (fallback when no FN/FNDA entries available) */
  fnhMax: number;
};

/**
 * Per-input DA line tracking for phantom line filtering.
 *
 * Bun's coverage instrumentation generates DA entries for transitively imported
 * modules, including lines that don't correspond to executable code. These
 * "phantom" lines always have 0 hits and only appear in one input (typically
 * the isolated test suite). We track which inputs contain each DA line so we
 * can exclude 0-hit lines that appear in only one input.
 */
type PerInputDA = {
  /** How many input files included this DA line */
  inputCount: number;
  /** Whether any input had hits > 0 */
  hasHits: boolean;
};

function createFileData(): FileData {
  return {
    da: new Map(),
    fn: new Map(),
    fnda: new Map(),
    brda: new Map(),
    fnfMax: 0,
    fnhMax: 0,
  };
}

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("Usage: merge-lcov.ts <file1.lcov> [file2.lcov ...]");
  process.exit(1);
}

/** Merged data per source file path */
const merged = new Map<string, FileData>();
/** Track insertion order of source files */
const fileOrder: string[] = [];
/** Per-source-file, per-line tracking of which inputs contributed each DA line */
const daInputTracking = new Map<string, Map<number, PerInputDA>>();

for (const filePath of files) {
  const content = await Bun.file(filePath).text();
  let currentSF = "";
  let data: FileData | null = null;

  for (const line of content.split("\n")) {
    if (line.startsWith("SF:")) {
      currentSF = line.slice(3);
      if (!merged.has(currentSF)) {
        merged.set(currentSF, createFileData());
        fileOrder.push(currentSF);
        daInputTracking.set(currentSF, new Map());
      }
      data = merged.get(currentSF) ?? null;
    } else if (line.startsWith("DA:") && data) {
      const comma = line.indexOf(",", 3);
      const lineNo = Number.parseInt(line.slice(3, comma), 10);
      const hits = Number.parseInt(line.slice(comma + 1), 10);
      if (!data.da.has(lineNo) || hits > (data.da.get(lineNo) ?? 0)) {
        data.da.set(lineNo, hits);
      }

      // Track which inputs contributed this DA line for phantom filtering
      const tracking = daInputTracking.get(currentSF);
      if (tracking) {
        const existing = tracking.get(lineNo);
        if (existing) {
          existing.inputCount += 1;
          existing.hasHits = existing.hasHits || hits > 0;
        } else {
          tracking.set(lineNo, { inputCount: 1, hasHits: hits > 0 });
        }
      }
    } else if (line.startsWith("FN:") && data) {
      const val = line.slice(3);
      const comma = val.indexOf(",");
      const name = val.slice(comma + 1);
      data.fn.set(name, val);
    } else if (line.startsWith("FNDA:") && data) {
      const val = line.slice(5);
      const comma = val.indexOf(",");
      const count = Number.parseInt(val.slice(0, comma), 10);
      const name = val.slice(comma + 1);
      const prev = data.fnda.get(name) ?? 0;
      if (count > prev) {
        data.fnda.set(name, count);
      }
    } else if (line.startsWith("FNF:") && data) {
      const v = Number.parseInt(line.slice(4), 10);
      if (v > data.fnfMax) {
        data.fnfMax = v;
      }
    } else if (line.startsWith("FNH:") && data) {
      const v = Number.parseInt(line.slice(4), 10);
      if (v > data.fnhMax) {
        data.fnhMax = v;
      }
    } else if (line.startsWith("BRDA:") && data) {
      // BRDA format: line,block,branch,taken
      // Use "line,block,branch" as key, take max of "taken"
      const val = line.slice(5);
      const lastComma = val.lastIndexOf(",");
      const branchKey = val.slice(0, lastComma);
      const taken = val.slice(lastComma + 1);
      const prev = data.brda.get(branchKey);
      if (prev === undefined || prev === "-") {
        // No previous value or previous was "not taken"
        data.brda.set(branchKey, taken);
      } else if (taken !== "-") {
        // Both are numeric — take the max
        const prevNum = Number.parseInt(prev, 10);
        const takenNum = Number.parseInt(taken, 10);
        if (takenNum > prevNum) {
          data.brda.set(branchKey, taken);
        }
      }
    }
    // LF, LH, FNF, FNH, BRF, BRH, end_of_record are all skipped — we recompute them
  }
}

// Output merged lcov
const out: string[] = [];

for (const sf of fileOrder) {
  const data = merged.get(sf);
  if (!data) {
    continue;
  }

  out.push(`SF:${sf}`);

  // FN lines
  for (const val of data.fn.values()) {
    out.push(`FN:${val}`);
  }

  // FNDA lines + compute FNF/FNH
  let fnh = 0;
  for (const [name, count] of data.fnda) {
    out.push(`FNDA:${count},${name}`);
    if (count > 0) {
      fnh += 1;
    }
  }

  // Prefer recomputed FNF/FNH from merged FN/FNDA entries when available.
  // Bun's lcov output only has FNF/FNH summary lines (no individual FN/FNDA),
  // so fall back to max-of-inputs for those.
  if (data.fn.size > 0) {
    out.push(`FNF:${data.fn.size}`);
    out.push(`FNH:${fnh}`);
  } else if (data.fnfMax > 0) {
    out.push(`FNF:${data.fnfMax}`);
    out.push(`FNH:${data.fnhMax}`);
  }

  // DA lines sorted by line number + compute LF/LH.
  // Filter out phantom lines: 0-hit DA entries that only appeared in a single
  // input file. These are artifacts of Bun's coverage instrumentation for
  // transitively imported modules and inflate the uncovered line count.
  const tracking = daInputTracking.get(sf);
  const sortedLines = [...data.da.entries()].sort((a, b) => a[0] - b[0]);
  let lf = 0;
  let lh = 0;
  for (const [lineNo, hits] of sortedLines) {
    if (hits === 0 && files.length > 1 && tracking) {
      const info = tracking.get(lineNo);
      if (info && info.inputCount === 1 && !info.hasHits) {
        // Phantom line: 0 hits, only in one input, never had hits — skip
        continue;
      }
    }
    out.push(`DA:${lineNo},${hits}`);
    lf += 1;
    if (hits > 0) {
      lh += 1;
    }
  }
  out.push(`LF:${lf}`);
  out.push(`LH:${lh}`);

  // BRDA lines + compute BRF/BRH
  let brh = 0;
  for (const [key, taken] of data.brda) {
    out.push(`BRDA:${key},${taken}`);
    if (taken !== "-" && Number.parseInt(taken, 10) > 0) {
      brh += 1;
    }
  }
  if (data.brda.size > 0) {
    out.push(`BRF:${data.brda.size}`);
    out.push(`BRH:${brh}`);
  }

  out.push("end_of_record");
}

process.stdout.write(`${out.join("\n")}\n`);
