import { ChannelScopeType, ProjectType } from './zero/types.js';
import { isDeskChannelType } from './utils/channel.js';

export const SECTION_NAME_MAX_LENGTH = 50;
export const DEFAULT_MIN_CHANNELS = 2;

export interface SuggestionChannel {
  id: string;
  projectId: string;
  scopeType: string;
  type: string;
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

export interface ProjectSectionSuggestion {
  projectId: string;
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

const normalizeName = (name: string): string => name.trim().toLowerCase();

export function computeProjectSectionSuggestions(
  input: ComputeProjectSectionSuggestionsInput,
): ProjectSectionSuggestion[] {
  const {
    channels,
    statuses,
    projects,
    existingSectionNames,
    minChannels = DEFAULT_MIN_CHANNELS,
  } = input;

  const statusByChannelId = new Map<string, SuggestionChannelStatus>();
  for (const status of statuses) {
    statusByChannelId.set(status.channelId, status);
  }

  const candidates = channels.filter(channel => {
    if (channel.scopeType !== ChannelScopeType.DEFAULT) return false;
    if (isDeskChannelType(channel.type)) return false;
    const status = statusByChannelId.get(channel.id);
    if (!status) return false;
    return !status.isDeleted && !status.isStarred && !status.sectionId;
  });

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

  const suggestions: ProjectSectionSuggestion[] = [];
  for (const [projectId, channelIds] of channelIdsByProjectId) {
    if (channelIds.length < minChannels) continue;
    const project = projectById.get(projectId);
    if (!project) continue;

    const name = project.name.trim().slice(0, SECTION_NAME_MAX_LENGTH).trim();
    if (!name) continue;

    const normalized = normalizeName(name);
    if (takenNames.has(normalized)) continue;
    takenNames.add(normalized);

    suggestions.push({ projectId, name, channelIds });
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
