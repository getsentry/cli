import unauthorizedFixture from "../fixtures/errors/unauthorized.json";

export type RouteHandler = (
  req: Request,
  params: Record<string, string>
) => MockResponse | Promise<MockResponse>;

export type MockResponse = {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
};

export type MockRoute = {
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  /** Path pattern with optional :params (e.g., "/api/0/organizations/:orgSlug/") */
  path: string;
  /** Static response body, or handler function for dynamic responses */
  response: unknown | RouteHandler;
  /** HTTP status code (default: 200) */
  status?: number;
};

export type MockServerOptions = {
  /** Valid tokens for authentication. If set, requests without a valid token get 401. */
  validTokens?: string[];
};

type CompiledRoute = {
  method: string;
  pattern: RegExp;
  paramNames: string[];
  response: unknown | RouteHandler;
  status: number;
};

function compilePath(path: string): { pattern: RegExp; paramNames: string[] } {
  const paramNames: string[] = [];
  const regexStr = path
    .replace(/:[a-zA-Z]+/g, (match) => {
      paramNames.push(match.slice(1));
      return "([^/]+)";
    })
    // Make trailing slash optional
    .replace(/\/$/, "/?");

  return {
    pattern: new RegExp(`^${regexStr}$`),
    paramNames,
  };
}

function matchRoute(
  method: string,
  pathname: string,
  routes: CompiledRoute[]
): { route: CompiledRoute; params: Record<string, string> } | null {
  for (const route of routes) {
    if (route.method !== method) {
      continue;
    }

    const match = pathname.match(route.pattern);
    if (match) {
      const params: Record<string, string> = {};
      for (let i = 0; i < route.paramNames.length; i++) {
        params[route.paramNames[i]] = match[i + 1];
      }
      return { route, params };
    }
  }
  return null;
}

export type MockServer = {
  readonly url: string;
  start(): Promise<void>;
  stop(): void;
};

function isAuthorized(req: Request, validTokens: string[]): boolean {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return false;
  }
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return false;
  }
  return validTokens.includes(match[1]);
}

export function createMockServer(
  routes: MockRoute[],
  options: MockServerOptions = {}
): MockServer {
  let server: ReturnType<typeof Bun.serve> | null = null;
  let port = 0;
  const { validTokens } = options;
  const compiledRoutes: CompiledRoute[] = routes.map((route) => {
    const { pattern, paramNames } = compilePath(route.path);
    return {
      method: route.method,
      pattern,
      paramNames,
      response: route.response,
      status: route.status ?? 200,
    };
  });

  return {
    get url() {
      return `http://localhost:${port}`;
    },

    async start() {
      server = Bun.serve({
        port: 0,
        async fetch(req) {
          const url = new URL(req.url);
          const pathname = url.pathname;
          const method = req.method;

          if (validTokens && !isAuthorized(req, validTokens)) {
            return new Response(JSON.stringify(unauthorizedFixture), {
              status: 401,
              headers: { "Content-Type": "application/json" },
            });
          }

          const match = matchRoute(method, pathname, compiledRoutes);
          if (!match) {
            return new Response(JSON.stringify({ detail: "Not found" }), {
              status: 404,
              headers: { "Content-Type": "application/json" },
            });
          }

          const { route, params } = match;
          let responseData: MockResponse;
          if (typeof route.response === "function") {
            const result = await (route.response as RouteHandler)(req, params);
            responseData = result;
          } else {
            responseData = { body: route.response, status: route.status };
          }

          const status = responseData.status ?? route.status;
          const body = responseData.body;
          const headers = {
            "Content-Type": "application/json",
            ...responseData.headers,
          };

          return new Response(
            body !== undefined ? JSON.stringify(body) : undefined,
            { status, headers }
          );
        },
      });

      port = server.port;
    },

    stop() {
      server?.stop();
      server = null;
    },
  };
}
