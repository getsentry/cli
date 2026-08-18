import fs from "node:fs";
import path from "node:path";
import { MAX_FILE_BYTES } from "../constants.js";
import type {
  ReadFileErrorCode,
  ReadFilesPayload,
  ReadFilesV2Data,
  ReadFileV2Result,
  ToolResult,
} from "../types.js";
import { safePath } from "./shared.js";
import type { InitToolDefinition } from "./types.js";

const PATH_SEGMENT_RE = /[/\\]/u;
const UTF8_CONTINUATION_MIN = 0x80;
const UTF8_CONTINUATION_MAX = 0xbf;

/**
 * Read one or more files from the sandboxed project directory.
 */
export async function readFiles(
  payload: ReadFilesPayload
): Promise<ToolResult> {
  if (payload.params.resultVersion === 2) {
    return readFilesV2(payload, boundedMaxBytes(payload.params.maxBytes));
  }

  const results = await Promise.all(
    payload.params.paths.map(async (filePath) => {
      const content = await readSingleFileV1(
        payload.cwd,
        filePath,
        payload.params.maxBytes ?? MAX_FILE_BYTES
      );
      return [filePath, content] as const;
    })
  );

  const files: Record<string, string | null> = {};
  for (const [filePath, content] of results) {
    files[filePath] = content;
  }

  return { ok: true, data: { files } };
}

/** Preserve the exact wire behavior expected by APIs predating read-files v2. */
async function readSingleFileV1(
  cwd: string,
  filePath: string,
  maxBytes: number
): Promise<string | null> {
  try {
    const absPath = safePath(cwd, filePath);
    const stat = await fs.promises.stat(absPath);
    if (!stat.isFile()) {
      return null;
    }
    if (stat.size <= maxBytes) {
      return await fs.promises.readFile(absPath, "utf-8");
    }

    const handle = await fs.promises.open(absPath, "r");
    try {
      const buffer = Buffer.alloc(maxBytes);
      await handle.read(buffer, 0, maxBytes, 0);
      return buffer.toString("utf-8");
    } finally {
      await handle.close();
    }
  } catch {
    return null;
  }
}

async function readFilesV2(
  payload: ReadFilesPayload,
  maxBytes: number
): Promise<ToolResult> {
  const offsetBytes = payload.params.offsetBytes ?? 0;
  const validOffset =
    Number.isSafeInteger(offsetBytes) &&
    offsetBytes >= 0 &&
    (offsetBytes === 0 || payload.params.paths.length === 1)
      ? offsetBytes
      : undefined;
  const results = await Promise.all(
    payload.params.paths.map(async (filePath) => {
      const result =
        validOffset === undefined
          ? ({ error: "invalid-offset", status: "error" } as const)
          : await readSingleFileV2(
              payload.cwd,
              filePath,
              maxBytes,
              validOffset
            );
      return [filePath, result] as const;
    })
  );

  return {
    data: {
      files: Object.fromEntries(results),
      version: 2,
    } satisfies ReadFilesV2Data,
    ok: true,
  };
}

async function readSingleFileV2(
  cwd: string,
  filePath: string,
  maxBytes: number,
  offsetBytes: number
): Promise<ReadFileV2Result> {
  let handle: fs.promises.FileHandle | undefined;
  try {
    const absPath = safePath(cwd, filePath);
    handle = await fs.promises.open(
      absPath,
      // biome-ignore lint/suspicious/noBitwiseOperators: fs open flags are a bitmask.
      fs.constants.O_RDONLY | fs.constants.O_NONBLOCK
    );
    const stat = await handle.stat();
    // Open non-blocking before checking the handle itself so a path swapped
    // to a FIFO cannot block between a path-level stat and open.
    if (!stat.isFile()) {
      return { error: "not-file", status: "error" };
    }
    if (!(await openedPathIsSandboxed(cwd, absPath, stat))) {
      return { error: "unreadable", status: "error" };
    }
    if (offsetBytes > stat.size) {
      return { error: "invalid-offset", status: "error" };
    }

    if (offsetBytes === stat.size) {
      if (fileChanged(stat, await handle.stat())) {
        return { error: "unreadable", status: "error" };
      }
      return {
        content: "",
        fileVersion: readFileVersion(stat),
        offsetBytes,
        returnedBytes: 0,
        status: "ok",
        totalBytes: stat.size,
        truncated: false,
      };
    }

    const buffer = Buffer.alloc(Math.min(maxBytes, stat.size - offsetBytes));
    const { bytesRead } = await handle.read(
      buffer,
      0,
      buffer.byteLength,
      offsetBytes
    );
    assertReadProgress(bytesRead);
    const bytes = buffer.subarray(0, bytesRead);
    const startsWithContinuation = isUtf8ContinuationByte(bytes[0]);
    let returnedBytes = 0;
    let completeBytes = bytes.subarray(0, 0);
    if (!startsWithContinuation) {
      returnedBytes = completeUtf8PrefixLength(bytes);
      completeBytes = bytes.subarray(0, returnedBytes);
      if (returnedBytes === 0) {
        const sequenceBytes = utf8SequenceLength(bytes[0]);
        const retryBuffer = Buffer.alloc(
          Math.min(sequenceBytes, stat.size - offsetBytes)
        );
        const retry = await handle.read(
          retryBuffer,
          0,
          retryBuffer.byteLength,
          offsetBytes
        );
        assertReadProgress(retry.bytesRead);
        returnedBytes = retry.bytesRead;
        completeBytes = retryBuffer.subarray(0, retry.bytesRead);
      }
    }

    // Classify content only after proving the bytes came from the same stable
    // file version. A torn read is retryable, not permanently non-text.
    const finalStat = await handle.stat();
    if (fileChanged(stat, finalStat)) {
      return { error: "unreadable", status: "error" };
    }
    if (startsWithContinuation) {
      return {
        error: continuationByteError(offsetBytes),
        status: "error",
      };
    }
    let content: string;
    try {
      content = new TextDecoder("utf-8", {
        fatal: true,
        ignoreBOM: true,
      }).decode(completeBytes);
    } catch {
      return { error: "not-text", status: "error" };
    }

    const nextOffsetBytes = offsetBytes + returnedBytes;
    const truncated = nextOffsetBytes < stat.size;
    return {
      content,
      fileVersion: readFileVersion(stat),
      ...(truncated ? { nextOffsetBytes } : {}),
      offsetBytes,
      returnedBytes,
      status: "ok",
      totalBytes: stat.size,
      truncated,
    };
  } catch (error) {
    return { error: readErrorCode(error), status: "error" };
  } finally {
    await handle?.close().catch(() => {
      // The primary read error is more actionable than a cleanup failure.
    });
  }
}

async function openedPathIsSandboxed(
  cwd: string,
  absPath: string,
  openedStat: fs.Stats
): Promise<boolean> {
  const [realCwd, realPath] = await Promise.all([
    fs.promises.realpath(cwd),
    fs.promises.realpath(absPath),
  ]);
  if (realPath !== realCwd && !realPath.startsWith(`${realCwd}${path.sep}`)) {
    return false;
  }
  const resolvedStat = await fs.promises.stat(realPath);
  return (
    resolvedStat.dev === openedStat.dev && resolvedStat.ino === openedStat.ino
  );
}

function readFileVersion(stat: fs.Stats): string {
  return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}`;
}

function fileChanged(initial: fs.Stats, final: fs.Stats): boolean {
  return (
    final.dev !== initial.dev ||
    final.ino !== initial.ino ||
    final.size !== initial.size ||
    final.mtimeMs !== initial.mtimeMs
  );
}

function boundedMaxBytes(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return MAX_FILE_BYTES;
  }
  return Math.max(1, Math.min(Math.floor(value), MAX_FILE_BYTES));
}

function isUtf8ContinuationByte(value: number | undefined): boolean {
  return (
    value !== undefined &&
    value >= UTF8_CONTINUATION_MIN &&
    value <= UTF8_CONTINUATION_MAX
  );
}

function continuationByteError(offsetBytes: number): ReadFileErrorCode {
  return offsetBytes === 0 ? "not-text" : "invalid-offset";
}

function assertReadProgress(bytesRead: number): void {
  if (bytesRead === 0) {
    throw new Error("File read made no progress");
  }
}

function utf8SequenceLength(value: number | undefined): number {
  if (value === undefined || value < 0xc0) {
    return 1;
  }
  if (value < 0xe0) {
    return 2;
  }
  if (value < 0xf0) {
    return 3;
  }
  return value < 0xf8 ? 4 : 1;
}

function completeUtf8PrefixLength(buffer: Buffer): number {
  if (buffer.length === 0) {
    return 0;
  }
  let leadIndex = buffer.length - 1;
  while (leadIndex >= 0 && isUtf8ContinuationByte(buffer[leadIndex])) {
    leadIndex -= 1;
  }
  if (leadIndex < 0) {
    return 0;
  }
  const availableBytes = buffer.length - leadIndex;
  return utf8SequenceLength(buffer[leadIndex]) > availableBytes
    ? leadIndex
    : buffer.length;
}

function readErrorCode(error: unknown): ReadFileErrorCode {
  if (typeof error === "object" && error !== null && "code" in error) {
    if (error.code === "ENOENT") {
      return "not-found";
    }
    if (error.code === "EISDIR") {
      return "not-file";
    }
  }
  return "unreadable";
}

/**
 * Tool definition for batched file reads.
 */
export const readFilesTool: InitToolDefinition<"read-files"> = {
  operation: "read-files",
  describe: (payload) => {
    const [first, second] = payload.params.paths;
    if (!first) {
      return "Reading files...";
    }
    if (!second && payload.params.paths.length === 1) {
      return `Reading \`${pathBase(first)}\`...`;
    }
    if (payload.params.paths.length === 2 && second) {
      return `Reading \`${pathBase(first)}\`, \`${pathBase(second)}\`...`;
    }
    return `Reading ${payload.params.paths.length} files (\`${pathBase(first)}\`${second ? `, \`${pathBase(second)}\`` : ""}, ...)...`;
  },
  execute: readFiles,
};

function pathBase(filePath: string): string {
  const parts = filePath.split(PATH_SEGMENT_RE);
  return parts.at(-1) ?? filePath;
}
