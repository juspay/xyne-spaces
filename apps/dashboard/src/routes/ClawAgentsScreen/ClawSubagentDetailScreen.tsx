import { ReactElement, useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ChevronLeft, Lock, Plus, Save, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Skeleton } from '@/components/ui/Skeleton';
import { Switch } from '@/components/ui/Switch';
import { Textarea } from '@/components/ui/Textarea';
import { ConfirmDialog } from '@/components/ClawAgents/ConfirmDialog';
import { ToolboxPicker } from '@/components/ClawAgents/ToolboxPicker/ToolboxPicker';
import { useAuth } from '@/hooks/useAuth';
import { useClawAvailableTools } from '@/hooks/useClawAvailableTools';
import { useIsClawAdmin } from '@/hooks/useIsClawAdmin';
import { useClawSkills } from '@/hooks/useClawSkills';
import {
  useClawSubagentDetail,
  useClawSubagentShares,
  useToggleClawSubagent,
  useUpdateClawSubagent,
} from '@/hooks/useClawSubagents';
import type { Skill } from '@/services/claw/clawSkillsTypes';
import {
  getSubagentPermissions,
  type SubagentDef,
  type SubagentInputBody,
  type SubagentShareEntry,
} from '@/services/claw/clawSubagentsTypes';
import { clawErrorText } from '@/services/claw/clawRequest';
import { fromToolboxSelection, toToolboxSelection } from '@/services/claw/subagentToolsBridge';
import type { ToolboxSelection } from '@/services/claw/clawToolsTypes';
import { cn } from '@/utils/classNames';

type DetailTab = 'persona' | 'knowledge' | 'tools' | 'contributors';

const TABS: Array<{ id: DetailTab; label: string }> = [
  { id: 'persona', label: 'Persona' },
  { id: 'knowledge', label: 'Knowledge' },
  { id: 'tools', label: 'Tools' },
  { id: 'contributors', label: 'Contributors' },
];

const splitItems = (value: string): string[] =>
  value
    .split(/[\n,]+/)
    .map(item => item.trim())
    .filter(Boolean);

const sameSet = (left: string[], right: string[]): boolean =>
  left.length === right.length && left.every(item => right.includes(item));

interface Draft {
  description: string;
  systemPrompt: string;
  paramName: string;
  paramDescription: string;
  progressLabels: string[];
  directTools: string;
  customTools: string;
  skillIds: string[];
}

const draftFromSubagent = (subagent: SubagentDef): Draft => ({
  description: subagent.description,
  systemPrompt: subagent.systemPrompt,
  paramName: subagent.paramName || 'question',
  paramDescription: subagent.paramDescription,
  progressLabels: subagent.progressLabels.length ? [...subagent.progressLabels] : [''],
  directTools: (subagent.tools?.direct ?? []).join('\n'),
  customTools: (subagent.tools?.custom ?? []).join('\n'),
  skillIds: subagent.skills.map(skill => skill.id),
});

const isDirty = (subagent: SubagentDef, draft: Draft): boolean =>
  draft.description !== subagent.description ||
  draft.systemPrompt !== subagent.systemPrompt ||
  draft.paramName !== (subagent.paramName || 'question') ||
  draft.paramDescription !== subagent.paramDescription ||
  draft.progressLabels
    .map(label => label.trim())
    .filter(Boolean)
    .join('\n') !== subagent.progressLabels.join('\n') ||
  draft.directTools !== (subagent.tools?.direct ?? []).join('\n') ||
  draft.customTools !== (subagent.tools?.custom ?? []).join('\n') ||
  !sameSet(
    draft.skillIds,
    subagent.skills.map(skill => skill.id),
  );

const toPayload = (subagent: SubagentDef, draft: Draft): SubagentInputBody => {
  const direct = splitItems(draft.directTools);
  const custom = splitItems(draft.customTools);
  const labels = draft.progressLabels.map(label => label.trim()).filter(Boolean);
  return {
    name: subagent.name,
    description: draft.description.trim(),
    systemPrompt: draft.systemPrompt.trim(),
    paramName: draft.paramName.trim() || 'question',
    paramDescription: draft.paramDescription.trim(),
    progressLabels: labels,
    tools: {
      ...(direct.length ? { direct } : {}),
      ...(custom.length ? { custom } : {}),
    },
    ...(draft.skillIds.length ? { skillIds: draft.skillIds } : {}),
    ...(subagent.mcpInstanceMap ? { mcpInstanceMap: subagent.mcpInstanceMap } : {}),
  };
};

const FieldLabel = ({ children }: { children: React.ReactNode }): ReactElement => (
  <span className='text-sm font-medium text-foreground'>{children}</span>
);

const PersonaTab = ({
  draft,
  setDraft,
  canEdit,
}: {
  draft: Draft;
  setDraft: React.Dispatch<React.SetStateAction<Draft>>;
  canEdit: boolean;
}): ReactElement => (
  <div className='flex flex-col gap-5'>
    <label htmlFor='subagent-description' className='flex flex-col gap-1.5'>
      <FieldLabel>Description</FieldLabel>
      <Input
        id='subagent-description'
        value={draft.description}
        onChange={event => setDraft(current => ({ ...current, description: event.target.value }))}
        readOnly={!canEdit}
        placeholder='What this subagent does and when it should be called'
      />
    </label>
    <label htmlFor='subagent-system-prompt' className='flex flex-col gap-1.5'>
      <div className='flex items-center justify-between'>
        <FieldLabel>System prompt</FieldLabel>
        <span className='text-xs text-muted-foreground'>
          {draft.systemPrompt.length} characters
        </span>
      </div>
      <Textarea
        id='subagent-system-prompt'
        value={draft.systemPrompt}
        onChange={event => setDraft(current => ({ ...current, systemPrompt: event.target.value }))}
        readOnly={!canEdit}
        className='min-h-80 font-mono text-xs leading-relaxed'
      />
    </label>
  </div>
);

const KnowledgeTab = ({
  draft,
  setDraft,
  canEdit,
  skills,
  skillsLoading,
}: {
  draft: Draft;
  setDraft: React.Dispatch<React.SetStateAction<Draft>>;
  canEdit: boolean;
  skills: Skill[];
  skillsLoading: boolean;
}): ReactElement => {
  const toggleSkill = (id: string): void => {
    if (!canEdit) return;
    setDraft(current => ({
      ...current,
      skillIds: current.skillIds.includes(id)
        ? current.skillIds.filter(skillId => skillId !== id)
        : [...current.skillIds, id],
    }));
  };
  return (
    <div className='flex flex-col gap-7'>
      <section className='flex flex-col gap-4'>
        <div>
          <h2 className='text-sm font-semibold text-foreground'>Parameter contract</h2>
          <p className='text-xs text-muted-foreground'>
            What the parent agent passes to this specialist.
          </p>
        </div>
        <div className='grid gap-4 sm:grid-cols-3'>
          <label htmlFor='subagent-param-name' className='flex flex-col gap-1.5'>
            <FieldLabel>Parameter name</FieldLabel>
            <Input
              id='subagent-param-name'
              value={draft.paramName}
              onChange={event =>
                setDraft(current => ({ ...current, paramName: event.target.value }))
              }
              readOnly={!canEdit}
            />
          </label>
          <label
            htmlFor='subagent-param-description'
            className='flex flex-col gap-1.5 sm:col-span-2'
          >
            <FieldLabel>Parameter description</FieldLabel>
            <Input
              id='subagent-param-description'
              value={draft.paramDescription}
              onChange={event =>
                setDraft(current => ({ ...current, paramDescription: event.target.value }))
              }
              readOnly={!canEdit}
            />
          </label>
        </div>
        <div className='flex flex-col gap-2'>
          <div className='flex items-center justify-between'>
            <FieldLabel>Progress labels</FieldLabel>
            {canEdit && (
              <Button
                type='button'
                variant='outline'
                size='sm'
                disabled={draft.progressLabels.length >= 8}
                onClick={() =>
                  setDraft(current => ({
                    ...current,
                    progressLabels: [...current.progressLabels, ''],
                  }))
                }
                data-track-category='Claw Agents'
                data-track-name='ADD_PROGRESS_LABEL'
              >
                <Plus className='size-3.5' /> Add label
              </Button>
            )}
          </div>
          {draft.progressLabels.map((label, index) => (
            <div key={index} className='flex gap-2'>
              <Input
                value={label}
                onChange={event =>
                  setDraft(current => ({
                    ...current,
                    progressLabels: current.progressLabels.map((item, itemIndex) =>
                      itemIndex === index ? event.target.value : item,
                    ),
                  }))
                }
                readOnly={!canEdit}
                placeholder='Working…'
              />
              {canEdit && (
                <Button
                  type='button'
                  variant='ghost'
                  size='iconSm'
                  disabled={draft.progressLabels.length === 1}
                  onClick={() =>
                    setDraft(current => ({
                      ...current,
                      progressLabels: current.progressLabels.filter((_, i) => i !== index),
                    }))
                  }
                  data-track-category='Claw Agents'
                  data-track-name='REMOVE_PROGRESS_LABEL'
                  aria-label='Remove progress label'
                >
                  <X className='size-4' />
                </Button>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className='flex flex-col gap-3'>
        <div>
          <h2 className='text-sm font-semibold text-foreground'>Skills</h2>
          <p className='text-xs text-muted-foreground'>
            Markdown playbooks available to this subagent.
          </p>
        </div>
        {skillsLoading ? (
          <Skeleton className='h-20 w-full' />
        ) : skills.length === 0 ? (
          <p className='rounded-lg border border-dashed border-border p-5 text-sm text-muted-foreground'>
            No skills available.
          </p>
        ) : (
          <div className='flex flex-wrap gap-2'>
            {skills.map(skill => {
              const selected = draft.skillIds.includes(skill.id);
              return (
                <button
                  key={skill.id}
                  type='button'
                  disabled={!canEdit}
                  onClick={() => toggleSkill(skill.id)}
                  data-track-category='Claw Agents'
                  data-track-name='Toggle subagent skill'
                >
                  <Badge variant={selected ? 'primary' : 'outline'}>{skill.name}</Badge>
                </button>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
};

const ToolsTab = ({
  draft,
  setDraft,
  canEdit,
}: {
  draft: Draft;
  setDraft: React.Dispatch<React.SetStateAction<Draft>>;
  canEdit: boolean;
}): ReactElement => {
  const { data: catalog, isLoading } = useClawAvailableTools();
  const selection = toToolboxSelection(
    { direct: splitItems(draft.directTools), custom: splitItems(draft.customTools) },
    catalog ?? null,
  );

  const handleChange = (next: ToolboxSelection): void => {
    if (!canEdit) return;
    const tools = fromToolboxSelection(next, catalog ?? null);
    setDraft(current => ({
      ...current,
      directTools: (tools.direct ?? []).join('\n'),
      customTools: (tools.custom ?? []).join('\n'),
    }));
  };

  return (
    <div className='flex flex-col gap-4'>
      <div>
        <h2 className='text-sm font-semibold text-foreground'>Tool access</h2>
        <p className='text-xs text-muted-foreground'>Choose actions this specialist can perform.</p>
      </div>
      <ToolboxPicker
        variant='large'
        largeHeight='clamp(420px, calc(100vh - 360px), 720px)'
        availableTools={catalog ?? null}
        loading={isLoading}
        value={selection}
        onChange={handleChange}
        suggestContext={{
          systemPrompt: draft.systemPrompt,
          description: draft.description,
        }}
        showCaption={false}
        hideSubagents
      />
    </div>
  );
};

const ContributorsTab = ({
  subagent,
  canShare,
}: {
  subagent: SubagentDef;
  canShare: boolean;
}): ReactElement => {
  const { add, remove } = useClawSubagentShares(subagent.name);
  const [input, setInput] = useState('');
  const shares: SubagentShareEntry[] = subagent.shares ?? [];
  const addShare = async (): Promise<void> => {
    const target = input.trim();
    if (!target) return;
    try {
      await add.mutateAsync(target);
      setInput('');
      toast.success('Contributor added');
    } catch (error) {
      toast.error(clawErrorText(error, 'Failed to add contributor'));
    }
  };
  const removeShare = async (share: SubagentShareEntry): Promise<void> => {
    try {
      await remove.mutateAsync(share.userId);
      toast.success('Contributor removed');
    } catch (error) {
      toast.error(clawErrorText(error, 'Failed to remove contributor'));
    }
  };
  if (subagent.source === 'builtin') {
    return (
      <div className='rounded-lg border border-dashed border-border p-8 text-center'>
        <Lock className='mx-auto size-6 text-muted-foreground' />
        <p className='mt-2 text-sm font-medium text-foreground'>
          Built-in subagents cannot be shared
        </p>
        <p className='mt-1 text-xs text-muted-foreground'>They are maintained by the platform.</p>
      </div>
    );
  }
  return (
    <div className='flex flex-col gap-5'>
      <div>
        <h2 className='text-sm font-semibold text-foreground'>Contributors</h2>
        <p className='text-xs text-muted-foreground'>People who can edit this subagent with you.</p>
      </div>
      {canShare && (
        <div className='flex gap-2'>
          <Input
            value={input}
            onChange={event => setInput(event.target.value)}
            placeholder='Email or user ID'
            onKeyDown={event => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void addShare();
              }
            }}
          />
          <Button
            onClick={() => void addShare()}
            data-track-category='Claw Agents'
            data-track-name='ADD_SUBAGENT_SHARE'
            loading={add.isPending}
            disabled={!input.trim()}
          >
            <Plus className='size-4' /> Add
          </Button>
        </div>
      )}
      {shares.length === 0 ? (
        <p className='rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground'>
          No contributors yet.
        </p>
      ) : (
        <div className='divide-y divide-border rounded-lg border border-border'>
          {shares.map(share => (
            <div key={share.userId} className='flex items-center gap-3 px-3 py-3'>
              <div className='flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-foreground'>
                {(share.name || share.email || '?').charAt(0).toUpperCase()}
              </div>
              <div className='min-w-0 flex-1'>
                <p className='truncate text-sm font-medium text-foreground'>
                  {share.name || share.email}
                </p>
                {share.name && (
                  <p className='truncate text-xs text-muted-foreground'>{share.email}</p>
                )}
              </div>
              <Badge variant='secondary'>Editor</Badge>
              {canShare && (
                <Button
                  type='button'
                  variant='ghost'
                  size='iconSm'
                  loading={remove.isPending && remove.variables === share.userId}
                  disabled={remove.isPending}
                  onClick={() => void removeShare(share)}
                  data-track-category='Claw Agents'
                  data-track-name='REMOVE_SUBAGENT_SHARE'
                  aria-label={`Remove ${share.name || share.email}`}
                >
                  <Trash2 className='size-4 text-destructive' />
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const TabButton = ({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}): ReactElement => (
  <button
    type='button'
    onClick={onClick}
    data-track-category='Claw Agents'
    data-track-name={`Subagent Detail Tab: ${label}`}
    className={cn(
      'w-full rounded-md px-2 py-1.5 text-left text-sm transition-colors',
      active
        ? 'bg-muted font-medium text-foreground'
        : 'text-muted-foreground hover:bg-muted hover:text-foreground',
    )}
  >
    {label}
  </button>
);

const ClawSubagentDetailScreen = (): ReactElement => {
  const { subagentName } = useParams<{ subagentName: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data: isAdmin = false, isLoading: adminLoading } = useIsClawAdmin();
  const { data: subagent, isLoading, error } = useClawSubagentDetail(subagentName);
  const { data: skills = [], isLoading: skillsLoading } = useClawSkills();
  const update = useUpdateClawSubagent(subagentName ?? '');
  const toggle = useToggleClawSubagent();
  const [searchParams, setSearchParams] = useSearchParams();
  const rawTab = searchParams.get('tab');
  const activeTab: DetailTab = TABS.some(tab => tab.id === rawTab)
    ? (rawTab as DetailTab)
    : 'persona';
  const setActiveTab = (id: DetailTab): void => {
    const next = new URLSearchParams(searchParams);
    next.set('tab', id);
    setSearchParams(next, { replace: true });
  };
  const [draft, setDraft] = useState<Draft | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  useEffect(() => {
    if (subagent) setDraft(draftFromSubagent(subagent));
    // Seed only when navigating to another subagent. Background refetches
    // (including contributor mutations) must not wipe unsaved form edits.
  }, [subagent?.name]); // eslint-disable-line react-hooks/exhaustive-deps

  const permissions = subagent ? getSubagentPermissions(subagent, user?.id, isAdmin) : null;
  const dirty = Boolean(subagent && draft && isDirty(subagent, draft));
  const setExistingDraft: React.Dispatch<React.SetStateAction<Draft>> = action => {
    setDraft(current => {
      if (!current) return current;
      return typeof action === 'function' ? action(current) : action;
    });
  };

  const save = async (): Promise<void> => {
    if (!subagent || !draft || !permissions?.canEdit || !dirty) return;
    try {
      const saved = await update.mutateAsync(toPayload(subagent, draft));
      setDraft(draftFromSubagent(saved));
      toast.success('Subagent saved');
    } catch (reason) {
      toast.error(clawErrorText(reason, 'Failed to save subagent'));
    }
  };

  const toggleEnabled = async (enabled: boolean): Promise<void> => {
    if (!subagent || !permissions?.canEdit) return;
    try {
      await toggle.mutateAsync({ name: subagent.name, enabled });
      toast.success(`${subagent.name} ${enabled ? 'enabled' : 'disabled'}`);
    } catch (reason) {
      toast.error(clawErrorText(reason, 'Failed to update subagent'));
    }
  };

  const removeSubagent = async (): Promise<void> => {
    if (!subagent || !permissions?.canDelete) return;
    try {
      await toggle.mutateAsync({ name: subagent.name, enabled: false });
      setDeleteOpen(false);
      toast.success(`${subagent.name} disabled`);
      void navigate('/claw-agents/subagents');
    } catch (reason) {
      toast.error(clawErrorText(reason, 'Failed to disable subagent'));
    }
  };

  if ((isLoading && !subagent) || adminLoading) {
    return (
      <div className='mx-auto w-full max-w-7xl px-6 pt-4 pb-16'>
        <div className='flex gap-8'>
          <div className='hidden w-44 shrink-0 flex-col gap-2 self-start pt-16 md:flex'>
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className='h-7 w-full' />
            ))}
          </div>
          <div className='flex min-w-0 flex-1 flex-col gap-6'>
            <Skeleton className='h-12 w-full' />
            <Skeleton className='h-96 w-full' />
          </div>
        </div>
      </div>
    );
  }

  if (error || !subagent || !draft || !permissions) {
    return (
      <div className='mx-auto flex w-full max-w-7xl flex-col items-center gap-3 px-6 py-24 text-center'>
        <p className='text-sm text-muted-foreground'>
          This subagent doesn’t exist or you can’t access it.
        </p>
        <Link
          to='/claw-agents/subagents'
          className='inline-flex items-center gap-1 text-sm font-medium text-foreground underline underline-offset-2'
        >
          <ChevronLeft className='size-4' />
          Back to subagents
        </Link>
      </div>
    );
  }

  const readOnlyNotice = !permissions.canEdit && !permissions.isBuiltIn;

  return (
    <div className='mx-auto w-full max-w-7xl px-6 pt-4 pb-16'>
      <div className='flex gap-8'>
        {/* Left: back button + tab triggers */}
        <div className='sticky top-0 hidden w-44 shrink-0 flex-col self-start md:flex'>
          <div className='flex items-center border-b border-transparent pt-4 pb-4'>
            <Link
              to='/claw-agents/subagents'
              className='inline-flex items-center gap-1 text-sm leading-7 text-muted-foreground transition-colors hover:text-foreground'
            >
              <ChevronLeft className='size-4' />
              Back
            </Link>
          </div>
          <nav className='flex flex-col gap-1 pt-6'>
            {TABS.map(tab => (
              <TabButton
                key={tab.id}
                label={
                  tab.id === 'contributors' && (subagent.shares?.length ?? 0) > 0
                    ? `${tab.label} (${subagent.shares?.length})`
                    : tab.label
                }
                active={activeTab === tab.id}
                onClick={() => setActiveTab(tab.id)}
              />
            ))}
          </nav>
        </div>

        {/* Right: header action bar + active tab content */}
        <div className='flex min-w-0 flex-1 flex-col'>
          <header className='flex flex-wrap items-start justify-between gap-3 border-b border-border pt-4 pb-4'>
            <div className='min-w-0'>
              <div className='flex flex-wrap items-center gap-2'>
                <h1 className='truncate font-mono text-lg font-semibold text-foreground'>
                  {subagent.name}
                </h1>
                <Badge variant={permissions.isBuiltIn ? 'outline' : 'secondary'}>
                  {permissions.isBuiltIn ? 'Built-in' : 'Custom'}
                </Badge>
                <Badge variant={subagent.enabled ? 'success' : 'outline'}>
                  {subagent.enabled ? 'Active' : 'Disabled'}
                </Badge>
              </div>
              <p className='mt-1 text-xs text-muted-foreground'>
                {subagent.createdByName || subagent.createdByEmail
                  ? `Created by ${subagent.createdByName || subagent.createdByEmail}`
                  : permissions.isBuiltIn
                    ? 'Maintained by the platform'
                    : 'Custom specialist'}
              </p>
            </div>
            {permissions.canEdit && (
              <div className='flex shrink-0 items-center gap-2'>
                <Button
                  variant='outline'
                  size='sm'
                  onClick={() => setDeleteOpen(true)}
                  data-track-category='Claw Agents'
                  data-track-name='OPEN_DELETE_SUBAGENT_CONFIRM'
                  disabled={toggle.isPending}
                >
                  <Trash2 className='size-4' /> Delete
                </Button>
                <div className='flex items-center gap-2 px-1'>
                  <Switch
                    checked={subagent.enabled}
                    onCheckedChange={enabled => void toggleEnabled(enabled)}
                    disabled={toggle.isPending}
                    aria-label='Toggle subagent enabled state'
                  />
                  <span className='hidden text-xs text-muted-foreground sm:inline'>
                    {subagent.enabled ? 'Enabled' : 'Disabled'}
                  </span>
                </div>
                <Button
                  size='sm'
                  onClick={() => void save()}
                  data-track-category='Claw Agents'
                  data-track-name='SAVE_SUBAGENT'
                  loading={update.isPending}
                  disabled={!dirty || !draft.systemPrompt.trim()}
                >
                  {!update.isPending && <Save className='size-4' />} Save changes
                </Button>
              </div>
            )}
          </header>

          {readOnlyNotice && (
            <p className='mt-6 rounded-lg border border-border bg-muted/30 p-3 text-sm text-muted-foreground'>
              You have read-only access to this subagent.
            </p>
          )}

          <div className='pt-6'>
            {activeTab === 'persona' ? (
              <PersonaTab draft={draft} setDraft={setExistingDraft} canEdit={permissions.canEdit} />
            ) : activeTab === 'knowledge' ? (
              <KnowledgeTab
                draft={draft}
                setDraft={setExistingDraft}
                canEdit={permissions.canEdit}
                skills={skills}
                skillsLoading={skillsLoading}
              />
            ) : activeTab === 'tools' ? (
              <ToolsTab draft={draft} setDraft={setExistingDraft} canEdit={permissions.canEdit} />
            ) : (
              <ContributorsTab subagent={subagent} canShare={permissions.canShare} />
            )}
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title='Delete subagent'
        description='Deleting disables this custom subagent and removes it from agent use. It remains recoverable from the Subagents list.'
        confirmLabel='Delete subagent'
        danger
        loading={toggle.isPending}
        onConfirm={() => void removeSubagent()}
      />
    </div>
  );
};

export default ClawSubagentDetailScreen;
