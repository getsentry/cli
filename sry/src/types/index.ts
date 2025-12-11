// Sentry API Types

export type SentryOrganization = {
  id: string;
  slug: string;
  name: string;
  dateCreated: string;
  isEarlyAdopter: boolean;
  require2FA: boolean;
  avatar: {
    avatarType: string;
    avatarUuid: string | null;
  };
  features: string[];
};

export type SentryProject = {
  id: string;
  slug: string;
  name: string;
  platform: string | null;
  dateCreated: string;
  isBookmarked: boolean;
  isMember: boolean;
  features: string[];
  firstEvent: string | null;
  firstTransactionEvent: boolean;
  access: string[];
  hasAccess: boolean;
  hasMinifiedStackTrace: boolean;
  hasMonitors: boolean;
  hasProfiles: boolean;
  hasReplays: boolean;
  hasSessions: boolean;
  isInternal: boolean;
  isPublic: boolean;
  avatar: {
    avatarType: string;
    avatarUuid: string | null;
  };
  color: string;
  status: string;
};

export type SentryIssue = {
  id: string;
  shortId: string;
  title: string;
  culprit: string;
  permalink: string;
  logger: string | null;
  level: string;
  status: "resolved" | "unresolved" | "ignored";
  statusDetails: Record<string, unknown>;
  isPublic: boolean;
  platform: string;
  project: {
    id: string;
    name: string;
    slug: string;
    platform: string;
  };
  type: string;
  metadata: {
    value?: string;
    type?: string;
    filename?: string;
    function?: string;
    display_title_with_tree_label?: boolean;
  };
  numComments: number;
  assignedTo: {
    id: string;
    name: string;
    type: string;
  } | null;
  isBookmarked: boolean;
  isSubscribed: boolean;
  subscriptionDetails: {
    reason: string;
  } | null;
  hasSeen: boolean;
  annotations: string[];
  isUnhandled: boolean;
  count: string;
  userCount: number;
  firstSeen: string;
  lastSeen: string;
};

export type SentryEvent = {
  eventID: string;
  id: string;
  projectID: string;
  context: Record<string, unknown>;
  contexts: Record<string, unknown>;
  dateCreated: string;
  dateReceived: string;
  entries: unknown[];
  errors: unknown[];
  fingerprints: string[];
  groupID: string;
  message: string;
  metadata: Record<string, unknown>;
  platform: string;
  sdk: {
    name: string;
    version: string;
  } | null;
  tags: Array<{
    key: string;
    value: string;
  }>;
  title: string;
  type: string;
  user: {
    id?: string;
    email?: string;
    username?: string;
    ip_address?: string;
  } | null;
};

// Config Types

export type SryConfig = {
  auth?: {
    token?: string;
    refreshToken?: string;
    expiresAt?: number;
  };
  defaults?: {
    organization?: string;
    project?: string;
  };
};

// OAuth Types

export type DeviceCodeResponse = {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  expires_in: number;
  interval: number;
};

export type TokenResponse = {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
};

export type TokenErrorResponse = {
  error: string;
  error_description?: string;
};

// DSN Types

export type ParsedDSN = {
  protocol: string;
  publicKey: string;
  host: string;
  projectId: string;
};

export type DSNDetectionResult = {
  dsn: string;
  parsed: ParsedDSN;
  source: string;
  filePath: string;
};
