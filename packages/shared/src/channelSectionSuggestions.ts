import { ChannelScopeType, ProjectType } from './zero/types.js';
import { isDeskChannelType } from './utils/channel.js';

export const SECTION_NAME_MAX_LENGTH = 50;
export const DEFAULT_MIN_CHANNELS = 2;

export const ACTIVE_SUGGESTION_ID = '__active__';
export const DORMANT_SUGGESTION_ID = '__dormant__';
export const ACTIVE_SUGGESTION_NAME = 'Active';
export const DORMANT_SUGGESTION_NAME = 'Quiet';

export const BOT_SUGGESTION_ID = '__bots__';
export const GROUP_DM_SUGGESTION_ID = '__groupDms__';
export const BOT_SUGGESTION_NAME = 'Apps & Bots';
export const GROUP_DM_SUGGESTION_NAME = 'Group DMs';

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

export type SectionSuggestionKind = 'project' | 'active' | 'dormant' | 'bots' | 'groupDms';

export interface SuggestionChannel {
  id: string;
  projectId: string;
  scopeType: string;
  type: string;
  lastActivityAt?: number | null;
  isBotDm?: boolean;
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

export interface SectionSuggestion {
  id: string;
  kind: SectionSuggestionKind;
  name: string;
  channelIds: string[];
}

export interface ComputeProjectSectionSuggestionsInput {
  channels: readonly SuggestionChannel[];
  statuses: readonly SuggestionChannelStatus[];
  projects: readonly SuggestionProject[];
  existingSectionNames: readonly string[];
  minChannels?: number;
}

export interface ComputeActivitySectionSuggestionsInput {
  channels: readonly SuggestionChannel[];
  statuses: readonly SuggestionChannelStatus[];
  existingSectionNames: readonly string[];
  nowMs: number;
  activeWindowDays?: number;
  minChannels?: number;
}

export interface ComputeDmSectionSuggestionsInput {
  channels: readonly SuggestionChannel[];
  statuses: readonly SuggestionChannelStatus[];
  existingSectionNames: readonly string[];
  minChannels?: number;
}

const normalizeName = (name: string): string => name.trim().toLowerCase();

const makeBucketAdder = (
  suggestions: SectionSuggestion[],
  existingSectionNames: readonly string[],
  minChannels: number,
): ((id: string, kind: SectionSuggestionKind, name: string, ids: string[]) => void) => {
  const takenNames = new Set(existingSectionNames.map(normalizeName));
  return (id, kind, name, ids) => {
    if (ids.length < minChannels) return;
    const normalized = normalizeName(name);
    if (takenNames.has(normalized)) return;
    takenNames.add(normalized);
    suggestions.push({ id, kind, name, channelIds: ids });
  };
};

const suppressAllEncompassing = (
  suggestions: SectionSuggestion[],
  candidateCount: number,
): SectionSuggestion[] => {
  const only = suggestions.length === 1 ? suggestions[0] : undefined;
  if (only && only.channelIds.length === candidateCount) return [];
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

const selectCandidates = (
  channels: readonly SuggestionChannel[],
  statusByChannelId: Map<string, SuggestionChannelStatus>,
): SuggestionChannel[] =>
  channels.filter(channel => {
    if (channel.scopeType !== ChannelScopeType.DEFAULT) return false;
    if (isDeskChannelType(channel.type)) return false;
    return isUnfiled(channel.id, statusByChannelId);
  });

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
  minChannels?: number;
}

export function getCandidateProjectIds(input: CandidateProjectIdsInput): string[] {
  const { channels, statuses, minChannels = DEFAULT_MIN_CHANNELS } = input;

  const counts = new Map<string, number>();
  for (const channel of selectCandidates(channels, indexStatuses(statuses))) {
    counts.set(channel.projectId, (counts.get(channel.projectId) ?? 0) + 1);
  }

  const ids: string[] = [];
  for (const [projectId, count] of counts) {
    if (count >= minChannels) ids.push(projectId);
  }
  return ids.sort();
}

export function computeProjectSectionSuggestions(
  input: ComputeProjectSectionSuggestionsInput,
): SectionSuggestion[] {
  const {
    channels,
    statuses,
    projects,
    existingSectionNames,
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

  const takenNames = new Set(existingSectionNames.map(normalizeName));

  const suggestions: SectionSuggestion[] = [];
  for (const [projectId, channelIds] of channelIdsByProjectId) {
    if (channelIds.length < minChannels) continue;
    const project = projectById.get(projectId);
    if (!project) continue;

    const name = project.name.trim().slice(0, SECTION_NAME_MAX_LENGTH).trim();
    if (!name) continue;

    const normalized = normalizeName(name);
    if (takenNames.has(normalized)) continue;
    takenNames.add(normalized);

    suggestions.push({ id: projectId, kind: 'project', name, channelIds });
  }

  suggestions.sort(
    (a, b) => b.channelIds.length - a.channelIds.length || a.name.localeCompare(b.name),
  );

  const only = suggestions.length === 1 ? suggestions[0] : undefined;
  if (only && only.channelIds.length === candidates.length) {
    return [];
  }

  return suggestions;
}

export function computeActivitySectionSuggestions(
  input: ComputeActivitySectionSuggestionsInput,
): SectionSuggestion[] {
  const {
    channels,
    statuses,
    existingSectionNames,
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
  const addBucket = makeBucketAdder(suggestions, existingSectionNames, minChannels);

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
    existingSectionNames,
    minChannels = DEFAULT_MIN_CHANNELS,
  } = input;

  const candidates = selectDmCandidates(channels, indexStatuses(statuses));

  if (candidates.length === 0) return [];

  const botChannelIds: string[] = [];
  const groupDmChannelIds: string[] = [];
  for (const channel of candidates) {
    if (channel.scopeType === ChannelScopeType.GROUP_DM) groupDmChannelIds.push(channel.id);
    else if (channel.isBotDm) botChannelIds.push(channel.id);
  }

  const suggestions: SectionSuggestion[] = [];
  const addBucket = makeBucketAdder(suggestions, existingSectionNames, minChannels);

  addBucket(BOT_SUGGESTION_ID, 'bots', BOT_SUGGESTION_NAME, botChannelIds);
  addBucket(GROUP_DM_SUGGESTION_ID, 'groupDms', GROUP_DM_SUGGESTION_NAME, groupDmChannelIds);

  return suppressAllEncompassing(suggestions, candidates.length);
}
