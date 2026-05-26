import { beforeEach, describe, expect, test } from "vitest";
import {
  __testing,
  listCommand,
} from "../../../../src/commands/alert/issues/list.js";
import { DEFAULT_SENTRY_URL } from "../../../../src/lib/constants.js";
import { setAuthToken } from "../../../../src/lib/db/auth.js";
import {
  setDefaultOrganization,
  setDefaultProject,
} from "../../../../src/lib/db/defaults.js";
import { setOrgRegion } from "../../../../src/lib/db/regions.js";
import { mockFetch, useTestConfigDir } from "../../../helpers.js";

const getConfigDir = useTestConfigDir("test-alert-issues-list-", {
  isolateProjectRoot: true,
});

type ListFlags = {
  readonly web: boolean;
  readonly fresh: boolean;
  readonly limit: number;
  readonly cursor?: string;
  readonly json: boolean;
  readonly fields?: string[];
  readonly query?: string;
};

type ListFunc = (
  this: unknown,
  flags: ListFlags,
  target?: string
) => Promise<void>;

function createContext() {
  const stdout = {
    output: "",
    write(s: string) {
      stdout.output += s;
    },
  };
  const stderr = {
    output: "",
    write(s: string) {
      stderr.output += s;
    },
  };
  return {
    context: {
      process,
      stdout,
      stderr,
      cwd: getConfigDir(),
    },
    stdout,
  };
}

describe("alert issues list pagination", () => {
  let func: ListFunc;

  beforeEach(async () => {
    func = (await listCommand.loader()) as unknown as ListFunc;
    await setAuthToken("test-token");
    setOrgRegion("test-org", DEFAULT_SENTRY_URL);
    setDefaultOrganization("test-org");
    setDefaultProject("test-project");
  });

  test("hasMore is false when limit is reached without next cursor", async () => {
    globalThis.fetch = mockFetch(async (input, init) => {
      const req = new Request(input, init);
      if (req.url.includes("/projects/test-org/test-project/rules/")) {
        return new Response(
          JSON.stringify([
            {
              id: "1",
              name: "Rule Alpha",
              status: "active",
              actionMatch: "any",
              conditions: [],
              actions: [],
              frequency: 30,
              environment: null,
              owner: null,
              projects: ["test-project"],
              dateCreated: "2026-01-01T00:00:00Z",
            },
          ]),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              Link: '<https://sentry.io/api/0/>; rel="next"; results="false"; cursor="0:0:0"',
            },
          }
        );
      }
      return new Response(JSON.stringify({ detail: "Not found" }), {
        status: 404,
      });
    });

    const { context, stdout } = createContext();
    await func.call(context, {
      web: false,
      fresh: false,
      limit: 1,
      json: true,
    });

    const parsed = JSON.parse(stdout.output);
    expect(parsed.hasMore).toBe(false);
    expect(parsed.data).toHaveLength(1);
  });

  test("empty query page keeps hasMore when next cursor exists", async () => {
    globalThis.fetch = mockFetch(async (input, init) => {
      const req = new Request(input, init);
      if (req.url.includes("/projects/test-org/test-project/rules/")) {
        return new Response(
          JSON.stringify([
            {
              id: "1",
              name: "Rule Alpha",
              status: "active",
              actionMatch: "any",
              conditions: [],
              actions: [],
              frequency: 30,
              environment: null,
              owner: null,
              projects: ["test-project"],
              dateCreated: "2026-01-01T00:00:00Z",
            },
          ]),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              Link: '<https://sentry.io/api/0/>; rel="next"; results="true"; cursor="next:0:0"',
            },
          }
        );
      }
      return new Response(JSON.stringify({ detail: "Not found" }), {
        status: 404,
      });
    });

    const { context, stdout } = createContext();
    await func.call(context, {
      web: false,
      fresh: false,
      limit: 1,
      json: true,
      query: "zzz",
    });

    const parsed = JSON.parse(stdout.output);
    expect(parsed.data).toEqual([]);
    expect(parsed.hasMore).toBe(true);
  });
});

/**
 * `phase1HasMore` is shared (same `some(success && hasMore)` logic) in metrics list;
 * unit tests live here only to avoid duplicating the same cases across both files.
 */
describe("alert issues list __testing", () => {
  const { phase1HasMore } = __testing;
  const sampleTarget = {
    org: "a",
    project: "b",
    orgDisplay: "a",
    projectDisplay: "b",
  };

  test("phase1HasMore: OR of per-target hasMore, ignores failed fetches", () => {
    const success = (hasMore: boolean) => ({
      success: true as const,
      data: { hasMore, rules: [] as const, target: sampleTarget },
    });
    expect(phase1HasMore([success(false), success(true)])).toBe(true);
    expect(phase1HasMore([success(false), success(false)])).toBe(false);
    expect(
      phase1HasMore([
        { success: false, error: new Error("nope") },
        success(true),
      ])
    ).toBe(true);
  });
});
