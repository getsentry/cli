import * as fs from "node:fs";
import * as path from "node:path";
import type { DSNDetectionResult, ParsedDSN } from "../types/index.js";

// DSN pattern: https://<public_key>@<host>/<project_id>
const DSN_REGEX =
  /https?:\/\/([a-f0-9]+)@([a-z0-9.-]+(?:\.ingest)?\.sentry\.io)\/(\d+)/gi;

// Alternative format with o prefix for organization
const DSN_REGEX_ALT =
  /https?:\/\/([a-f0-9]+)@o(\d+)\.ingest\.sentry\.io\/(\d+)/gi;

/**
 * Parse a DSN string into its components
 */
export function parseDSN(dsn: string): ParsedDSN | null {
  // Reset regex state
  DSN_REGEX.lastIndex = 0;
  DSN_REGEX_ALT.lastIndex = 0;

  let match = DSN_REGEX.exec(dsn);
  if (match) {
    return {
      protocol: dsn.startsWith("https") ? "https" : "http",
      publicKey: match[1],
      host: match[2],
      projectId: match[3],
    };
  }

  match = DSN_REGEX_ALT.exec(dsn);
  if (match) {
    return {
      protocol: dsn.startsWith("https") ? "https" : "http",
      publicKey: match[1],
      host: `o${match[2]}.ingest.sentry.io`,
      projectId: match[3],
    };
  }

  return null;
}

/**
 * Find DSN in file content
 */
function findDSNInContent(content: string): string | null {
  // Reset regex state
  DSN_REGEX.lastIndex = 0;
  DSN_REGEX_ALT.lastIndex = 0;

  let match = DSN_REGEX.exec(content);
  if (match) {
    return match[0];
  }

  match = DSN_REGEX_ALT.exec(content);
  if (match) {
    return match[0];
  }

  return null;
}

/**
 * Files to check for DSN configuration
 */
const DSN_FILE_PATTERNS = [
  // Environment files
  { pattern: ".env", source: ".env file" },
  { pattern: ".env.local", source: ".env.local file" },
  { pattern: ".env.production", source: ".env.production file" },
  { pattern: ".env.development", source: ".env.development file" },

  // JavaScript/TypeScript configs
  { pattern: "sentry.client.config.js", source: "Sentry client config" },
  { pattern: "sentry.client.config.ts", source: "Sentry client config" },
  { pattern: "sentry.server.config.js", source: "Sentry server config" },
  { pattern: "sentry.server.config.ts", source: "Sentry server config" },
  { pattern: "sentry.edge.config.js", source: "Sentry edge config" },
  { pattern: "sentry.edge.config.ts", source: "Sentry edge config" },

  // Next.js
  { pattern: "next.config.js", source: "Next.js config" },
  { pattern: "next.config.mjs", source: "Next.js config" },
  { pattern: "next.config.ts", source: "Next.js config" },

  // Android
  { pattern: "sentry.properties", source: "sentry.properties" },

  // Package.json (might have sentry config)
  { pattern: "package.json", source: "package.json" },

  // Source files (common patterns)
  { pattern: "src/index.ts", source: "src/index.ts" },
  { pattern: "src/index.js", source: "src/index.js" },
  { pattern: "src/main.ts", source: "src/main.ts" },
  { pattern: "src/main.js", source: "src/main.js" },
  { pattern: "src/app.ts", source: "src/app.ts" },
  { pattern: "src/app.js", source: "src/app.js" },
  { pattern: "app/entry.client.tsx", source: "Remix entry" },
  { pattern: "app/entry.server.tsx", source: "Remix entry" },

  // Python
  { pattern: "settings.py", source: "Django settings" },
  { pattern: "config/settings.py", source: "Django settings" },
  { pattern: "config.py", source: "Python config" },

  // Ruby
  { pattern: "config/initializers/sentry.rb", source: "Rails initializer" },
];

/**
 * Detect Sentry DSN in a project directory
 */
export async function detectDSN(
  cwd: string
): Promise<DSNDetectionResult | null> {
  for (const { pattern, source } of DSN_FILE_PATTERNS) {
    const filePath = path.join(cwd, pattern);

    try {
      if (!fs.existsSync(filePath)) {
        continue;
      }

      const content = fs.readFileSync(filePath, "utf-8");
      const dsn = findDSNInContent(content);

      if (dsn) {
        const parsed = parseDSN(dsn);
        if (parsed) {
          return {
            dsn,
            parsed,
            source,
            filePath,
          };
        }
      }
    } catch {}
  }

  // Try recursive search in common directories
  const searchDirs = ["src", "lib", "app", "config"];

  for (const dir of searchDirs) {
    const dirPath = path.join(cwd, dir);
    const result = await searchDirectory(dirPath, 2); // Max depth 2
    if (result) {
      return result;
    }
  }

  return null;
}

/**
 * Recursively search a directory for DSN
 */
async function searchDirectory(
  dirPath: string,
  maxDepth: number,
  currentDepth = 0
): Promise<DSNDetectionResult | null> {
  if (currentDepth > maxDepth) {
    return null;
  }

  try {
    if (!fs.existsSync(dirPath)) {
      return null;
    }

    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);

      if (entry.isFile()) {
        // Only check relevant file extensions
        const ext = path.extname(entry.name);
        if (
          !(
            [
              ".js",
              ".ts",
              ".jsx",
              ".tsx",
              ".py",
              ".rb",
              ".env",
              ".json",
              ".properties",
            ].includes(ext) || entry.name.startsWith(".env")
          )
        ) {
          continue;
        }

        try {
          const content = fs.readFileSync(fullPath, "utf-8");
          const dsn = findDSNInContent(content);

          if (dsn) {
            const parsed = parseDSN(dsn);
            if (parsed) {
              return {
                dsn,
                parsed,
                source: path.relative(process.cwd(), fullPath),
                filePath: fullPath,
              };
            }
          }
        } catch {
          // Skip files we can't read
        }
      } else if (
        entry.isDirectory() &&
        !entry.name.startsWith(".") &&
        entry.name !== "node_modules"
      ) {
        const result = await searchDirectory(
          fullPath,
          maxDepth,
          currentDepth + 1
        );
        if (result) {
          return result;
        }
      }
    }
  } catch {
    // Skip directories we can't read
  }

  return null;
}

/**
 * Get project info from DSN (would need API call to fully resolve)
 */
export function getProjectIdFromDSN(dsn: string): string | null {
  const parsed = parseDSN(dsn);
  return parsed?.projectId || null;
}
