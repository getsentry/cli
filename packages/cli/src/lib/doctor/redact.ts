/**
 * Redaction and untrusted-input validation for captured project files.
 *
 * Redaction happens at the capture boundary, not at render time, so a secret
 * never lives in a `Capture` at all — which means no renderer, no JSON export,
 * and no telemetry path can leak one by forgetting to scrub.
 *
 * The DSN public key is a deliberate exception. It is public by construction
 * (it ships in browser bundles), and every meaningful check needs it.
 */

/**
 * Secret-ish assignments across the three syntaxes we capture:
 * `key: "v"` (YAML/JS object), `key = 'v'` (TOML/Ruby/Gradle), `KEY=v` (env).
 *
 * Deliberately narrow: a blanket `key=value` rule would redact `debug=true`
 * and destroy the scalar values checks read.
 */
const SECRET_ASSIGN_RE =
  /\b([\w-]*(?:auth[_-]?token|api[_-]?key|access[_-]?key|client[_-]?secret|password|passwd|secret|token))(\s*[:=]\s*)(["']?)([^"'\s,;)}]+)\3/gi;

/** `//user:password@host` — credentials embedded in a URI. */
const URI_USERINFO_RE = /\/\/[^@/\s]*:[^@/\s]+@/g;

/**
 * Strip secrets from a captured block of config text.
 *
 * A DSN (`https://key@host/id`) has no colon before the `@`, so the userinfo
 * rule leaves it intact — which is exactly the exception we want.
 */
export function redactConfigText(text: string): string {
  return text
    .replace(URI_USERINFO_RE, "//[REDACTED]@")
    .replace(
      SECRET_ASSIGN_RE,
      (_match, key: string, sep: string, quote: string) =>
        `${key}${sep}${quote}[REDACTED]${quote}`
    );
}

/** Relative POSIX-ish path segments only: no traversal, no shell metachars. */
const SAFE_PATH_RE = /^(?!\/)(?!.*(^|\/)\.\.(\/|$))[\w./@-]+$/;

/**
 * Validate a path before it is interpolated into a shell command, a URL, or an
 * LLM prompt. Returns `null` for anything suspicious; callers report the value
 * as malformed rather than passing it through.
 *
 * Named `safeFilePath`, not `safePath` — the scan adapters already export that.
 */
export function safeFilePath(value: string): string | null {
  return SAFE_PATH_RE.test(value) ? value : null;
}
