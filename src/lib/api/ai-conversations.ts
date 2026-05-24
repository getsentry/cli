/**
 * AI Conversations API functions
 *
 * Functions for listing and retrieving AI conversation data
 * from the Sentry Explore conversations endpoints.
 */

import {
  type AIConversationSpan,
  AIConversationSpanSchema,
  type ConversationListItem,
  ConversationListItemSchema,
} from "../../types/ai-conversations.js";

import { resolveOrgRegion } from "../region.js";

import {
  apiRequestToRegion,
  type PaginatedResponse,
  parseLinkHeader,
} from "./infrastructure.js";

export async function listConversations(
  orgSlug: string,
  options: {
    query?: string;
    limit?: number;
    cursor?: string;
    statsPeriod?: string;
    start?: string;
    end?: string;
    project?: string;
  } = {}
): Promise<PaginatedResponse<ConversationListItem[]>> {
  const regionUrl = await resolveOrgRegion(orgSlug);

  const params: Record<string, string> = {
    per_page: String(options.limit ?? 10),
  };
  if (options.statsPeriod) {
    params.statsPeriod = options.statsPeriod;
  }
  if (options.start) {
    params.start = options.start;
  }
  if (options.end) {
    params.end = options.end;
  }
  if (options.cursor) {
    params.cursor = options.cursor;
  }
  if (options.query) {
    params.query = options.query;
  }
  if (options.project) {
    params.project = options.project;
  }

  const { data, headers } = await apiRequestToRegion<unknown[]>(
    regionUrl,
    `/organizations/${orgSlug}/ai-conversations/`,
    { params }
  );

  const items = data.map((item) => ConversationListItemSchema.parse(item));
  const { nextCursor } = parseLinkHeader(headers.get("link") ?? null);

  return { data: items, nextCursor };
}

export async function getConversationSpans(
  orgSlug: string,
  conversationId: string,
  options: {
    statsPeriod?: string;
    project?: string;
    perPage?: number;
  } = {}
): Promise<AIConversationSpan[]> {
  const regionUrl = await resolveOrgRegion(orgSlug);

  const params: Record<string, string> = {
    per_page: String(options.perPage ?? 1000),
    statsPeriod: options.statsPeriod ?? "30d",
  };
  if (options.project) {
    params.project = options.project;
  }

  const spans: AIConversationSpan[] = [];
  let cursor: string | undefined;

  for (let page = 0; page < 10; page++) {
    if (cursor) {
      params.cursor = cursor;
    }

    const { data, headers } = await apiRequestToRegion<unknown[]>(
      regionUrl,
      `/organizations/${orgSlug}/ai-conversations/${encodeURIComponent(conversationId)}/`,
      { params }
    );

    spans.push(...data.map((s) => AIConversationSpanSchema.parse(s)));
    const parsed = parseLinkHeader(headers.get("link") ?? null);
    cursor = parsed.nextCursor;
    if (!cursor) {
      break;
    }
  }

  return spans;
}
