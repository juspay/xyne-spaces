import React from 'react';
import { Bot, Sparkles } from 'lucide-react';
import type { ChannelClawAgent } from '../../../hooks/useChannelClawAgents';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '../../ui/Select/Select';

const DEFAULT_AGENT_OPTION = '__default__';

export interface AutoDraftAgentPickerProps {
  value: string | null;
  onChange: (slug: string | null) => void;
  clawAgents: ChannelClawAgent[];
  disabled?: boolean;
}

/**
 * Draft agent selector for Auto AI draft — built-in Xyne AI (null) or a channel Claw agent.
 */
export const AutoDraftAgentPicker: React.FC<AutoDraftAgentPickerProps> = ({
  value,
  onChange,
  clawAgents,
  disabled = false,
}) => {
  return (
    <div className='flex flex-col gap-1.5 pl-12'>
      <label htmlFor='desk-auto-draft-agent' className='flex items-center gap-2 text-sm'>
        <Bot size={14} className='text-desk-muted' />
        <span className='text-desk-label'>Draft agent</span>
      </label>
      <Select
        value={value ?? DEFAULT_AGENT_OPTION}
        onValueChange={v => onChange(v === DEFAULT_AGENT_OPTION ? null : v)}
        disabled={disabled}
      >
        <SelectTrigger
          id='desk-auto-draft-agent'
          className='w-full rounded-[10px] border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-desk-accent'
          data-track-category='DeskSettings'
          data-track-name='SelectAutoDraftAgent'
        >
          <SelectValue placeholder='Default (Xyne AI)' />
        </SelectTrigger>
        <SelectContent className='rounded-[10px]'>
          <SelectItem value={DEFAULT_AGENT_OPTION} className='rounded-[8px]'>
            <span className='flex items-center gap-2'>
              <Sparkles size={14} className='text-desk-accent' />
              <span>
                Default <span className='text-desk-helper'>(Xyne AI)</span>
              </span>
            </span>
          </SelectItem>
          {clawAgents.length > 0 && <SelectSeparator />}
          {clawAgents.map(agent => (
            <SelectItem key={agent.slug} value={agent.slug} className='rounded-[8px]'>
              <span className='flex items-center gap-2'>
                <span
                  className='inline-block h-2.5 w-2.5 shrink-0 rounded-full'
                  style={{ backgroundColor: agent.color || 'var(--desk-accent)' }}
                />
                <span>{agent.name}</span>
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className='text-desk-helper'>
        {clawAgents.length > 0
          ? 'Choose which agent writes the draft. Claw agents added to this channel appear here.'
          : 'Add a Claw agent to this channel to use it for drafts. Until then, the built-in Xyne AI is used.'}
        {value && !clawAgents.some(a => a.slug === value) && (
          <span className='block text-amber-600 dark:text-amber-500 mt-1'>
            The selected agent is no longer in this channel — drafts fall back to the default until
            you pick another.
          </span>
        )}
      </p>
    </div>
  );
};
