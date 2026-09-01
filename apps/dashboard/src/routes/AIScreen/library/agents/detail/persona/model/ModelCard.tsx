import { useState, type ReactElement } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { PencilEditLine } from '@xyne/icons';
import { Loader2 } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/Select/index';
import { clawAgentDetailKey } from '@/hooks/useClawAgentDetail';
import { updateClawAgent } from '@/services/claw/clawAuthAgentsService';
import { clawErrorText } from '@/services/claw/clawRequest';
import { PROVIDER_DISPLAY } from '@/services/claw/modelProviderConfig';
import type { Agent } from '@/services/claw/clawAuthAgentTypes';
import {
  DetailCard,
  DetailRow,
  DetailSection,
  DetailLockedNote,
  DetailValue,
  ReadOnlyBadge,
} from '../../../../shared/primitives/DetailPrimitives';
import { ProviderOrderDialog } from './ProviderOrderDialog';
import {
  applyModelCard,
  AUTOMATION_OPTIONS,
  readModelCardDraft,
  SUBAGENT_OPTIONS,
  type ModelCardDraft,
} from './modelConfig';

const RowSelect = <T extends string>({
  value,
  options,
  editable,
  onChange,
  label,
  trackName,
}: {
  value: T;
  options: ReadonlyArray<{ value: string; label: string }>;
  editable: boolean;
  onChange: (next: T) => void;
  label: string;
  trackName: string;
}): ReactElement =>
  !editable ? (
    <DetailValue>{options.find(o => o.value === value)?.label ?? value}</DetailValue>
  ) : (
    <Select value={value} onValueChange={next => onChange(next as T)}>
      <SelectTrigger
        size='sm'
        aria-label={label}
        data-track-category='Claw Agents'
        data-track-name={trackName}
        className='h-9 w-auto min-w-0 gap-2 rounded-[10px]'
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent align='end'>
        {options.map(option => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

export function ModelCard({ agent, canEdit }: { agent: Agent; canEdit: boolean }): ReactElement {
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [orderOpen, setOrderOpen] = useState(false);

  const draft = readModelCardDraft(agent.config);

  const persist = async (next: ModelCardDraft, successMessage: string): Promise<void> => {
    if (saving) return;
    setSaving(true);
    const previous = agent;
    const config = applyModelCard(agent.config, next);
    queryClient.setQueryData(clawAgentDetailKey(agent.slug), { ...agent, config });
    try {
      const updated = await updateClawAgent(agent.slug, { config });
      queryClient.setQueryData(clawAgentDetailKey(agent.slug), updated);
      toast.success(successMessage);
    } catch (err) {
      queryClient.setQueryData(clawAgentDetailKey(agent.slug), previous);
      toast.error(clawErrorText(err, 'Could not update the model settings'));
    } finally {
      setSaving(false);
    }
  };

  const providerLabel =
    draft.providerOrder.length > 0
      ? draft.providerOrder.map(key => PROVIDER_DISPLAY[key] ?? key).join(', ')
      : 'Spaces platform model';

  return (
    <DetailSection
      label='Model'
      info='Which provider answers, and when'
      {...(canEdit ? {} : { trailing: <ReadOnlyBadge /> })}
    >
      <DetailCard>
        {!canEdit && (
          <DetailLockedNote>
            Only the owner, a contributor, or an admin can change the model settings.
          </DetailLockedNote>
        )}
        <DetailRow title='Providers' hint='Top to bottom order'>
          {saving && (
            <Loader2 className='size-3.5 animate-spin text-muted-foreground' aria-hidden />
          )}
          <DetailValue>{providerLabel}</DetailValue>
          {canEdit && (
            <button
              type='button'
              onClick={() => setOrderOpen(true)}
              aria-label='Edit provider order'
              data-track-category='Claw Agents'
              data-track-name='Agent detail v2: edit provider order'
              className='flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
            >
              <PencilEditLine className='size-4' aria-hidden />
            </button>
          )}
        </DetailRow>

        <DetailRow title='Subagents' hint='A per-subagent override always wins over this'>
          <RowSelect
            value={draft.subagentMode}
            options={SUBAGENT_OPTIONS}
            editable={canEdit && !saving}
            label='Which provider subagents run on'
            trackName='Agent detail v2: set subagent provider'
            onChange={next =>
              void persist(
                { ...draft, subagentMode: next === 'parent' ? 'parent' : 'spaces' },
                'Subagent routing updated',
              )
            }
          />
        </DetailRow>

        <DetailRow
          title='Automated runs'
          hint='Scheduled jobs, automations and error-pipeline runs'
          last
        >
          <RowSelect
            value={draft.automationMode}
            options={AUTOMATION_OPTIONS}
            editable={canEdit && !saving}
            label='Which provider automation and scheduled runs use'
            trackName='Agent detail v2: set automation provider'
            onChange={next =>
              void persist(
                { ...draft, automationMode: next === 'platform' ? 'platform' : 'chat' },
                'Automated runs updated',
              )
            }
          />
        </DetailRow>
      </DetailCard>

      <ProviderOrderDialog
        open={orderOpen}
        onOpenChange={setOrderOpen}
        order={draft.providerOrder}
        saving={saving}
        onSave={next => {
          void persist({ ...draft, providerOrder: next }, 'Provider order updated').then(() =>
            setOrderOpen(false),
          );
        }}
      />
    </DetailSection>
  );
}
