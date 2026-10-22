import { useState } from 'react';
import { toast } from 'sonner';
import { AgentProactivityMode } from '@xyne/shared';
import { useZero } from '../../../hooks/useZero';
import { mutators } from '../../../zero/mutators';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/Select';

const MODES: Array<{ value: AgentProactivityMode; label: string; hint: string }> = [
  {
    value: AgentProactivityMode.OFF,
    label: 'Off',
    hint: 'Agents reply only when someone tags them.',
  },
  {
    value: AgentProactivityMode.ANSWER,
    label: 'On',
    hint: 'When a question goes unanswered, an agent that knows the topic replies in the thread.',
  },
  {
    value: AgentProactivityMode.SHADOW,
    label: 'Test only',
    hint: 'Agents decide as they would, but nothing is posted. Try it before turning it on.',
  },
];

interface Props {
  channelId: string;
  mode: AgentProactivityMode | null | undefined;
  canManage: boolean;
}

/** The channel's Agents setting: whether agents answer questions nobody tagged them in. */
export const AgentProactivityConfig: React.FC<Props> = ({ channelId, mode, canManage }) => {
  const zero = useZero();
  const current = mode ?? AgentProactivityMode.OFF;
  const [saving, setSaving] = useState(false);

  const choose = async (next: AgentProactivityMode): Promise<void> => {
    if (next === current || saving) return;
    setSaving(true);
    try {
      const res = await zero.mutate(
        mutators.channel.updateAgentProactivityMode({ channelId, mode: next }),
      ).server;
      if (res.type === 'error')
        toast.error(res.error?.message ?? 'Could not change how agents answer');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not change how agents answer');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className='flex items-center justify-between gap-4 p-4'>
      <div className='flex min-w-0 flex-col gap-0.5'>
        <span className='text-[13px] font-medium text-foreground'>Reply without being tagged</span>
        <span className='text-[12px] leading-[140%] text-muted-foreground'>
          {MODES.find(option => option.value === current)?.hint}
        </span>
      </div>
      <Select
        value={current}
        onValueChange={value => void choose(value as AgentProactivityMode)}
        disabled={!canManage || saving}
      >
        <SelectTrigger
          className='w-[120px] shrink-0'
          aria-label='How agents answer'
          data-track-category='AGENT_PROACTIVITY'
          data-track-name='agent_proactivity_mode'
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {MODES.map(option => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
};
