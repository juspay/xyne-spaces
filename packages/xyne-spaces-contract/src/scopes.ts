/**
 * OAuth scope registry for the Xyne Spaces public API.
 *
 * One read scope and one write scope per resource family, plus `spaces.admin`
 * for workspace/org administration. Every /v1 route declares exactly one scope
 * in its manifest entry; the SDK exposes these as typed constants.
 *
 * The 13 Slack-style app-permission scopes seeded by
 * `apps/backend/scripts/seed-app-permissions.ts` remain the vocabulary for the
 * legacy `/api/apps/*` surface. `LEGACY_SCOPE_EQUIVALENTS` records the overlap
 * so a single grant screen can explain both; no new tokens are issued with the
 * legacy names.
 */

export const RESOURCE_FAMILIES = [
  'channels',
  'conversations',
  'messages',
  'calls',
  'tickets',
  'boards',
  'projects',
  'canvases',
  'collections',
  'forms',
  'releases',
  'automations',
  'email',
  'users',
  'activities',
  'dashboards',
  'recaps',
  'links',
  'repos',
  'attachments',
  'search',
] as const;

export type ResourceFamily = (typeof RESOURCE_FAMILIES)[number];

/** Families that are read-only in v1 (no write scope is minted for them). */
const READ_ONLY_FAMILIES: ReadonlySet<ResourceFamily> = new Set<ResourceFamily>([
  'search',
  'attachments',
]);

export type ReadScope = `spaces.${ResourceFamily}:read`;
export type WriteScope = `spaces.${ResourceFamily}:write`;
export type AdminScope = 'spaces.admin';
export type Scope = ReadScope | WriteScope | AdminScope;

export const ADMIN_SCOPE: AdminScope = 'spaces.admin';

export function readScope(family: ResourceFamily): ReadScope {
  return `spaces.${family}:read`;
}

export function writeScope(family: ResourceFamily): WriteScope {
  return `spaces.${family}:write`;
}

export const ALL_SCOPES: readonly Scope[] = [
  ...RESOURCE_FAMILIES.map(readScope),
  ...RESOURCE_FAMILIES.filter((f) => !READ_ONLY_FAMILIES.has(f)).map(writeScope),
  ADMIN_SCOPE,
];

export interface ScopeDefinition {
  readonly scope: Scope;
  /** Shown on the consent screen. */
  readonly description: string;
  readonly isWrite: boolean;
}

const FAMILY_DESCRIPTIONS: Readonly<Record<ResourceFamily, string>> = {
  channels: 'channels, their participants, and your channel sections',
  conversations: 'conversation threads and their labels',
  messages: 'messages, drafts, and scheduled messages',
  calls: 'calls, recordings, and call scheduling',
  tickets: 'tickets, sub-tickets, tags, and support desk tickets',
  boards: 'boards, stages, and SLA policies',
  projects: 'projects and their configuration',
  canvases: 'canvases, comments, versions, and folders',
  collections: 'knowledge collections and their items',
  forms: 'forms, fields, and submitted values',
  releases: 'releases, RCAs, CoEs, and impact records',
  automations: 'automations and workflow definitions',
  email: 'email drafts, signatures, and read state',
  users: 'user directory, profiles, and presence',
  activities: 'your activity feed, bookmarks, and saved views',
  dashboards: 'dashboards and their components',
  recaps: 'channel and project recaps, and nudges',
  links: 'shared links',
  repos: 'connected repositories',
  attachments: 'file attachments',
  search: 'workspace search',
};

export const SCOPE_CATALOG: readonly ScopeDefinition[] = ALL_SCOPES.map((scope) => {
  if (scope === ADMIN_SCOPE) {
    return {
      scope,
      description: 'Administer the workspace, organizations, roles, groups, and access grants',
      isWrite: true,
    };
  }
  const [, familyPart] = scope.split('.');
  const [family, action] = (familyPart ?? '').split(':') as [ResourceFamily, 'read' | 'write'];
  const isWrite = action === 'write';
  return {
    scope,
    description: `${isWrite ? 'Modify' : 'Read'} ${FAMILY_DESCRIPTIONS[family]}`,
    isWrite,
  };
});

export function isScope(value: string): value is Scope {
  return (ALL_SCOPES as readonly string[]).includes(value);
}

/**
 * Overlap with the legacy `/api/apps/*` permission vocabulary. Informational —
 * the legacy names are frozen and never minted for SDK tokens.
 */
export const LEGACY_SCOPE_EQUIVALENTS: Readonly<Record<string, Scope>> = {
  'channels:read': 'spaces.channels:read',
  'chat:write': 'spaces.messages:write',
  'im:write': 'spaces.messages:write',
  'tickets:read': 'spaces.tickets:read',
  'tickets:write': 'spaces.tickets:write',
  'desk:read': 'spaces.tickets:read',
  'desk:write': 'spaces.tickets:write',
  'email:read': 'spaces.email:read',
  'calls:write': 'spaces.calls:write',
  'files:read': 'spaces.attachments:read',
  'users:read': 'spaces.users:read',
  'usergroups:read': 'spaces.users:read',
};
