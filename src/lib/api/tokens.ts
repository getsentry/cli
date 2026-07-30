/**
 * Org Auth Token API functions
 *
 * CRUD operations for organization-level authentication tokens.
 * These endpoints live on the control silo and manage org auth tokens
 * (used for CI, release management, and other automated workflows).
 */

import { z } from "zod";
import { type OrgAuthToken, OrgAuthTokenSchema } from "../../types/index.js";
import { getControlSiloUrl } from "../sentry-client.js";
import {
  apiRequestToRegion,
  apiRequestToRegionNoContent,
} from "./infrastructure.js";

/**
 * List active org auth tokens for an organization.
 *
 * Returns tokens sorted by last-used date (most recent first), with
 * never-used tokens sorted by name then creation date.
 *
 * @param orgSlug - Organization slug
 * @returns Array of org auth tokens (without full token values)
 */
export async function listOrgAuthTokens(
  orgSlug: string
): Promise<OrgAuthToken[]> {
  const { data } = await apiRequestToRegion<OrgAuthToken[]>(
    getControlSiloUrl(),
    `/organizations/${orgSlug}/org-auth-tokens/`,
    { schema: z.array(OrgAuthTokenSchema) }
  );
  return data;
}

/**
 * Create a new org auth token.
 *
 * The response includes the full token value in the `token` field — this is
 * the only time it is available. Subsequent GET requests only return the
 * last 4 characters.
 *
 * @param orgSlug - Organization slug
 * @param name - Human-readable name for the token
 * @returns The created token (including the full token value)
 */
export async function createOrgAuthToken(
  orgSlug: string,
  name: string
): Promise<OrgAuthToken> {
  const { data } = await apiRequestToRegion<OrgAuthToken>(
    getControlSiloUrl(),
    `/organizations/${orgSlug}/org-auth-tokens/`,
    {
      method: "POST",
      body: { name },
      schema: OrgAuthTokenSchema,
    }
  );
  return data;
}

/**
 * Delete (deactivate) an org auth token.
 *
 * Tokens are soft-deleted by setting `date_deactivated`. The token
 * immediately stops working for API authentication.
 *
 * @param orgSlug - Organization slug
 * @param tokenId - Numeric token ID
 */
export async function deleteOrgAuthToken(
  orgSlug: string,
  tokenId: string
): Promise<void> {
  await apiRequestToRegionNoContent(
    getControlSiloUrl(),
    `/organizations/${orgSlug}/org-auth-tokens/${tokenId}/`,
    { method: "DELETE" }
  );
}
