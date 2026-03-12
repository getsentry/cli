/**
 * Sentry API Client — barrel re-export
 *
 * All domain modules are re-exported here so existing imports
 * (`import { ... } from "./api-client.js"`) continue to work.
 *
 * Domain modules live in `src/lib/api/` and are organized by entity:
 * - infrastructure: shared helpers, types, constants, raw request functions
 * - organizations: org CRUD and region discovery
 * - projects: project CRUD, search, DSN keys
 * - teams: team CRUD, project teams
 * - repositories: repository listing
 * - issues: issue listing, lookup, status updates
 * - events: event retrieval and resolution
 * - traces: trace details and transactions
 * - logs: log listing, detailed fetch, trace-logs
 * - seer: Seer AI root cause analysis and planning
 * - trials: product trial management
 * - users: current user info
 */

export {
  findEventAcrossOrgs,
  getEvent,
  getLatestEvent,
  type ResolvedEvent,
  resolveEventInOrg,
} from "./api/events.js";
export {
  API_MAX_PER_PAGE,
  type ApiRequestOptions,
  apiRequest,
  apiRequestToRegion,
  buildSearchParams,
  type PaginatedResponse,
  parseLinkHeader,
  rawApiRequest,
} from "./api/infrastructure.js";
export {
  getIssue,
  getIssueByShortId,
  getIssueInOrg,
  type IssueSort,
  type IssuesPage,
  listIssuesAllPages,
  listIssuesPaginated,
  updateIssueStatus,
} from "./api/issues.js";
export {
  getLogs,
  listLogs,
  listTraceLogs,
} from "./api/logs.js";
export {
  getOrganization,
  getUserRegions,
  listOrganizations,
  listOrganizationsInRegion,
} from "./api/organizations.js";
export {
  createProject,
  findProjectByDsnKey,
  findProjectsByPattern,
  findProjectsBySlug,
  getProject,
  getProjectKeys,
  listProjects,
  listProjectsPaginated,
  matchesWordBoundary,
  type ProjectSearchResult,
  type ProjectWithOrg,
  tryGetPrimaryDsn,
} from "./api/projects.js";
export {
  listRepositories,
  listRepositoriesPaginated,
} from "./api/repositories.js";
export {
  getAutofixState,
  triggerRootCauseAnalysis,
  triggerSolutionPlanning,
} from "./api/seer.js";
export {
  addMemberToTeam,
  createTeam,
  listProjectTeams,
  listTeams,
  listTeamsPaginated,
} from "./api/teams.js";
export {
  getDetailedTrace,
  listTransactions,
} from "./api/traces.js";

export {
  getCustomerTrialInfo,
  getProductTrials,
  startProductTrial,
} from "./api/trials.js";

export { getCurrentUser } from "./api/users.js";
