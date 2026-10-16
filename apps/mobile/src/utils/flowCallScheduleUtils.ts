import { format } from 'date-fns';

import type { FlowComponentLike, FlowTextNormalizationOptions } from '@/src/utils/flowJsonMarkdown';

export type CallScheduleDuration = 30 | 45 | 60;
export type CallSchedulePhase = 'proposed' | 'scheduled';

export type CallScheduleSlot = {
  id: string;
  start: string;
};

export type CallScheduleSelection = {
  slotId: string;
  duration: CallScheduleDuration;
};

export type CallScheduleViewModel =
  | {
      phase: 'proposed';
      componentId: string;
      title: string;
      attendees: string[];
      slots: CallScheduleSlot[];
      defaultSlotId: string;
      defaultDuration: CallScheduleDuration;
    }
  | {
      phase: 'scheduled';
      componentId: string;
      title: string;
      attendees: string[];
      start: string;
      duration: CallScheduleDuration;
    };

export const CALL_SCHEDULE_DURATION_OPTIONS: CallScheduleDuration[] = [30, 45, 60];
export const DEFAULT_CALL_SCHEDULE_DURATION: CallScheduleDuration = 30;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const optionalString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

const requiredString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

export const parseCallScheduleDuration = (value: unknown): CallScheduleDuration | null => {
  if (value === 30 || value === 45 || value === 60) return value;
  return null;
};

export const callScheduleDurationLabel = (duration: CallScheduleDuration): string =>
  duration === 60 ? '1 hr' : `${duration} mins`;

export const deriveCallSlotEnd = (startIso: string, duration: CallScheduleDuration): Date => {
  const start = new Date(startIso);
  return new Date(start.getTime() + duration * 60_000);
};

export const formatCallSlotLabel = (
  startIso: string,
  duration: CallScheduleDuration,
): { dateLabel: string; rangeLabel: string } | null => {
  const start = new Date(startIso);
  if (Number.isNaN(start.getTime())) return null;
  const end = deriveCallSlotEnd(startIso, duration);
  return {
    dateLabel: format(start, 'EEE d MMM'),
    rangeLabel: `${format(start, 'h:mm a')} - ${format(end, 'h:mm a')}`,
  };
};

export const parseCallScheduleSlots = (value: unknown): CallScheduleSlot[] => {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isRecord)
    .map(raw => {
      const id = requiredString(raw['id']);
      const start = requiredString(raw['start']);
      if (!id || !start) return null;
      const startDate = new Date(start);
      if (Number.isNaN(startDate.getTime())) return null;
      return { id, start };
    })
    .filter((slot): slot is CallScheduleSlot => slot !== null);
};

export const parseCallScheduleAttendees = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map(String)
    .map(item => item.trim())
    .filter(Boolean);
};

/** Spaces user ids typically have no whitespace; dummy payloads may send display names. */
export const isLikelyUserId = (value: string): boolean => value.length > 0 && !/\s/.test(value);

export const createCallScheduleViewModel = (
  component: FlowComponentLike,
): CallScheduleViewModel | null => {
  if (component.type !== 'call_schedule') return null;

  const componentId =
    typeof component.id === 'string' && component.id.trim() ? component.id.trim() : 'call-schedule';
  const props = isRecord(component.props) ? component.props : undefined;
  const phase = optionalString(props?.['phase']);
  const title = requiredString(props?.['title']);
  if (!title) return null;

  const attendees = parseCallScheduleAttendees(props?.['attendees']);

  if (phase === 'scheduled') {
    const start = requiredString(props?.['start']);
    const duration = parseCallScheduleDuration(props?.['duration']);
    if (!start || !duration) return null;
    if (Number.isNaN(new Date(start).getTime())) return null;
    return { phase: 'scheduled', componentId, title, attendees, start, duration };
  }

  if (phase !== 'proposed') return null;

  const slots = parseCallScheduleSlots(props?.['slots']);
  if (slots.length === 0) return null;

  const defaultSlotId = optionalString(props?.['defaultSlotId']) ?? slots[0]!.id;
  const defaultDuration =
    parseCallScheduleDuration(props?.['defaultDuration']) ?? DEFAULT_CALL_SCHEDULE_DURATION;

  return {
    phase: 'proposed',
    componentId,
    title,
    attendees,
    slots,
    defaultSlotId,
    defaultDuration,
  };
};

export const readCallScheduleSelection = (
  value: unknown,
  fallback: CallScheduleSelection,
): CallScheduleSelection => {
  if (!isRecord(value)) return fallback;
  const slotId = optionalString(value['slotId']) ?? fallback.slotId;
  const duration = parseCallScheduleDuration(value['duration']) ?? fallback.duration;
  return { slotId, duration };
};

export const findCallScheduleComponent = (
  components: FlowComponentLike[] | undefined,
): FlowComponentLike | undefined => {
  if (!components) return undefined;
  for (const component of components) {
    if (component.type === 'call_schedule') return component;
    const nested = findCallScheduleComponent(component.children);
    if (nested) return nested;
  }
  return undefined;
};

export const isCallScheduleFlow = (flow: {
  components?: FlowComponentLike[] | undefined;
}): boolean => findCallScheduleComponent(flow.components) !== undefined;

export const callScheduleComponentToMarkdown = (
  component: FlowComponentLike,
  _options: FlowTextNormalizationOptions = {},
): string => {
  const viewModel = createCallScheduleViewModel(component);
  if (!viewModel) return '';

  if (viewModel.phase === 'scheduled') {
    const label = formatCallSlotLabel(viewModel.start, viewModel.duration);
    return [
      `**${viewModel.title}**`,
      label ? `${label.dateLabel}  ${label.rangeLabel}` : viewModel.start,
      'Scheduled',
    ].join('\n\n');
  }

  const lines = [`**${viewModel.title}**`, 'Available slots'];
  for (const slot of viewModel.slots) {
    const label = formatCallSlotLabel(slot.start, viewModel.defaultDuration);
    if (label) lines.push(`- ${label.dateLabel}  ${label.rangeLabel}`);
  }
  return lines.join('\n\n');
};
