import { useState, type ReactElement, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/Button/index';
import { cn } from '@/utils/classNames';
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
  DETAIL_TEXT_FIELD_CLASS_FOR,
  DETAIL_TEXT_VALUE_CLASS,
  DetailGroup,
  DetailLockedNote,
  DetailSection,
  DetailStack,
  ReadOnlyBadge,
  nestedDetailHeading,
  type DetailHeading,
  type DetailTypeScale,
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

/** Twin wraps rows in DetailGroup (heading stays outside). Library: same inner wrap, no second outer card. */
function libraryBehaviourRows(typeScale: DetailTypeScale, rows: ReactNode): ReactNode {
  return <DetailGroup typeScale={typeScale}>{rows}</DetailGroup>;
}

/** Twin Constant reminders: grey around the field, not the heading. Library stays ungrouped. */
function twinBehaviourContent(typeScale: DetailTypeScale, content: ReactNode): ReactNode {
  return typeScale === 'twin' ? libraryBehaviourRows(typeScale, content) : content;
}

export function AgentBehaviourTabV2({
  agent,
  canEdit,
  className,
  heading = 'section',
  typeScale = 'library',
  headingClassName,
}: {
  agent: Agent;
  canEdit: boolean;
  className?: string;
  heading?: DetailHeading;
  typeScale?: DetailTypeScale;
  headingClassName?: string;
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

  // Twin: setting-subcategory (14/400/1.35/tertiary), not nested field titles.
  const nestedHeading: DetailHeading =
    typeScale === 'twin' ? 'subcategory' : nestedDetailHeading(typeScale);

  return (
    <DetailSection
      heading={heading}
      typeScale={typeScale}
      label='Behaviour'
      {...(className === undefined ? {} : { className })}
      {...(headingClassName === undefined ? {} : { headingClassName })}
    >
      <DetailStack>
        <DetailSection
          heading={nestedHeading}
          typeScale={typeScale}
          label='Constant reminders'
          info='Extra instructions injected on every single turn'
          {...badge}
        >
          {lockNote}
          {twinBehaviourContent(
            typeScale,
            <div className='flex w-full flex-col gap-3'>
              <label
                htmlFor='behaviour-reminders'
                className='text-[14px] font-medium leading-[1.2] text-foreground'
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
                className={cn(
                  DETAIL_TEXT_FIELD_CLASS_FOR[typeScale],
                  DETAIL_TEXT_VALUE_CLASS,
                  'h-[86px] resize-y overflow-auto placeholder:text-foreground/40 read-only:opacity-70 focus:outline-none focus:ring-1 focus:ring-ring',
                )}
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
            </div>,
          )}
        </DetailSection>

        <DetailSection
          heading={nestedHeading}
          typeScale={typeScale}
          label='Sandbox'
          info='Which code this agent can reach'
          {...badge}
        >
          {lockNote}
          {libraryBehaviourRows(
            typeScale,
            <>
              <BehaviourRow
                typeScale={typeScale}
                title='Sandbox repository'
                hint="Pin this agent to one repo setup so a run can't pick the wrong one."
              >
                <BehaviourSelect
                  value={sandbox.sandboxRepo || NONE}
                  options={repoOptions}
                  editable={editable}
                  disabled={busy}
                  typeScale={typeScale}
                  label='Sandbox repository'
                  trackName='Agent detail v2: set sandbox repo'
                  onChange={next =>
                    setSandbox(
                      { sandboxRepo: next === NONE ? '' : next },
                      'Sandbox repository updated',
                    )
                  }
                />
              </BehaviourRow>

              <BehaviourRow
                typeScale={typeScale}
                title='Read-only multi-repo sandbox'
                hint='Grep across every cloned repo with no per-project clone. Mutating tools are stripped, so this suits agents that only read code.'
              >
                <BehaviourToggle
                  checked={sandbox.forceReadOnlySandbox}
                  editable={editable}
                  disabled={busy}
                  label='Read-only multi-repo sandbox'
                  trackName='Agent detail v2: toggle read-only sandbox'
                  onChange={next =>
                    setSandbox({ forceReadOnlySandbox: next }, 'Sandbox mode updated')
                  }
                />
              </BehaviourRow>

              <BehaviourRow
                typeScale={typeScale}
                title='Research product'
                hint='Used by query-codebase and review-pull-request. Takes priority over the repository below.'
              >
                <BehaviourSelect
                  value={sandbox.researchProductId || NONE}
                  options={productOptions}
                  editable={editable}
                  disabled={busy}
                  typeScale={typeScale}
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
                typeScale={typeScale}
                title='Research repository'
                hint='Used for code research when no product is pinned.'
                last
              >
                <BehaviourSelect
                  value={sandbox.researchRepositoryId || NONE}
                  options={repositoryOptions}
                  editable={editable}
                  disabled={busy}
                  typeScale={typeScale}
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
            </>,
          )}
        </DetailSection>

        <DetailSection
          heading={nestedHeading}
          typeScale={typeScale}
          label='Autonomy'
          info='How far the agent runs on its own'
          {...badge}
        >
          {lockNote}
          {libraryBehaviourRows(
            typeScale,
            <>
              <BehaviourRow
                typeScale={typeScale}
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
                typeScale={typeScale}
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
            </>,
          )}
        </DetailSection>

        <DetailSection
          heading={nestedHeading}
          typeScale={typeScale}
          label='Verification'
          info='Checks run before the agent replies'
          {...badge}
        >
          {lockNote}
          {libraryBehaviourRows(
            typeScale,
            <>
              <BehaviourRow
                typeScale={typeScale}
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
                typeScale={typeScale}
                title='Enforce citations'
                hint='Nudge the agent to rewrite with inline citations when it used citeable sources but cited none. No extra model call.'
              >
                <BehaviourToggle
                  checked={behaviour.citationReflection}
                  editable={editable}
                  disabled={busy}
                  label='Enforce citations'
                  trackName='Agent detail v2: toggle enforce citations'
                  onChange={next =>
                    setBehaviour({ citationReflection: next }, 'Verification updated')
                  }
                />
              </BehaviourRow>

              <BehaviourRow
                typeScale={typeScale}
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
                  onChange={next =>
                    setBehaviour({ autoToolCitations: next }, 'Verification updated')
                  }
                />
              </BehaviourRow>
            </>,
          )}
        </DetailSection>

        <DetailSection
          heading={nestedHeading}
          typeScale={typeScale}
          label='Output'
          info='Shape of the final answer'
          {...badge}
        >
          {lockNote}
          {libraryBehaviourRows(
            typeScale,
            <BehaviourRow
              typeScale={typeScale}
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
            </BehaviourRow>,
          )}
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
      </DetailStack>
    </DetailSection>
  );
}
