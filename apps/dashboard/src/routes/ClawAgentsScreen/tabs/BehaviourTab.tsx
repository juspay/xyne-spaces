import { ReactElement, ReactNode } from 'react';
import { Eye, Plus, Trash2 } from 'lucide-react';
import { cn } from '@/utils/classNames';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { Switch } from '@/components/ui/Switch';
import { SegmentedToggle } from '@/components/ui/SegmentedToggle';
import { Button } from '@/components/ui/Button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/Select/Select';
import type { AgentPermissions } from '@/services/claw/agentPermissions';
import type {
  BehaviourDraft,
  SkillTriggerDraft,
  SkillTriggerMatchMode,
  SkillTriggerWhen,
} from '@/services/claw/behaviourConfig';
import type { Skill } from '@/services/claw/clawSkillsTypes';

interface BehaviourTabProps {
  permissions: AgentPermissions;
  value: BehaviourDraft;
  onChange: (patch: Partial<BehaviourDraft>) => void;
  skills: readonly Skill[];
}

const ToggleCard = ({
  title,
  description,
  checked,
  onCheckedChange,
  disabled,
  children,
}: {
  title: string;
  description: string;
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
  disabled: boolean;
  children?: ReactNode;
}): ReactElement => (
  <div className='rounded-lg border border-border p-4'>
    <div className='flex items-start justify-between gap-4'>
      <div className='flex flex-col gap-0.5'>
        <span className='text-sm font-medium text-foreground'>{title}</span>
        <p className='text-xs text-muted-foreground'>{description}</p>
      </div>
      <Switch
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        aria-label={title}
      />
    </div>
    {checked && children ? (
      <div className='mt-3 flex flex-col gap-3 border-t border-border pt-3'>{children}</div>
    ) : null}
  </div>
);

const Labeled = ({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactElement;
}): ReactElement => (
  <div className='flex flex-col gap-1.5'>
    <span className='text-xs font-medium text-foreground'>{label}</span>
    {children}
    {hint && <p className='text-xs text-muted-foreground'>{hint}</p>}
  </div>
);

const WHEN_OPTIONS: { value: SkillTriggerWhen; label: string }[] = [
  { value: 'before', label: 'Before' },
  { value: 'after', label: 'After' },
];

const MATCH_OPTIONS: { value: SkillTriggerMatchMode; label: string }[] = [
  { value: 'exact', label: 'Exact' },
  { value: 'prefix', label: 'Prefix' },
  { value: 'suffix', label: 'Suffix' },
  { value: 'contains', label: 'Contains' },
];

const newTrigger = (): SkillTriggerDraft => ({
  id: `st-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  toolName: '',
  skillSlug: '',
  when: 'before',
  matchMode: 'exact',
  prompt: '',
});

/**
 * Behaviour tab — extra rules and autonomy applied on every turn, stored in the
 * agent's `config` bag. Edits flow up into the screen's behaviour draft and are
 * persisted (merged into config) by the header's Save button. Controls are
 * disabled / read-only when `!permissions.canEdit`.
 */
const BehaviourTab = ({ permissions, value, onChange, skills }: BehaviourTabProps): ReactElement => {
  const canEdit = permissions.canEdit;
  const readOnlyCls = cn(!canEdit && 'cursor-default bg-muted/40 text-muted-foreground');

  const updateTrigger = (id: string, patch: Partial<SkillTriggerDraft>): void => {
    onChange({
      skillTriggers: value.skillTriggers.map(t => (t.id === id ? { ...t, ...patch } : t)),
    });
  };

  const addTrigger = (): void => {
    onChange({ skillTriggers: [...value.skillTriggers, newTrigger()] });
  };

  const removeTrigger = (id: string): void => {
    onChange({ skillTriggers: value.skillTriggers.filter(t => t.id !== id) });
  };

  return (
    <div className='flex max-w-2xl flex-col gap-4'>
      {!canEdit && (
        <div className='flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground'>
          <Eye className='size-4 shrink-0' />
          View-only access — you can’t edit this agent.
        </div>
      )}

      {/* Constant reminders — a plain field, no card chrome. */}
      <div className='flex flex-col gap-1.5'>
        <span className='text-sm font-medium text-foreground'>Constant reminders</span>
        <Textarea
          value={value.promptInjection}
          onChange={e => onChange({ promptInjection: e.target.value })}
          readOnly={!canEdit}
          placeholder='e.g. Always respond in the user’s language.'
          className={cn('min-h-[96px]', readOnlyCls)}
        />
        <p className='text-xs text-muted-foreground'>
          Extra instructions injected on every turn, on top of the system prompt.
        </p>
      </div>

      <ToggleCard
        title='Suggest goals'
        description='Let the agent propose a one-click “run autonomously” action when it detects a goal.'
        checked={value.suggestGoal}
        onCheckedChange={next => onChange({ suggestGoal: next })}
        disabled={!canEdit}
      />

      <ToggleCard
        title='Always goal'
        description='Wrap every message as an autonomous /goal loop.'
        checked={value.autoGoal}
        onCheckedChange={next => onChange({ autoGoal: next })}
        disabled={!canEdit}
      />

      <ToggleCard
        title='Plan mode'
        description='For multi-step requests in threads and DMs, propose a plan and wait for approval before doing the work. Trivial asks run without a prompt. Off = act immediately (default).'
        checked={value.planMode}
        onCheckedChange={next => onChange({ planMode: next })}
        disabled={!canEdit}
      >
        <Labeled
          label='Plan-mode prompt'
          hint='System prompt used while the agent scopes a plan (pre-filled with the default — edit only if you need custom guidance). The propose-then-approve gate is always enforced regardless of this text.'
        >
          <Textarea
            value={value.planModePrompt}
            onChange={e => onChange({ planModePrompt: e.target.value })}
            readOnly={!canEdit}
            className={cn('min-h-[180px] font-mono text-[13px]', readOnlyCls)}
          />
        </Labeled>
      </ToggleCard>

      <ToggleCard
        title='Verify responses'
        description='Check factual claims against gathered tool evidence before replying.'
        checked={value.verifyResponses}
        onCheckedChange={next => onChange({ verifyResponses: next })}
        disabled={!canEdit}
      >
        <Labeled
          label='Delivery criteria'
          hint='Extra requirements the response must meet — missing evidence counts as a failure.'
        >
          <Textarea
            value={value.verifyResponseCriteria}
            onChange={e => onChange({ verifyResponseCriteria: e.target.value })}
            readOnly={!canEdit}
            placeholder='e.g. Must include a link to the source PR.'
            className={cn('min-h-[72px]', readOnlyCls)}
          />
        </Labeled>
      </ToggleCard>

      <ToggleCard
        title='Enforce citations'
        description='Nudge the agent to add inline citations when it used citeable sources but cited none.'
        checked={value.citationReflection}
        onCheckedChange={next => onChange({ citationReflection: next })}
        disabled={!canEdit}
      />

      <ToggleCard
        title='Auto-cite all tools'
        description='Inject citation tokens into every tool result so any output can be cited.'
        checked={value.autoToolCitations}
        onCheckedChange={next => onChange({ autoToolCitations: next })}
        disabled={!canEdit}
      />

      {/* Skill triggers — deterministic tool → skill loading. */}
      <div className='rounded-lg border border-border p-4'>
        <div className='mb-4 flex flex-col gap-0.5'>
          <span className='text-sm font-medium text-foreground'>Skill triggers</span>
          <p className='text-xs text-muted-foreground'>
            When a specific tool is called, automatically load a skill. The runtime matches
            tool names against the rule below.
          </p>
        </div>

        <div className='flex flex-col gap-3'>
          {value.skillTriggers.length === 0 && (
            <p className='text-xs text-muted-foreground'>No triggers configured yet.</p>
          )}

          {value.skillTriggers.map(trigger => (
            <div
              key={trigger.id}
              className='flex flex-col gap-3 rounded-md border border-border bg-muted/20 p-3'
            >
              <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
                <Labeled label='Tool name' hint='Exact name or substring of the tool to match.'>
                  <Input
                    value={trigger.toolName}
                    onChange={e => updateTrigger(trigger.id, { toolName: e.target.value })}
                    readOnly={!canEdit}
                    placeholder='e.g. Create HTML Report'
                    className={readOnlyCls}
                  />
                </Labeled>

                <Labeled label='Skill'>
                  <Select
                    value={trigger.skillSlug}
                    onValueChange={skillSlug => updateTrigger(trigger.id, { skillSlug })}
                    disabled={!canEdit}
                  >
                    <SelectTrigger className='w-full'>
                      <SelectValue placeholder='Choose a skill…' />
                    </SelectTrigger>
                    <SelectContent>
                      {skills.map(skill => (
                        <SelectItem key={skill.slug} value={skill.name}>
                          {skill.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Labeled>

                <Labeled label='When'>
                  <Select
                    value={trigger.when}
                    onValueChange={w => updateTrigger(trigger.id, { when: w as SkillTriggerWhen })}
                    disabled={!canEdit}
                  >
                    <SelectTrigger className='w-full'>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {WHEN_OPTIONS.map(opt => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Labeled>

                <Labeled label='Match' hint='How closely the tool name must match.'>
                  <Select
                    value={trigger.matchMode}
                    onValueChange={m =>
                      updateTrigger(trigger.id, { matchMode: m as SkillTriggerMatchMode })
                    }
                    disabled={!canEdit}
                  >
                    <SelectTrigger className='w-full'>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {MATCH_OPTIONS.map(opt => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Labeled>
              </div>

              <Labeled
                label='Extra prompt (optional)'
                hint='Additional instructions to prepend alongside the loaded skill.'
              >
                <Textarea
                  value={trigger.prompt}
                  onChange={e => updateTrigger(trigger.id, { prompt: e.target.value })}
                  readOnly={!canEdit}
                  placeholder='e.g. Follow the design system for dashboards.'
                  className={cn('min-h-[64px]', readOnlyCls)}
                />
              </Labeled>

              {canEdit && (
                <div className='flex justify-end'>
                  <Button
                    type='button'
                    variant='outline'
                    size='sm'
                    onClick={() => removeTrigger(trigger.id)}
                    className='gap-1.5 text-destructive hover:text-destructive'
                  >
                    <Trash2 className='size-4' />
                    Remove
                  </Button>
                </div>
              )}
            </div>
          ))}

          {canEdit && (
            <Button
              type='button'
              variant='outline'
              size='sm'
              onClick={addTrigger}
              className='w-fit gap-1.5'
            >
              <Plus className='size-4' />
              Add trigger
            </Button>
          )}
        </div>
      </div>

      <ToggleCard
        title='Structured output'
        description='Require the final answer to be delivered through a structured format.'
        checked={value.outputFormatEnabled}
        onCheckedChange={next => onChange({ outputFormatEnabled: next })}
        disabled={!canEdit}
      >
        <div className='flex items-center gap-3'>
          <span className='text-xs font-medium text-foreground'>Format</span>
          <div
            className={cn(!canEdit && 'pointer-events-none opacity-60')}
            aria-disabled={!canEdit}
          >
            <SegmentedToggle
              options={[
                { value: 'json', label: 'JSON' },
                { value: 'markdown', label: 'Markdown' },
              ]}
              value={value.outputType}
              onChange={v => onChange({ outputType: v })}
            />
          </div>
        </div>

        {value.outputType === 'json' ? (
          <>
            <Labeled label='JSON schema' hint='A JSON Schema object with a top-level “type”.'>
              <Textarea
                value={value.outputSchema}
                onChange={e => onChange({ outputSchema: e.target.value })}
                readOnly={!canEdit}
                placeholder={'{\n  "type": "object",\n  "properties": { }\n}'}
                className={cn('min-h-[140px] font-mono text-[13px]', readOnlyCls)}
              />
            </Labeled>
            <Labeled label='Render template' hint='Optional. Markdown template for the chat reply.'>
              <Textarea
                value={value.outputTemplate}
                onChange={e => onChange({ outputTemplate: e.target.value })}
                readOnly={!canEdit}
                className={cn('min-h-[72px] font-mono text-[13px]', readOnlyCls)}
              />
            </Labeled>
          </>
        ) : (
          <Labeled label='Outline' hint='Optional. Structural outline the markdown should follow.'>
            <Textarea
              value={value.outputTemplate}
              onChange={e => onChange({ outputTemplate: e.target.value })}
              readOnly={!canEdit}
              className={cn('min-h-[96px] font-mono text-[13px]', readOnlyCls)}
            />
          </Labeled>
        )}

        <Labeled
          label='Required tools before submit'
          hint='Comma- or newline-separated tool-name substrings that must run first.'
        >
          <Input
            value={value.outputRequireTools}
            onChange={e => onChange({ outputRequireTools: e.target.value })}
            readOnly={!canEdit}
            placeholder='e.g. search, fetch'
            className={readOnlyCls}
          />
        </Labeled>
      </ToggleCard>
    </div>
  );
};

export default BehaviourTab;
