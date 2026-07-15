import { enrich401Detail } from "../api/infrastructure.js";
import { ApiError, HostScopeError } from "../errors.js";
import { isSaaSTrustOrigin, normalizeOrigin } from "../sentry-urls.js";
import { getActiveTokenHost } from "../token-host.js";
import {
  DEFAULT_MASTRA_API_URL,
  MASTRA_API_URL,
  WORKFLOW_ID,
} from "./constants.js";

const INIT_SERVICE_REJECTED_TOKEN_MESSAGE =
  "Sentry Init setup service rejected your authentication token.";
const WORKFLOW_ENDPOINT = `/api/workflows/${WORKFLOW_ID}`;
export const WORKFLOW_CREATE_RUN_ENDPOINT = `${WORKFLOW_ENDPOINT}/create-run`;
export const WORKFLOW_RESUME_ASYNC_ENDPOINT = `${WORKFLOW_ENDPOINT}/resume-async`;
export const WORKFLOW_START_ASYNC_ENDPOINT = `${WORKFLOW_ENDPOINT}/start-async`;
const MASTRA_HTTP_401_RE = /HTTP error!\s*status:\s*401\b/i;

function classifyInitServiceAuthFailure(
  err: unknown,
  endpoint: string
): ApiError | null {
  if (!(err instanceof Error && MASTRA_HTTP_401_RE.test(err.message))) {
    return null;
  }

  return new ApiError(
    INIT_SERVICE_REJECTED_TOKEN_MESSAGE,
    401,
    enrich401Detail("Unauthorized: invalid token"),
    endpoint
  );
}

export async function withInitServiceAuthClassification<T>(
  operation: () => Promise<T>,
  endpoint: string
): Promise<T> {
  try {
    return await operation();
  } catch (err) {
    throw classifyInitServiceAuthFailure(err, endpoint) ?? err;
  }
}

export function assertHostedInitServiceAcceptsTokenHost(): void {
  const tokenHost = getActiveTokenHost();
  const usesHostedInitService =
    normalizeOrigin(MASTRA_API_URL) === normalizeOrigin(DEFAULT_MASTRA_API_URL);

  if (tokenHost && usesHostedInitService && !isSaaSTrustOrigin(tokenHost)) {
    throw new HostScopeError(
      "Hosted Sentry Init setup service",
      "https://sentry.io",
      tokenHost
    );
  }
}
