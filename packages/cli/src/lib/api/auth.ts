import { z } from "zod";

import { getControlSiloUrl } from "../sentry-client.js";
import { apiRequestToRegion } from "./infrastructure.js";

const AuthStatusSchema = z.object({
  auth: z
    .object({
      scopes: z.array(z.string()),
    })
    .nullable(),
});

export async function getCurrentAuthScopes(): Promise<
  readonly string[] | null
> {
  const { data } = await apiRequestToRegion(getControlSiloUrl(), "", {
    schema: AuthStatusSchema,
  });
  return data.auth?.scopes ?? null;
}
