/**
 * Fetch Sentry documentation pages and extract plain text for use as
 * ground-truth reference material in LLM judge prompts.
 *
 * Accepts an array of URLs — fetches all in parallel and concatenates results.
 * Returns "(no docs provided)" when the array is empty.
 */
export async function fetchDocsContent(urls: string[]): Promise<string> {
  if (urls.length === 0) {
    return "(no docs provided)";
  }

  // Restore real fetch — test preload mocks it to catch accidental network
  // calls, but we need real HTTP to reach docs.sentry.io.
  const realFetch = (globalThis as { __originalFetch?: typeof fetch })
    .__originalFetch;
  if (realFetch) {
    globalThis.fetch = realFetch;
  }

  const charBudgetPerUrl = Math.floor(6000 / urls.length);

  const results = await Promise.all(
    urls.map((url) => fetchOne(url, charBudgetPerUrl))
  );
  return results.join("\n\n---\n\n");
}

async function fetchOne(url: string, charLimit: number): Promise<string> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "sentry-init-eval/1.0" },
    });

    if (!res.ok) {
      return `(failed to fetch ${url}: ${res.status})`;
    }

    const html = await res.text();

    // Strip HTML tags, collapse whitespace
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, " ")
      .trim();

    return text.slice(0, charLimit);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `(failed to fetch ${url}: ${msg})`;
  }
}
