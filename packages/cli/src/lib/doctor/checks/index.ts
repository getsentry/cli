/** The ordered check registry. Order here is report order. */

import type { Check } from "../types.js";
import { TIER1_CHECKS } from "./tier1.js";
import { TIER2_CHECKS } from "./tier2.js";

export const REGISTRY: readonly Check[] = [...TIER1_CHECKS, ...TIER2_CHECKS];
