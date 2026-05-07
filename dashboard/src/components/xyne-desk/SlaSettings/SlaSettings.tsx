import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Clock, ChevronDown, Settings } from 'lucide-react';
import { cn } from '../../../utils/classNames';
import { useBoardSlaPolicies, useUpsertBoardSlaPolicy } from '../../../hooks/useChannelSlaPolicy';
import type { BoardSlaPolicy } from '../../../hooks/useChannelSlaPolicy';
import { getPriorityIcon } from '../../Tickets/TicketCard/TicketCard.utils';
import type { TicketPriority } from '@xyne/shared';
import * as Select from '@radix-ui/react-select';

const PRIORITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const;
type Priority = (typeof PRIORITIES)[number];

const PRIORITY_LABELS: Record<Priority, string> = {
  CRITICAL: 'Critical',
  HIGH: 'High',
  MEDIUM: 'Medium',
  LOW: 'Low',
};

const DEFAULT_SLA: Record<
  Priority,
  { responseHours: number; resolutionHours: number; businessHoursOnly: boolean }
> = {
  CRITICAL: { responseHours: 1, resolutionHours: 4, businessHoursOnly: false },
  HIGH: { responseHours: 2, resolutionHours: 24, businessHoursOnly: false },
  MEDIUM: { responseHours: 8, resolutionHours: 32, businessHoursOnly: true },
  LOW: { responseHours: 16, resolutionHours: 48, businessHoursOnly: true },
};

const COMMON_TIMEZONES = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Asia/Kolkata',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Australia/Sydney',
];

interface DraftValues {
  responseHours: number;
  resolutionHours: number;
  businessHoursOnly: boolean;
  timezone: string;
  workdayStart: number;
  workdayEnd: number;
}

function buildDefaultDraft(priority: Priority, existing?: BoardSlaPolicy): DraftValues {
  if (existing) {
    return {
      responseHours: existing.responseHours,
      resolutionHours: existing.resolutionHours,
      businessHoursOnly: existing.businessHoursOnly,
      timezone: existing.timezone,
      workdayStart: existing.workdayStart,
      workdayEnd: existing.workdayEnd,
    };
  }
  return { ...DEFAULT_SLA[priority], timezone: 'UTC', workdayStart: 9, workdayEnd: 18 };
}

function buildAllDefaultDrafts(existingPolicies: BoardSlaPolicy[]): Record<Priority, DraftValues> {
  const result = {} as Record<Priority, DraftValues>;
  for (const p of PRIORITIES) {
    result[p] = buildDefaultDraft(
      p,
      existingPolicies.find(pol => (pol.priority as Priority) === p),
    );
  }
  return result;
}

interface SlaSettingsProps {
  boardId: string | null;
  disabled?: boolean;
}

export const SlaSettings: React.FC<SlaSettingsProps> = ({ boardId, disabled = false }) => {
  const existingPolicies = useBoardSlaPolicies(boardId);
  const upsertPolicy = useUpsertBoardSlaPolicy();

  const [drafts, setDrafts] = useState<Record<Priority, DraftValues>>(() =>
    buildAllDefaultDrafts(existingPolicies),
  );
  const [expandedPriority, setExpandedPriority] = useState<Priority | null>(null);

  const seededRef = useRef<Set<Priority>>(new Set());
  useEffect(() => {
    for (const policy of existingPolicies) {
      const p = policy.priority as Priority;
      if (!seededRef.current.has(p)) {
        seededRef.current.add(p);
        setDrafts(prev => ({ ...prev, [p]: buildDefaultDraft(p, policy) }));
      }
    }
  }, [existingPolicies]);

  const updateDraft = useCallback((priority: Priority, patch: Partial<DraftValues>) => {
    setDrafts(prev => ({ ...prev, [priority]: { ...prev[priority], ...patch } }));
  }, []);

  const getIsActive = useCallback(
    (priority: Priority) =>
      existingPolicies.some(p => (p.priority as Priority) === priority && p.isActive),
    [existingPolicies],
  );

  const handleToggleActive = useCallback(
    (priority: Priority) => {
      if (!boardId) return;
      const newActive = !getIsActive(priority);
      const draft = drafts[priority];
      upsertPolicy({ boardId, priority, ...draft, isActive: newActive });
      if (newActive) setExpandedPriority(priority);
      else if (expandedPriority === priority) setExpandedPriority(null);
    },
    [boardId, drafts, getIsActive, upsertPolicy, expandedPriority],
  );

  const handleSave = useCallback(
    (priority: Priority) => {
      if (!boardId) return;
      const draft = drafts[priority];
      // Clamp resolutionHours so it can't be less than responseHours.
      // The input's `min` attribute doesn't catch the case where responseHours
      // is increased after resolutionHours was already set.
      const safeDraft = {
        ...draft,
        resolutionHours: Math.max(draft.resolutionHours, draft.responseHours),
      };
      upsertPolicy({ boardId, priority, ...safeDraft, isActive: true });
      setExpandedPriority(null);
    },
    [boardId, drafts, upsertPolicy],
  );

  if (!boardId) return null;

  return (
    <div className='flex flex-col gap-4'>
      {/* Section header */}
      <div>
        <p className='text-sm font-medium text-foreground'>Priority SLA Policies</p>
        <p className='text-xs text-muted-foreground mt-0.5'>
          Configure response and resolution time targets per priority level. Due dates are applied
          automatically when a ticket is created on this board.
        </p>
      </div>

      <div className='flex flex-col gap-2'>
        {PRIORITIES.map(priority => {
          const isActive = getIsActive(priority);
          const draft = drafts[priority];
          const isExpanded = expandedPriority === priority;

          return (
            <div
              key={priority}
              className={cn(
                'flex flex-col border rounded-xl bg-card transition-colors duration-300',
                isActive ? 'border-border' : 'border-border/50',
              )}
            >
              {/* Row */}
              <div className='flex items-center justify-between px-4 py-3'>
                <div className='flex items-center gap-3'>
                  {/* Toggle */}
                  <button
                    type='button'
                    role='switch'
                    aria-checked={isActive}
                    onClick={() => !disabled && handleToggleActive(priority)}
                    disabled={disabled}
                    className={cn(
                      'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none',
                      disabled && 'opacity-50 cursor-not-allowed',
                      isActive ? 'bg-[#6276be] dark:bg-[#7986d0]' : 'bg-secondary',
                    )}
                    data-track-category='BOARD_SLA_SETTINGS'
                    data-track-name='TOGGLE_SLA_PRIORITY'
                    data-track-metadata={JSON.stringify({ priority })}
                  >
                    <span
                      className={cn(
                        'pointer-events-none inline-block h-4 w-4 rounded-full bg-background shadow-sm transition-transform duration-200',
                        isActive ? 'translate-x-4' : 'translate-x-0',
                      )}
                    />
                  </button>

                  <div className='flex items-center gap-2'>
                    {getPriorityIcon(priority as TicketPriority)}
                    <div>
                      <p
                        className={cn(
                          'text-sm font-medium transition-colors duration-300',
                          isActive ? 'text-foreground' : 'text-muted-foreground',
                        )}
                      >
                        {PRIORITY_LABELS[priority]}
                      </p>
                      {isActive && (
                        <p className='text-xs text-muted-foreground mt-0.5'>
                          Response: {draft.responseHours}h · Resolution: {draft.resolutionHours}h ·{' '}
                          {draft.businessHoursOnly ? 'Business hrs' : '24×7'}
                        </p>
                      )}
                    </div>
                  </div>
                </div>

                {isActive && (
                  <button
                    type='button'
                    title='Configure'
                    onClick={() => setExpandedPriority(isExpanded ? null : priority)}
                    className='p-1.5 text-muted-foreground hover:text-foreground rounded-md hover:bg-accent transition-colors'
                    data-track-category='BOARD_SLA_SETTINGS'
                    data-track-name='CONFIGURE_SLA_PRIORITY'
                    data-track-metadata={JSON.stringify({ priority })}
                  >
                    <Settings size={15} />
                  </button>
                )}
              </div>

              {/* Expanded config — appears below the row */}
              {isActive && isExpanded && (
                <div className='px-4 pb-4 border-t border-border pt-3 flex flex-col gap-3'>
                  <div className='flex items-end gap-3 flex-wrap'>
                    {/* Response hours */}
                    <div className='flex flex-col gap-1'>
                      <span className='text-xs text-muted-foreground'>Response (hrs)</span>
                      <div className='relative flex items-center'>
                        <input
                          type='number'
                          min={0}
                          step={1}
                          value={draft.responseHours}
                          onChange={e => {
                            const v = parseFloat(e.target.value);
                            if (!isNaN(v) && v >= 0) updateDraft(priority, { responseHours: v });
                          }}
                          disabled={disabled}
                          data-track-category='BOARD_SLA_SETTINGS'
                          data-track-name='EDIT_RESPONSE_HOURS'
                          className='w-20 h-8 px-2 pr-7 rounded-md border border-input bg-transparent text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none'
                        />
                        <span className='absolute right-3 text-[10px] text-muted-foreground pointer-events-none'>
                          hrs
                        </span>
                      </div>
                    </div>

                    {/* Resolution hours */}
                    <div className='flex flex-col gap-1'>
                      <span className='text-xs text-muted-foreground'>Resolution (hrs)</span>
                      <div className='relative flex items-center'>
                        <input
                          type='number'
                          min={draft.responseHours}
                          step={1}
                          value={draft.resolutionHours}
                          onChange={e => {
                            const v = parseFloat(e.target.value);
                            if (!isNaN(v) && v >= draft.responseHours)
                              updateDraft(priority, { resolutionHours: v });
                          }}
                          disabled={disabled}
                          data-track-category='BOARD_SLA_SETTINGS'
                          data-track-name='EDIT_RESOLUTION_HOURS'
                          className='w-20 h-8 px-2 pr-7 rounded-md border border-input bg-transparent text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none'
                        />
                        <span className='absolute right-3 text-[10px] text-muted-foreground pointer-events-none'>
                          hrs
                        </span>
                      </div>
                    </div>

                    {/* Business hours toggle */}
                    <div className='flex flex-col gap-1'>
                      <span className='text-xs text-muted-foreground'>Mode</span>
                      <button
                        type='button'
                        onClick={() =>
                          updateDraft(priority, { businessHoursOnly: !draft.businessHoursOnly })
                        }
                        disabled={disabled}
                        data-track-category='BOARD_SLA_SETTINGS'
                        data-track-name='TOGGLE_BUSINESS_HOURS'
                        className={cn(
                          'flex items-center gap-1.5 h-8 px-2.5 rounded-md border text-xs font-medium transition-colors',
                          draft.businessHoursOnly
                            ? 'bg-[#eef0fb] border-[#6276be]/30 text-[#6276be] dark:bg-[#6276be]/20 dark:text-[#9aa6e0]'
                            : 'bg-transparent border-input text-muted-foreground hover:text-foreground',
                          disabled && 'opacity-50 cursor-not-allowed',
                        )}
                      >
                        <Clock size={11} />
                        {draft.businessHoursOnly ? 'Business hrs' : '24×7'}
                      </button>
                    </div>
                  </div>

                  {/* Business hours advanced config */}
                  {draft.businessHoursOnly && (
                    <div className='flex items-end gap-3 flex-wrap pt-1 border-t border-border/50'>
                      <div className='flex flex-col gap-1'>
                        <span className='text-xs text-muted-foreground'>Timezone</span>
                        <Select.Root
                          value={draft.timezone}
                          onValueChange={v => updateDraft(priority, { timezone: v })}
                          disabled={disabled}
                        >
                          <Select.Trigger className='flex items-center justify-between gap-2 w-44 h-8 px-2.5 rounded-md border border-input bg-transparent text-sm focus:outline-none focus:ring-1 focus:ring-ring data-[disabled]:opacity-50'>
                            <Select.Value />
                            <Select.Icon>
                              <ChevronDown size={12} className='text-muted-foreground' />
                            </Select.Icon>
                          </Select.Trigger>
                          <Select.Portal>
                            <Select.Content
                              position='popper'
                              className='z-[100] w-44 rounded-md border border-border bg-background shadow-md'
                            >
                              <Select.Viewport className='p-1 max-h-56 overflow-y-auto'>
                                {COMMON_TIMEZONES.map(tz => (
                                  <Select.Item
                                    key={tz}
                                    value={tz}
                                    className='flex items-center px-3 py-1.5 text-sm rounded cursor-pointer hover:bg-muted focus:bg-muted outline-none'
                                  >
                                    <Select.ItemText>{tz}</Select.ItemText>
                                  </Select.Item>
                                ))}
                              </Select.Viewport>
                            </Select.Content>
                          </Select.Portal>
                        </Select.Root>
                      </div>

                      <div className='flex flex-col gap-1'>
                        <span className='text-xs text-muted-foreground'>Work hours</span>
                        <div className='flex items-center gap-1.5'>
                          <input
                            type='number'
                            min={0}
                            max={22}
                            value={draft.workdayStart}
                            onChange={e =>
                              updateDraft(priority, {
                                workdayStart: parseInt(e.target.value, 10) || 9,
                              })
                            }
                            disabled={disabled}
                            data-track-category='BOARD_SLA_SETTINGS'
                            data-track-name='EDIT_WORKDAY_START'
                            className='w-14 h-8 px-2 rounded-md border border-input bg-transparent text-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none'
                          />
                          <span className='text-xs text-muted-foreground'>to</span>
                          <input
                            type='number'
                            min={1}
                            max={24}
                            value={draft.workdayEnd}
                            onChange={e =>
                              updateDraft(priority, {
                                workdayEnd: parseInt(e.target.value, 10) || 18,
                              })
                            }
                            disabled={disabled}
                            data-track-category='BOARD_SLA_SETTINGS'
                            data-track-name='EDIT_WORKDAY_END'
                            className='w-14 h-8 px-2 rounded-md border border-input bg-transparent text-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none'
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Save */}
                  <div className='flex justify-end'>
                    <button
                      type='button'
                      onClick={() => handleSave(priority)}
                      disabled={disabled || !boardId}
                      className='px-3 py-1.5 text-sm font-medium text-white bg-[#6276be] rounded-lg hover:bg-[#4f62a8] dark:hover:bg-[#7986d0] disabled:opacity-50 disabled:cursor-not-allowed transition-colors'
                      data-track-category='BOARD_SLA_SETTINGS'
                      data-track-name='SAVE_SLA_POLICY'
                      data-track-metadata={JSON.stringify({ priority })}
                    >
                      Save
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
