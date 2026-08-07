import { useState, type ReactElement } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/Button/index';
import { clawAgentDetailKey } from '@/hooks/useClawAgentDetail';
import { useClawResearchAgentOptions } from '@/hooks/useClawResearchAgentOptions';
import { updateClawAgent } from '@/services/claw/clawAuthAgentsService';
import { clawErrorText } from '@/services/claw/clawRequest';
import {
  applyBehaviour,
  readBehaviourDraft,
  type BehaviourDraft,
} from '@/services/claw/behaviourConfig';
import type { Agent } from '@/services/claw/clawAuthAgentTypes';
import {
  DetailCard,
  DetailLockedNote,
  DetailSection,
  ReadOnlyBadge,
} from '../../../shared/primitives/DetailPrimitives';
import {
  BehaviourEditButton,
  BehaviourRow,
  BehaviourSelect,
  BehaviourToggle,
} from './BehaviourRows';
import { BehaviourTextDialog } from './BehaviourTextDialog';
import { StructuredOutputDialog } from './StructuredOutputDialog';
import {
  applySandbox,
  readSandboxDraft,
  useSandboxRepos,
  type SandboxDraft,
} from './sandboxConfig';

const NONE = '__none__';

const LOCK_NOTE = 'Only the owner, a contributor, or an admin can change how this agent behaves.';

export function AgentBehaviourTabV2({
  agent,
  canEdit,
}: {
  agent: Agent;
  canEdit: boolean;
}): ReactElement {
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [outputOpen, setOutputOpen] = useState(false);
  const [criteriaOpen, setCriteriaOpen] = useState(false);

  const { data: repos } = useSandboxRepos();
  const research = useClawResearchAgentOptions();

  const behaviour = readBehaviourDraft(agent.config);
  const sandbox = readSandboxDraft(agent.config);

  const [reminders, setReminders] = useState(behaviour.promptInjection);
  const remindersDirty = reminders.trim() !== behaviour.promptInjection.trim();

  const persist = async (config: Record<string, unknown>, message: string): Promise<boolean> => {
    if (saving) return false;
    setSaving(true);
    const previous = agent;
    queryClient.setQueryData(clawAgentDetailKey(agent.slug), { ...agent, config });
    try {
      const updated = await updateClawAgent(agent.slug, { config });
      queryClient.setQueryData(clawAgentDetailKey(agent.slug), updated);
      void queryClient.invalidateQueries({ queryKey: ['claw-auth-agents'] });
      toast.success(message);
      return true;
    } catch (err) {
      queryClient.setQueryData(clawAgentDetailKey(agent.slug), previous);
      toast.error(clawErrorText(err, 'Could not update this agent'));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const saveBehaviour = async (patch: Partial<BehaviourDraft>, message: string): Promise<boolean> =>
    persist(applyBehaviour(agent.config, { ...behaviour, ...patch }), message);

  const setBehaviour = (patch: Partial<BehaviourDraft>, message: string): void => {
    void saveBehaviour(patch, message);
  };

  const setSandbox = (patch: Partial<SandboxDraft>, message: string): void => {
    void persist(applySandbox(agent.config, { ...sandbox, ...patch }), message);
  };

  const lockNote = canEdit ? null : <DetailLockedNote>{LOCK_NOTE}</DetailLockedNote>;
  const badge = canEdit ? {} : { trailing: <ReadOnlyBadge /> };
  const editable = canEdit;
  const busy = saving;

  const repoOptions = [
    { value: NONE, label: 'None (agent chooses)' },
    ...(repos ?? []).map(repo => ({ value: repo.key, label: repo.name })),
  ];
  const productOptions = [
    { value: NONE, label: 'None' },
    ...research.products.map(option => ({ value: option.id, label: option.name })),
  ];
  const repositoryOptions = [
    { value: NONE, label: 'None' },
    ...research.repositories.map(option => ({ value: option.id, label: option.name })),
  ];

  return (
    <div className='flex w-full flex-col gap-8'>
      <DetailSection
        label='Constant reminders'
        info='Extra instructions injected on every single turn'
        {...badge}
      >
        <DetailCard>
          {lockNote}
          <div className='flex w-full flex-col gap-3 p-4'>
            <label
              htmlFor='behaviour-reminders'
              className='text-sm font-medium leading-[1.2] tracking-[-0.1px] text-foreground'
            >
              Description
            </label>
            <textarea
              id='behaviour-reminders'
              value={reminders}
              readOnly={!editable}
              onChange={e => setReminders(e.target.value)}
              placeholder="eg. Always respond in the user's language"
              data-track-category='Claw Agents'
              data-track-name='Agent detail v2: reminders'
              className='h-[86px] w-full resize-y rounded-2xl border border-border bg-card p-4 text-sm leading-5 text-foreground placeholder:text-muted-foreground read-only:opacity-70 focus:outline-none focus:ring-1 focus:ring-ring'
            />
            {editable && remindersDirty && (
              <div className='flex items-center justify-end gap-3'>
                <Button
                  variant='ghost'
                  onClick={() => setReminders(behaviour.promptInjection)}
                  disabled={busy}
                  className='h-auto rounded-xl px-3 py-2 text-sm'
                  data-track-category='Claw Agents'
                  data-track-name='Agent detail v2: discard reminders'
                >
                  Discard
                </Button>
                <Button
                  onClick={() => {
                    void saveBehaviour({ promptInjection: reminders }, 'Reminders updated').then(
                      ok => {
                        if (!ok) return;
                        setReminders(reminders.trim());
                      },
                    );
                  }}
                  loading={busy}
                  className='h-auto rounded-xl bg-foreground px-3 py-2 text-sm text-background hover:bg-foreground/90'
                  data-track-category='Claw Agents'
                  data-track-name='Agent detail v2: save reminders'
                >
                  Save
                </Button>
              </div>
            )}
          </div>
        </DetailCard>
      </DetailSection>

      <DetailSection label='Sandbox' info='Which code this agent can reach' {...badge}>
        <DetailCard>
          {lockNote}
          <BehaviourRow
            title='Sandbox repository'
            hint="Pin this agent to one repo setup so a run can't pick the wrong one."
          >
            <BehaviourSelect
              value={sandbox.sandboxRepo || NONE}
              options={repoOptions}
              editable={editable}
              disabled={busy}
              label='Sandbox repository'
              trackName='Agent detail v2: set sandbox repo'
              onChange={next =>
                setSandbox({ sandboxRepo: next === NONE ? '' : next }, 'Sandbox repository updated')
              }
            />
          </BehaviourRow>

          <BehaviourRow
            title='Read-only multi-repo sandbox'
            hint='Grep across every cloned repo with no per-project clone. Mutating tools are stripped, so this suits agents that only read code.'
          >
            <BehaviourToggle
              checked={sandbox.forceReadOnlySandbox}
              editable={editable}
              disabled={busy}
              label='Read-only multi-repo sandbox'
              trackName='Agent detail v2: toggle read-only sandbox'
              onChange={next => setSandbox({ forceReadOnlySandbox: next }, 'Sandbox mode updated')}
            />
          </BehaviourRow>

          <BehaviourRow
            title='Research product'
            hint='Used by query-codebase and review-pull-request. Takes priority over the repository below.'
          >
            <BehaviourSelect
              value={sandbox.researchProductId || NONE}
              options={productOptions}
              editable={editable}
              disabled={busy}
              label='Research product'
              trackName='Agent detail v2: set research product'
              onChange={next =>
                setSandbox(
                  { researchProductId: next === NONE ? '' : next },
                  'Research product updated',
                )
              }
            />
          </BehaviourRow>

          <BehaviourRow
            title='Research repository'
            hint='Used for code research when no product is pinned.'
            last
          >
            <BehaviourSelect
              value={sandbox.researchRepositoryId || NONE}
              options={repositoryOptions}
              editable={editable}
              disabled={busy}
              label='Research repository'
              trackName='Agent detail v2: set research repository'
              onChange={next =>
                setSandbox(
                  { researchRepositoryId: next === NONE ? '' : next },
                  'Research repository updated',
                )
              }
            />
          </BehaviourRow>
        </DetailCard>
      </DetailSection>

      <DetailSection label='Autonomy' info='How far the agent runs on its own' {...badge}>
        <DetailCard>
          {lockNote}
          <BehaviourRow
            title='Suggest goals'
            hint='Let this agent propose an autonomous run. At the end of a multi-step plan the user gets a one-click button to take the work to completion.'
          >
            <BehaviourToggle
              checked={behaviour.suggestGoal}
              editable={editable}
              disabled={busy}
              label='Suggest goals'
              trackName='Agent detail v2: toggle suggest goals'
              onChange={next => setBehaviour({ suggestGoal: next }, 'Autonomy updated')}
            />
          </BehaviourRow>

          <BehaviourRow
            title='Always goal'
            hint='Run every message as an autonomous loop. Only for agents purpose-built for it — users can type /stop to cancel mid-run.'
            last
          >
            <BehaviourToggle
              checked={behaviour.autoGoal}
              editable={editable}
              disabled={busy}
              label='Always goal'
              trackName='Agent detail v2: toggle always goal'
              onChange={next => setBehaviour({ autoGoal: next }, 'Autonomy updated')}
            />
          </BehaviourRow>
        </DetailCard>
      </DetailSection>

      <DetailSection label='Verification' info='Checks run before the agent replies' {...badge}>
        <DetailCard>
          {lockNote}
          <BehaviourRow
            title='Verify responses'
            hint='Check factual claims against the gathered tool results before replying. Adds one model call per response.'
          >
            {editable && behaviour.verifyResponses && (
              <BehaviourEditButton
                label='Edit delivery criteria'
                trackName='Agent detail v2: edit verify criteria'
                disabled={busy}
                onClick={() => setCriteriaOpen(true)}
              />
            )}
            <BehaviourToggle
              checked={behaviour.verifyResponses}
              editable={editable}
              disabled={busy}
              label='Verify responses'
              trackName='Agent detail v2: toggle verify responses'
              onChange={next => setBehaviour({ verifyResponses: next }, 'Verification updated')}
            />
          </BehaviourRow>

          <BehaviourRow
            title='Enforce citations'
            hint='Nudge the agent to rewrite with inline citations when it used citeable sources but cited none. No extra model call.'
          >
            <BehaviourToggle
              checked={behaviour.citationReflection}
              editable={editable}
              disabled={busy}
              label='Enforce citations'
              trackName='Agent detail v2: toggle enforce citations'
              onChange={next => setBehaviour({ citationReflection: next }, 'Verification updated')}
            />
          </BehaviourRow>

          <BehaviourRow
            title='Auto-cite all tools'
            hint='Inject citation tokens into every tool result so any output can be cited back to its source.'
            last
          >
            <BehaviourToggle
              checked={behaviour.autoToolCitations}
              editable={editable}
              disabled={busy}
              label='Auto-cite all tools'
              trackName='Agent detail v2: toggle auto-cite tools'
              onChange={next => setBehaviour({ autoToolCitations: next }, 'Verification updated')}
            />
          </BehaviourRow>
        </DetailCard>
      </DetailSection>

      <DetailSection label='Output' info='Shape of the final answer' {...badge}>
        <DetailCard>
          {lockNote}
          <BehaviourRow
            title='Structured output'
            hint='Force the final answer into a fixed format. The agent still works normally — only the answer is constrained.'
            last
          >
            {editable && behaviour.outputFormatEnabled && (
              <BehaviourEditButton
                label='Edit output format'
                trackName='Agent detail v2: edit structured output'
                disabled={busy}
                onClick={() => setOutputOpen(true)}
              />
            )}
            <BehaviourToggle
              checked={behaviour.outputFormatEnabled}
              editable={editable}
              disabled={busy}
              label='Structured output'
              trackName='Agent detail v2: toggle structured output'
              onChange={next => {
                // Turning it on needs a schema, so the dialog collects one first.
                if (next) setOutputOpen(true);
                else setBehaviour({ outputFormatEnabled: false }, 'Structured output turned off');
              }}
            />
          </BehaviourRow>
        </DetailCard>
      </DetailSection>

      {busy && (
        <span className='flex items-center gap-2 text-xs font-normal leading-4 text-muted-foreground'>
          <Loader2 className='size-3.5 animate-spin' aria-hidden />
          Saving…
        </span>
      )}

      <BehaviourTextDialog
        open={criteriaOpen}
        onOpenChange={setCriteriaOpen}
        title='Delivery criteria'
        description='Extra conditions the verifier checks before an answer is delivered.'
        label='Criteria'
        placeholder='eg. Every number must come from a tool result, never from memory.'
        testId='verify-criteria-dialog'
        value={behaviour.verifyResponseCriteria}
        saving={busy}
        onSave={next => {
          void saveBehaviour({ verifyResponseCriteria: next }, 'Delivery criteria updated').then(
            ok => {
              if (ok) setCriteriaOpen(false);
            },
          );
        }}
      />

      <StructuredOutputDialog
        open={outputOpen}
        onOpenChange={setOutputOpen}
        behaviour={behaviour}
        saving={busy}
        onSave={next => {
          void saveBehaviour(next, 'Structured output updated').then(ok => {
            if (ok) setOutputOpen(false);
          });
        }}
      />
    </div>
  );
}
