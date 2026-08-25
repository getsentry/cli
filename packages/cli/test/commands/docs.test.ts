import { beforeEach, describe, expect, test, vi } from "vitest";
import type { SentryContext } from "../../src/context.js";

const { detectDocsContext, listDocs, queryDocs, withProgress } = vi.hoisted(
  () => ({
    detectDocsContext: vi.fn(),
    listDocs: vi.fn(),
    queryDocs: vi.fn(),
    withProgress: vi.fn(),
  })
);

vi.mock("../../src/lib/docs-context.js", () => ({ detectDocsContext }));
vi.mock("../../src/lib/docs-service.js", () => ({ listDocs, queryDocs }));
vi.mock("../../src/lib/polling.js", () => ({ withProgress }));

import { listCommand } from "../../src/commands/docs/list.js";
import { queryCommand } from "../../src/commands/docs/query.js";

function createContext(): {
  context: SentryContext;
  stdoutWrite: ReturnType<typeof vi.fn>;
} {
  const stdoutWrite = vi.fn(() => true);
  return {
    context: {
      configDir: "/tmp",
      cwd: "/project",
      env: process.env,
      homeDir: "/tmp",
      process,
      stderr: { write: vi.fn(() => true) },
      stdin: process.stdin,
      stdout: { write: stdoutWrite },
    },
    stdoutWrite,
  };
}

beforeEach(() => {
  withProgress.mockReset();
  withProgress.mockImplementation(async (_options, fn) =>
    fn(() => {
      /* Progress rendering is covered by polling tests. */
    })
  );
  detectDocsContext.mockResolvedValue({
    frameworks: ["nextjs"],
    languages: ["javascript"],
    sentryConfigured: true,
  });
  listDocs.mockResolvedValue({
    results: [
      {
        description: "Configure tracing.",
        title: "Tracing",
        url: "https://docs.sentry.io/platforms/javascript/tracing/",
      },
    ],
  });
  queryDocs.mockResolvedValue({
    answer:
      "Use [tracing](https://docs.sentry.io/platforms/javascript/tracing/).\n\n## Sources\n\n- <https://docs.sentry.io/platforms/javascript/tracing/>",
    sources: ["https://docs.sentry.io/platforms/javascript/tracing/"],
  });
});

describe("docs commands", () => {
  test("queries docs with automatic safe context and returns it in JSON", async () => {
    const { context, stdoutWrite } = createContext();
    const func = await queryCommand.loader();

    await func.call(context, { json: true }, "How", "do", "I", "trace?");

    expect(queryDocs).toHaveBeenCalledWith("How do I trace?", {
      frameworks: ["nextjs"],
      languages: ["javascript"],
      sentryConfigured: true,
    });
    expect(
      JSON.parse(stdoutWrite.mock.calls.map((call) => call[0]).join(""))
    ).toEqual({
      answer:
        "Use [tracing](https://docs.sentry.io/platforms/javascript/tracing/).\n\n## Sources\n\n- <https://docs.sentry.io/platforms/javascript/tracing/>",
      detectedContext: {
        frameworks: ["nextjs"],
        languages: ["javascript"],
        sentryConfigured: true,
      },
      sources: ["https://docs.sentry.io/platforms/javascript/tracing/"],
    });
    expect(withProgress).toHaveBeenCalledWith(
      {
        json: true,
        message: "Searching Sentry docs…",
        rotatingMessages: [
          "Finding the relevant bits…",
          "Cross-checking the details…",
          "It’s getting there…",
          "Collecting trusted sources…",
        ],
        rotationIntervalMs: 4000,
      },
      expect.any(Function)
    );
  });

  test("lists deterministic keyword matches with a bounded limit", async () => {
    const { context, stdoutWrite } = createContext();
    const func = await listCommand.loader();

    await func.call(context, { json: false, limit: 5 }, "nextjs", "tracing");

    expect(listDocs).toHaveBeenCalledWith("nextjs tracing", 5);
    expect(stdoutWrite.mock.calls.map((call) => call[0]).join("")).toContain(
      "Tracing"
    );
    expect(withProgress).not.toHaveBeenCalled();
  });
});
