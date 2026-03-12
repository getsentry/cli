/**
 * Product Trial API functions
 *
 * Functions for managing Sentry product trials (SaaS-only).
 */

import {
  type CustomerTrialInfo,
  CustomerTrialInfoSchema,
  type ProductTrial,
} from "../../types/index.js";

import { getControlSiloUrl } from "../sentry-client.js";

import { apiRequestToRegion } from "./infrastructure.js";

/**
 * Fetch all product trials for an organization.
 *
 * Fetches customer data from the internal `/customers/{org}/` endpoint
 * and returns the `productTrials` array. This is a getsentry SaaS-only
 * endpoint — self-hosted instances will 404, which callers should handle.
 *
 * @param orgSlug - Organization slug
 * @returns Array of product trials (may be empty)
 */
export async function getProductTrials(
  orgSlug: string
): Promise<ProductTrial[]> {
  // /customers/ is a control silo endpoint (billing), not region-scoped
  const { data } = await apiRequestToRegion<CustomerTrialInfo>(
    getControlSiloUrl(),
    `/customers/${orgSlug}/`,
    { schema: CustomerTrialInfoSchema }
  );
  return data.productTrials ?? [];
}

/**
 * Fetch full customer trial info including plan trial status.
 *
 * Returns the complete {@link CustomerTrialInfo} including both product trials
 * and plan-level trial info (`canTrial`, `isTrial`, `trialEnd`, `planDetails`),
 * which needs to display plan trials alongside product trials.
 *
 * For simpler use cases that only need product trials, use {@link getProductTrials}.
 *
 * @param orgSlug - Organization slug
 * @returns Customer trial info with product trials, plan trial status, and plan details
 */
export async function getCustomerTrialInfo(
  orgSlug: string
): Promise<CustomerTrialInfo> {
  const { data } = await apiRequestToRegion<CustomerTrialInfo>(
    getControlSiloUrl(),
    `/customers/${orgSlug}/`,
    { schema: CustomerTrialInfoSchema }
  );
  return data;
}

/**
 * Start a product trial for the organization.
 *
 * Sends a PUT to the internal `/customers/{org}/product-trial/` endpoint.
 * Any org member with `org:read` or higher permission can start a trial.
 *
 * @param orgSlug - Organization slug
 * @param category - API category name (e.g., "seerUsers", "replays", "transactions")
 * @throws {ApiError} On API errors (e.g., trial already active, permissions)
 */
export async function startProductTrial(
  orgSlug: string,
  category: string
): Promise<void> {
  // /customers/ is a control silo endpoint (billing), not region-scoped
  await apiRequestToRegion(
    getControlSiloUrl(),
    `/customers/${orgSlug}/product-trial/`,
    {
      method: "PUT",
      body: {
        referrer: "sentry-cli",
        productTrial: { category, reasonCode: 0 },
      },
    }
  );
}
