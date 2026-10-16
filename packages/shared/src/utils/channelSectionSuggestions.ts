import { ChannelScopeType, ChannelType, ProjectType } from '../zero/types.js';
import { isDeskChannelType } from './channel.js';

export const SECTION_NAME_MAX_LENGTH = 50;
export const DEFAULT_MIN_CHANNELS = 2;

export const OTHER_PROJECTS_SUGGESTION_ID = '__otherProjects__';
export const OTHER_PROJECTS_SUGGESTION_NAME = 'Everything else';

export const ACTIVE_SUGGESTION_ID = '__active__';
export const DORMANT_SUGGESTION_ID = '__dormant__';
export const ACTIVE_SUGGESTION_NAME = 'In Focus';
export const DORMANT_SUGGESTION_NAME = 'In the Background';

export const BOT_SUGGESTION_ID = '__bots__';
export const GROUP_DM_SUGGESTION_ID = '__groupDms__';
export const FREQUENT_CONTACTS_SUGGESTION_ID = '__frequentContacts__';
export const BOT_SUGGESTION_NAME = 'Apps & Bots';
export const GROUP_DM_SUGGESTION_NAME = 'Group DMs';
export const FREQUENT_CONTACTS_SUGGESTION_NAME = 'Top contacts';
export const MAX_FREQUENT_CONTACTS = 5;
export const MAX_GROUP_DMS = 3;
export const MAX_BOT_DMS = 2;

export const DEFAULT_ACTIVE_WINDOW_DAYS = 30;
export const MIN_ACTIVE_WINDOW_DAYS = 1;
export const MAX_ACTIVE_WINDOW_DAYS = 365;

const DAY_MS = 24 * 60 * 60 * 1000;

export const clampActiveWindowDays = (days: number): number => {
  if (!Number.isFinite(days)) return DEFAULT_ACTIVE_WINDOW_DAYS;
  const rounded = Math.round(days);
  if (rounded < MIN_ACTIVE_WINDOW_DAYS) return MIN_ACTIVE_WINDOW_DAYS;
  if (rounded > MAX_ACTIVE_WINDOW_DAYS) return MAX_ACTIVE_WINDOW_DAYS;
  return rounded;
};

export type SectionSuggestionKind =
  | 'project'
  | 'otherProjects'
  | 'active'
  | 'dormant'
  | 'bots'
  | 'groupDms'
  | 'frequentContacts';

export interface SuggestionChannel {
  id: string;
  projectId: string;
  scopeType: string;
  type: string;
  lastActivityAt?: number | null;
  isBotDm?: boolean;
  contactWeight?: number | null;
}

export interface SuggestionChannelStatus {
  channelId: string;
  sectionId?: string | null;
  isStarred: boolean;
  isDeleted: boolean;
}

export interface SuggestionProject {
  id: string;
  name: string;
  type: string;
}

export interface ExistingSection {
  id: string;
  name: string;
}

export interface SectionSuggestion {
  id: string;
  kind: SectionSuggestionKind;
  name: string;
  channelIds: string[];
  mergeIntoSectionId: string | null;
}

export interface ComputeProjectSectionSuggestionsInput {
  channels: readonly SuggestionChannel[];
  statuses: readonly SuggestionChannelStatus[];
  projects: readonly SuggestionProject[];
  existingSections: readonly ExistingSection[];
  minChannels?: number;
}

export interface ComputeActivitySectionSuggestionsInput {
  channels: readonly SuggestionChannel[];
  statuses: readonly SuggestionChannelStatus[];
  existingSections: readonly ExistingSection[];
  nowMs: number;
  activeWindowDays?: number;
  minChannels?: number;
}

export interface ComputeDmSectionSuggestionsInput {
  channels: readonly SuggestionChannel[];
  statuses: readonly SuggestionChannelStatus[];
  existingSections: readonly ExistingSection[];
  minChannels?: number;
  maxFrequentContacts?: number;
  maxGroupDms?: number;
  maxBotDms?: number;
}

const normalizeName = (name: string): string => name.trim().toLowerCase();

const makeBucketAdder = (
  suggestions: SectionSuggestion[],
  existingSections: readonly ExistingSection[],
  minChannels: number,
): ((id: string, kind: SectionSuggestionKind, name: string, ids: string[]) => void) => {
  const sectionIdByName = new Map(
    existingSections.map(section => [normalizeName(section.name), section.id]),
  );
  const takenNames = new Set<string>();
  return (id, kind, name, ids) => {
    if (ids.length < minChannels) return;
    const normalized = normalizeName(name);
    if (takenNames.has(normalized)) return;
    takenNames.add(normalized);
    suggestions.push({
      id,
      kind,
      name,
      channelIds: ids,
      mergeIntoSectionId: sectionIdByName.get(normalized) ?? null,
    });
  };
};

const suppressAllEncompassing = (
  suggestions: SectionSuggestion[],
  candidateCount: number,
): SectionSuggestion[] => {
  const only = suggestions.length === 1 ? suggestions[0] : undefined;
  if (only && !only.mergeIntoSectionId && only.channelIds.length === candidateCount) return [];
  return suggestions;
};

const indexStatuses = (
  statuses: readonly SuggestionChannelStatus[],
): Map<string, SuggestionChannelStatus> => {
  const byChannelId = new Map<string, SuggestionChannelStatus>();
  for (const status of statuses) {
    byChannelId.set(status.channelId, status);
  }
  return byChannelId;
};

const isUnfiled = (
  channelId: string,
  statusByChannelId: Map<string, SuggestionChannelStatus>,
): boolean => {
  const status = statusByChannelId.get(channelId);
  if (!status) return false;
  return !status.isDeleted && !status.isStarred && !status.sectionId;
};

const isSectionable = (channel: SuggestionChannel): boolean => {
  if (channel.scopeType !== ChannelScopeType.DEFAULT) return false;
  if (isDeskChannelType(channel.type)) return false;
  return channel.type !== ChannelType.SDLC;
};

const selectCandidates = (
  channels: readonly SuggestionChannel[],
  statusByChannelId: Map<string, SuggestionChannelStatus>,
): SuggestionChannel[] =>
  channels.filter(channel => isSectionable(channel) && isUnfiled(channel.id, statusByChannelId));

const selectDmCandidates = (
  channels: readonly SuggestionChannel[],
  statusByChannelId: Map<string, SuggestionChannelStatus>,
): SuggestionChannel[] =>
  channels.filter(channel => {
    if (
      channel.scopeType !== ChannelScopeType.DM &&
      channel.scopeType !== ChannelScopeType.GROUP_DM
    ) {
      return false;
    }
    return isUnfiled(channel.id, statusByChannelId);
  });

export interface CandidateProjectIdsInput {
  channels: readonly SuggestionChannel[];
  statuses: readonly SuggestionChannelStatus[];
}

// Every project holding an unfiled channel, including the ones below
// minChannels: computeProjectSectionSuggestions pools those into
// OTHER_PROJECTS_SUGGESTION_NAME, and it can only do that for projects it
// was actually given.
export function getCandidateProjectIds(input: CandidateProjectIdsInput): string[] {
  const { channels, statuses } = input;

  const ids = new Set<string>();
  for (const channel of selectCandidates(channels, indexStatuses(statuses))) {
    ids.add(channel.projectId);
  }
  return [...ids].sort();
}

export function computeProjectSectionSuggestions(
  input: ComputeProjectSectionSuggestionsInput,
): SectionSuggestion[] {
  const {
    channels,
    statuses,
    projects,
    existingSections,
    minChannels = DEFAULT_MIN_CHANNELS,
  } = input;

  const candidates = selectCandidates(channels, indexStatuses(statuses));

  if (candidates.length === 0) return [];

  const projectById = new Map(projects.map(project => [project.id, project]));

  const channelIdsByProjectId = new Map<string, string[]>();
  for (const channel of candidates) {
    const project = projectById.get(channel.projectId);
    if (!project || project.type === ProjectType.DM) continue;
    const group = channelIdsByProjectId.get(channel.projectId);
    if (group) group.push(channel.id);
    else channelIdsByProjectId.set(channel.projectId, [channel.id]);
  }

  const suggestions: SectionSuggestion[] = [];
  const addBucket = makeBucketAdder(suggestions, existingSections, minChannels);

  const ordered = [...channelIdsByProjectId].sort(([aId, aIds], [bId, bIds]) => {
    if (bIds.length !== aIds.length) return bIds.length - aIds.length;
    const aName = projectById.get(aId)?.name ?? '';
    const bName = projectById.get(bId)?.name ?? '';
    return aName.localeCompare(bName);
  });

  const pooled: string[] = [];
  for (const [projectId, channelIds] of ordered) {
    const project = projectById.get(projectId);
    if (!project) continue;

    const name = project.name.trim().slice(0, SECTION_NAME_MAX_LENGTH).trim();
    if (!name) continue;

    if (channelIds.length < minChannels) {
      pooled.push(...channelIds);
      continue;
    }

    addBucket(projectId, 'project', name, channelIds);
  }

  addBucket(
    OTHER_PROJECTS_SUGGESTION_ID,
    'otherProjects',
    OTHER_PROJECTS_SUGGESTION_NAME,
    pooled,
  );

  return suppressAllEncompassing(suggestions, candidates.length);
}

export function computeActivitySectionSuggestions(
  input: ComputeActivitySectionSuggestionsInput,
): SectionSuggestion[] {
  const {
    channels,
    statuses,
    existingSections,
    nowMs,
    activeWindowDays = DEFAULT_ACTIVE_WINDOW_DAYS,
    minChannels = DEFAULT_MIN_CHANNELS,
  } = input;

  const candidates = selectCandidates(channels, indexStatuses(statuses));

  if (candidates.length === 0) return [];

  const cutoff = nowMs - clampActiveWindowDays(activeWindowDays) * DAY_MS;

  const activeChannelIds: string[] = [];
  const dormantChannelIds: string[] = [];
  for (const channel of candidates) {
    if ((channel.lastActivityAt ?? 0) >= cutoff) activeChannelIds.push(channel.id);
    else dormantChannelIds.push(channel.id);
  }

  const suggestions: SectionSuggestion[] = [];
  const addBucket = makeBucketAdder(suggestions, existingSections, minChannels);

  addBucket(ACTIVE_SUGGESTION_ID, 'active', ACTIVE_SUGGESTION_NAME, activeChannelIds);
  addBucket(DORMANT_SUGGESTION_ID, 'dormant', DORMANT_SUGGESTION_NAME, dormantChannelIds);

  return suppressAllEncompassing(suggestions, candidates.length);
}

export function computeDmSectionSuggestions(
  input: ComputeDmSectionSuggestionsInput,
): SectionSuggestion[] {
  const {
    channels,
    statuses,
    existingSections,
    minChannels = DEFAULT_MIN_CHANNELS,
    maxFrequentContacts = MAX_FREQUENT_CONTACTS,
    maxGroupDms = MAX_GROUP_DMS,
    maxBotDms = MAX_BOT_DMS,
  } = input;

  const candidates = selectDmCandidates(channels, indexStatuses(statuses));

  if (candidates.length === 0) return [];

  const botCandidates: SuggestionChannel[] = [];
  const groupDmCandidates: SuggestionChannel[] = [];
  const contactCandidates: SuggestionChannel[] = [];
  for (const channel of candidates) {
    if (channel.scopeType === ChannelScopeType.GROUP_DM) groupDmCandidates.push(channel);
    else if (channel.isBotDm) botCandidates.push(channel);
    else if ((channel.contactWeight ?? 0) > 0) contactCandidates.push(channel);
  }

  const byRecency = (a: SuggestionChannel, b: SuggestionChannel): number =>
    (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0) || a.id.localeCompare(b.id);

  const frequentContactChannelIds = contactCandidates
    .sort((a, b) => (b.contactWeight ?? 0) - (a.contactWeight ?? 0) || a.id.localeCompare(b.id))
    .slice(0, maxFrequentContacts)
    .map(channel => channel.id);

  const botChannelIds = botCandidates
    .sort(byRecency)
    .slice(0, maxBotDms)
    .map(channel => channel.id);

  const groupDmChannelIds = groupDmCandidates
    .sort(byRecency)
    .slice(0, maxGroupDms)
    .map(channel => channel.id);

  const suggestions: SectionSuggestion[] = [];
  const addBucket = makeBucketAdder(suggestions, existingSections, minChannels);

  addBucket(
    FREQUENT_CONTACTS_SUGGESTION_ID,
    'frequentContacts',
    FREQUENT_CONTACTS_SUGGESTION_NAME,
    frequentContactChannelIds,
  );
  addBucket(BOT_SUGGESTION_ID, 'bots', BOT_SUGGESTION_NAME, botChannelIds);
  addBucket(GROUP_DM_SUGGESTION_ID, 'groupDms', GROUP_DM_SUGGESTION_NAME, groupDmChannelIds);

  return suppressAllEncompassing(suggestions, candidates.length);
}
