import { ReactElement, ReactNode, useEffect, useState } from 'react';
import { Eye, Search, X, Loader2, Lock } from 'lucide-react';
import { cn } from '@/utils/classNames';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { Switch } from '@/components/ui/Switch';
import { SegmentedToggle } from '@/components/ui/SegmentedToggle';
import Avatar from '@/components/ui/Avatar/Avatar';
import { useAuth } from '@/hooks/useAuth';
import { searchClawUsers } from '@/services/claw/clawAuthAgentsService';
import type { ClawUser } from '@/services/claw/clawAuthAgentTypes';
import type { AgentPermissions } from '@/services/claw/agentPermissions';
import type { BehaviourDraft } from '@/services/claw/behaviourConfig';

/**
 * Whitelist people-picker for the Privacy section. Stores userIds in the draft;
 * resolves display names from the live search (a session cache), falling back
 * to a short id for members added in an earlier session. The server enforces
 * the whitelist at every dispatch chokepoint (isAgentInvocableBy).
 */
const WhitelistPicker = ({
  whitelist,
  onChange,
  disabled,
}: {
  whitelist: string[];
  onChange: (ids: string[]) => void;
  disabled: boolean;
}): ReactElement => {
  const { user } = useAuth();
  const requesterId = user?.id ?? '';
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ClawUser[]>([]);
  const [searching, setSearching] = useState(false);
  const [nameCache, setNameCache] = useState<Record<string, ClawUser>>({});

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const t = setTimeout(() => {
      searchClawUsers(q, requesterId)
        .then(users => {
          if (cancelled) return;
          setResults(users);
          setNameCache(prev => {
            const next = { ...prev };
            for (const u of users) next[u.id] = u;
            return next;
          });
        })
        .catch(() => {
          if (!cancelled) setResults([]);
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, requesterId]);

  const add = (u: ClawUser): void => {
    if (!whitelist.includes(u.id)) onChange([...whitelist, u.id]);
    setQuery('');
    setResults([]);
  };
  const remove = (id: string): void => onChange(whitelist.filter(x => x !== id));

  const visibleResults = results.filter(u => !whitelist.includes(u.id));

  return (
    <div className='flex flex-col gap-3'>
      {/* Selected members */}
      {whitelist.length === 0 ? (
        <p className='text-xs text-muted-foreground'>
          No one is allowed yet — an empty whitelist means <span className='font-medium'>nobody</span> can call this agent. Add people below.
        </p>
      ) : (
        <div className='flex flex-wrap gap-2'>
          {whitelist.map(id => {
            const u = nameCache[id];
            return (
              <span
                key={id}
                className='inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/40 py-1 pl-1.5 pr-2 text-xs'
              >
                <Avatar userId={id} size='xs' />
                <span className='max-w-[160px] truncate' title={u?.email ?? id}>
                  {u?.name ?? `User ${id.slice(0, 8)}…`}
                </span>
                {!disabled && (
                  <button
                    type='button'
                    onClick={() => remove(id)}
                    className='rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground'
                    aria-label={`Remove ${u?.name ?? id}`}
                  >
                    <X className='size-3' />
                  </button>
                )}
              </span>
            );
          })}
        </div>
      )}

      {/* Search + add */}
      {!disabled && (
        <div className='relative'>
          <div className='flex items-center gap-2 rounded-lg border border-border px-2.5'>
            <Search className='size-4 shrink-0 text-muted-foreground' />
            <Input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder='Search people by name or email…'
              className='border-0 px-0 focus-visible:ring-0'
            />
            {searching && <Loader2 className='size-4 shrink-0 animate-spin text-muted-foreground' />}
          </div>
          {visibleResults.length > 0 && (
            <div className='absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-border bg-popover shadow-md'>
              {visibleResults.map(u => (
                <button
                  key={u.id}
                  type='button'
                  onClick={() => add(u)}
                  className='flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted'
                >
                  <Avatar userId={u.id} size='sm' />
                  <span className='flex flex-col'>
                    <span className='font-medium'>{u.name}</span>
                    <span className='text-xs text-muted-foreground'>{u.email}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

interface BehaviourTabProps {
  permissions: AgentPermissions;
  value: BehaviourDraft;
  onChange: (patch: Partial<BehaviourDraft>) => void;
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

/**
 * Behaviour tab — extra rules and autonomy applied on every turn, stored in the
 * agent's `config` bag. Edits flow up into the screen's behaviour draft and are
 * persisted (merged into config) by the header's Save button. Controls are
 * disabled / read-only when `!permissions.canEdit`.
 */
const BehaviourTab = ({ permissions, value, onChange }: BehaviourTabProps): ReactElement => {
  const canEdit = permissions.canEdit;
  const readOnlyCls = cn(!canEdit && 'cursor-default bg-muted/40 text-muted-foreground');

  return (
    <div className='flex max-w-2xl flex-col gap-4'>
      {!canEdit && (
        <div className='flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground'>
          <Eye className='size-4 shrink-0' />
          View-only access — you can’t edit this agent.
        </div>
      )}

      {/* Privacy — who can invoke this agent, enforced across every surface. */}
      <div className='rounded-lg border border-border p-4'>
        <div className='flex items-start justify-between gap-4'>
          <div className='flex flex-col gap-0.5'>
            <span className='flex items-center gap-1.5 text-sm font-medium text-foreground'>
              <Lock className='size-3.5' /> Privacy
            </span>
            <p className='text-xs text-muted-foreground'>
              Who can call this agent. Applies everywhere — mentions, DMs, automations, chat and CLI.
            </p>
          </div>
          <SegmentedToggle<'everyone' | 'whitelist'>
            options={[
              { value: 'everyone', label: 'Everyone' },
              { value: 'whitelist', label: 'Whitelist' },
            ]}
            value={value.privacyMode}
            onChange={mode => canEdit && onChange({ privacyMode: mode })}
          />
        </div>
        {value.privacyMode === 'whitelist' && (
          <div className='mt-3 border-t border-border pt-3'>
            <WhitelistPicker
              whitelist={value.whitelist}
              onChange={ids => onChange({ whitelist: ids })}
              disabled={!canEdit}
            />
          </div>
        )}
      </div>

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
