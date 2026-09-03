// Zero internal API (mapped via #imports in package.json)
import { asQueryInternals } from '#zero-internal/query-internals';
import { Context, schema } from '@xyne/shared';
import { logger } from '@/utils/logger';

// The tenant boundary is applied here, to every query, rather than trusting each
// query definition to include it. Every Zero table is classified in TABLE_SCOPES
// below: a table with a workspaceId column is scoped to the caller's workspace, a
// few org-level / parent-scoped tables get a custom rule, and genuine global
// reference data is passed through. TABLE_SCOPES is typed `Record<TableName,
// ScopeKind>`, so a NEW table added to the schema without a scope entry FAILS TO
// COMPILE — tenant scoping can never be silently skipped for a new table.

type ScopableQuery = {
  where: (...args: unknown[]) => ScopableQuery;
  whereExists: (...args: unknown[]) => ScopableQuery;
};

type OrgScopeRule = (query: ScopableQuery, ctx: Context) => ScopableQuery;

// Custom rules for the few tables without a workspaceId column — scoped either by
// the caller's org membership or through a parent row that does carry workspaceId.
const CUSTOM = {
  // An organisation is visible to its own members and to a workspace linked to it.
  organizations: (query, ctx) =>
    query.where(({ or, exists }: any) =>
      or(
        exists('members', (m: ScopableQuery) => m.where('memberId', ctx.memberId)),
        exists('workspaceOrgs', (wo: ScopableQuery) => wo.where('workspaceId', ctx.workspaceId)),
      ),
    ),
  org_members: (query, ctx) =>
    query.whereExists('organization', (o: ScopableQuery) =>
      o.whereExists('members', (m: ScopableQuery) => m.where('memberId', ctx.memberId)),
    ),
  // The caller's own workspace, plus the others in their organisation.
  workspaces: (query, ctx) =>
    query.where(({ cmp, or, exists }: any) =>
      or(
        cmp('id', '=', ctx.workspaceId),
        exists('orgMembers', (m: ScopableQuery) => m.where('memberId', ctx.memberId)),
      ),
    ),
  // Canvas comment tables carry canvasId, not workspaceId; scope through the canvas.
  canvas_comment_threads: (query, ctx) =>
    query.whereExists('canvas', (c: ScopableQuery) => c.where('workspaceId', ctx.workspaceId)),
  canvas_comments: (query, ctx) =>
    query.whereExists('thread', (t: ScopableQuery) =>
      t.whereExists('canvas', (c: ScopableQuery) => c.where('workspaceId', ctx.workspaceId)),
    ),
} satisfies Record<string, OrgScopeRule>;

type TableName = keyof typeof schema.tables;

/**
 * How a table is tenant-scoped:
 *  - 'workspace' : filtered to the caller's workspace by its workspaceId column
 *  - 'global'    : tenant-independent reference data, served as-is
 *  - a custom rule (for a table without a workspaceId column)
 */
type ScopeKind = 'workspace' | 'global' | OrgScopeRule;

// EVERY Zero table must appear here. Because this is `Record<TableName, ScopeKind>`,
// adding a table to the schema without a scope entry is a COMPILE error — the way to
// remember to make a deliberate tenant-scoping decision for each new table.
const TABLE_SCOPES: Record<TableName, ScopeKind> = {
  activities: 'workspace',
  agent_tools_mappings: 'workspace',
  agents: 'workspace',
  application_release_tickets: 'workspace',
  applications: 'workspace',
  apps: 'workspace',
  board_complexity_scores: 'workspace',
  board_sla_policies: 'workspace',
  boards: 'workspace',
  bookmarks: 'workspace',
  call_participants: 'workspace',
  calls: 'workspace',
  canvas_comment_threads: CUSTOM.canvas_comment_threads,
  canvas_comments: CUSTOM.canvas_comments,
  canvas_folders: 'workspace',
  canvas_participants: 'workspace',
  canvas_user_status: 'workspace',
  canvas_versions: 'workspace',
  canvases: 'workspace',
  channel_board_mappings: 'workspace',
  channel_daily_recaps: 'workspace',
  channel_participants: 'workspace',
  channel_recaps: 'workspace',
  channel_sections: 'workspace',
  channel_stats: 'workspace',
  channel_user_status: 'workspace',
  channels: 'workspace',
  classification_mappings: 'workspace',
  coes: 'workspace',
  collection_items: 'workspace',
  collection_permissions: 'workspace',
  collections: 'workspace',
  conversation_label_mappings: 'workspace',
  conversation_labels: 'workspace',
  conversation_participants: 'workspace',
  conversations: 'workspace',
  custom_emojis: 'workspace',
  dashboard_queries_mapping: 'workspace',
  dashboards: 'workspace',
  delayed_messages: 'workspace',
  draft_messages: 'workspace',
  email_channel_preferences: 'workspace',
  email_drafts: 'workspace',
  email_reads: 'workspace',
  email_signatures: 'workspace',
  emails: 'workspace',
  entity_access: 'workspace',
  form_entity_values: 'workspace',
  form_fields: 'workspace',
  forms: 'workspace',
  forms_context_mapping: 'workspace',
  global_fields: 'workspace',
  guest_access: 'workspace',
  impacts: 'workspace',
  installed_apps: 'workspace',
  invitations: 'workspace',
  link_access: 'workspace',
  links: 'workspace',
  lookup_values: 'global',
  merchants: 'global',
  message_artifacts: 'workspace',
  message_attachments: 'workspace',
  messages: 'workspace',
  models: 'workspace',
  notification_preferences: 'workspace',
  org_members: CUSTOM.org_members,
  organizations: CUSTOM.organizations,
  proactive_nudges: 'workspace',
  project_tags: 'workspace',
  projects: 'workspace',
  pull_requests: 'workspace',
  queries: 'workspace',
  rcas: 'workspace',
  reaction_counts: 'workspace',
  reactions: 'workspace',
  recaps: 'workspace',
  recurring_call_participants: 'workspace',
  recurring_call_series: 'workspace',
  release_attributions: 'workspace',
  release_change_types: 'workspace',
  release_changes: 'workspace',
  release_events: 'workspace',
  repos: 'workspace',
  resource_access: 'workspace',
  resources: 'global',
  roles: 'workspace',
  saved_user_configuration_values: 'workspace',
  saved_user_configurations: 'workspace',
  sdlc_artifacts: 'workspace',
  sdlc_entity_links: 'workspace',
  sdlc_tracks: 'workspace',
  stage_approvers: 'workspace',
  stage_pr_status_mappings: 'workspace',
  stage_transitions: 'workspace',
  stages: 'workspace',
  sub_tickets: 'workspace',
  summary_templates: 'workspace',
  surface_links: 'workspace',
  surface_nudge_counts: 'workspace',
  surface_nudges: 'workspace',
  ticket_activities: 'workspace',
  ticket_assignments: 'workspace',
  ticket_entity_mappings: 'workspace',
  ticket_exports: 'workspace',
  ticket_reference_mappings: 'workspace',
  ticket_stage_eta: 'workspace',
  ticket_stage_requests: 'workspace',
  ticket_sub_ticket_mappings: 'workspace',
  ticket_tag_mappings: 'workspace',
  ticket_tags: 'workspace',
  ticket_user_mailbox: 'workspace',
  tickets: 'workspace',
  tools: 'workspace',
  user_assignment_states: 'workspace',
  user_expertise_mappings: 'workspace',
  user_group_mappings: 'workspace',
  user_groups: 'workspace',
  user_preferences: 'workspace',
  user_presence: 'workspace',
  user_profiles: 'workspace',
  user_role_mappings: 'workspace',
  user_workload_mappings: 'workspace',
  users: 'workspace',
  workflow_executions: 'workspace',
  workflows: 'workspace',
  workspace_organizations: 'workspace',
  workspaces: CUSTOM.workspaces,
};

export function scopeQueryToTenant<T>(query: T, ctx: Context, queryName: string): T {
  // @ts-ignore - asQueryInternals works with any Query type at runtime
  const table = String(asQueryInternals(query).ast.table) as TableName;
  const scopable = query as unknown as ScopableQuery;

  const scope = TABLE_SCOPES[table];

  if (scope === 'workspace') {
    // Not expected on the read path — real callers carry a workspaceId. An absent
    // one still fails closed (Zero compiles `.where('workspaceId', undefined)` to
    // `workspaceId = null`, which matches no rows), but log it so an unexpected
    // context is visible rather than silently returning empty.
    if (!ctx.workspaceId) {
      logger.warn('zero_query_missing_workspace', { query: queryName, table });
    }
    return scopable.where('workspaceId', ctx.workspaceId) as unknown as T;
  }

  if (scope === 'global') {
    return query;
  }

  if (typeof scope === 'function') {
    if (!ctx.memberId) {
      logger.warn('zero_query_missing_member', { query: queryName, table });
    }
    return scope(scopable, ctx) as unknown as T;
  }

  // Unreachable while TABLE_SCOPES stays exhaustive (a new table won't compile), but
  // keep a runtime fail-closed for any unexpected table name from the query AST.
  logger.error('zero_query_unscoped_table', { query: queryName, table });
  throw new Error(`Query '${queryName}' cannot be served: table '${table}' has no tenant scope`);
}
