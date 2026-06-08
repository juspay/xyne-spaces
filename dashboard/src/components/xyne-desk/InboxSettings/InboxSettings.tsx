import React from 'react';
import { Bot, Sparkles } from 'lucide-react';
import { AutoDraftMode } from '@xyne/shared';
import { InboxOwnerSettings } from '../InboxOwnerSettings/InboxOwnerSettings';
import { InboxAssigneeSettings } from '../InboxAssigneeSettings/InboxAssigneeSettings';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '../../ui/Select';

const DEFAULT_AGENT_OPTION = '__default__';

interface InboxSettingsProps {
  ownerUserId: string | null;
  onOwnerChange: (next: string | null) => void;
  assigneeUserGroupId: string | null;
  onAssigneeChange: (next: string | null) => void;
  autoDraftMode?: AutoDraftMode;
  onAutoDraftModeChange?: (next: AutoDraftMode) => void;
  autoDraftAgentSlug?: string | null;
  onAutoDraftAgentChange?: (next: string | null) => void;
  clawAgents?: Array<{ slug: string; name: string; color: string }>;
  disabled?: boolean;
}

export const InboxSettings: React.FC<InboxSettingsProps> = ({
  ownerUserId,
  onOwnerChange,
  assigneeUserGroupId,
  onAssigneeChange,
  autoDraftMode = AutoDraftMode.OFF,
  onAutoDraftModeChange,
  autoDraftAgentSlug = null,
  onAutoDraftAgentChange,
  clawAgents = [],
  disabled = false,
}) => {
  return (
    <div className='flex flex-col gap-4'>
      <div className='grid grid-cols-1 md:grid-cols-2 gap-4'>
        <InboxOwnerSettings value={ownerUserId} onChange={onOwnerChange} disabled={disabled} />
        <InboxAssigneeSettings
          value={assigneeUserGroupId}
          onChange={onAssigneeChange}
          disabled={disabled}
        />
      </div>

      {onAutoDraftModeChange && (
        <div className='flex flex-col gap-3'>
          <div className='flex items-center gap-3'>
            <button
              type='button'
              id='inbox-auto-draft'
              role='switch'
              aria-checked={autoDraftMode === AutoDraftMode.DRAFT}
              onClick={() =>
                !disabled &&
                onAutoDraftModeChange(
                  autoDraftMode === AutoDraftMode.DRAFT ? AutoDraftMode.OFF : AutoDraftMode.DRAFT,
                )
              }
              disabled={disabled}
              title={
                autoDraftMode === AutoDraftMode.DRAFT
                  ? 'Disable auto AI draft'
                  : 'Enable auto AI draft'
              }
              className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed ${
                autoDraftMode === AutoDraftMode.DRAFT ? 'bg-[#6276be]' : 'bg-secondary'
              }`}
              data-track-category='inbox-settings'
              data-track-name='toggle-auto-draft'
            >
              <span
                className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-background shadow-sm transition-transform duration-200 ${
                  autoDraftMode === AutoDraftMode.DRAFT ? 'translate-x-4' : 'translate-x-0'
                }`}
              />
            </button>
            <div>
              <p className='text-sm font-medium text-foreground'>Auto AI draft</p>
              <p className='text-xs text-muted-foreground mt-0.5'>
                Automatically prepare an AI-generated draft reply each time a new email arrives on
                this desk. Drafts are shared across the team. The selected agent is also used when
                you click Ask AI later while composing a reply.
              </p>
            </div>
          </div>

          {/* Agent picker — only relevant while auto-draft is on. Defaults to the
              built-in Xyne AI; users can pick a Claw agent added to this channel.
              Radix Select forbids an empty-string item value, so the Default option
              uses a sentinel that maps to null (null = built-in Xyne AI). */}
          {autoDraftMode === AutoDraftMode.DRAFT && onAutoDraftAgentChange && (
            <div className='flex flex-col gap-1.5 pl-12'>
              <label htmlFor='inbox-auto-draft-agent' className='flex items-center gap-2 text-sm'>
                <Bot size={14} className='text-muted-foreground' />
                <span className='font-medium text-foreground'>Draft agent</span>
              </label>
              <Select
                value={autoDraftAgentSlug ?? DEFAULT_AGENT_OPTION}
                onValueChange={v => onAutoDraftAgentChange(v === DEFAULT_AGENT_OPTION ? null : v)}
                disabled={disabled}
              >
                <SelectTrigger
                  id='inbox-auto-draft-agent'
                  className='w-full'
                  data-track-category='inbox-settings'
                  data-track-name='select-auto-draft-agent'
                >
                  <SelectValue placeholder='Default (Xyne AI)' />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={DEFAULT_AGENT_OPTION}>
                    <span className='flex items-center gap-2'>
                      <Sparkles size={14} className='text-[#6276be]' />
                      <span>
                        Default <span className='text-muted-foreground'>(Xyne AI)</span>
                      </span>
                    </span>
                  </SelectItem>
                  {clawAgents.length > 0 && <SelectSeparator />}
                  {clawAgents.map(agent => (
                    <SelectItem key={agent.slug} value={agent.slug}>
                      <span className='flex items-center gap-2'>
                        <span
                          className='inline-block h-2.5 w-2.5 shrink-0 rounded-full'
                          style={{ backgroundColor: agent.color || '#6276be' }}
                        />
                        <span>{agent.name}</span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className='text-xs text-muted-foreground'>
                {clawAgents.length > 0
                  ? 'Choose which agent writes the draft. Claw agents added to this channel appear here.'
                  : 'Add a Claw agent to this channel to use it for drafts. Until then, the built-in Xyne AI is used.'}
                {autoDraftAgentSlug && !clawAgents.some(a => a.slug === autoDraftAgentSlug) && (
                  <span className='block text-amber-600 dark:text-amber-500 mt-1'>
                    The selected agent is no longer in this channel — drafts fall back to the
                    default until you pick another.
                  </span>
                )}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
