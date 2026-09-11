import { ReactElement, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Loader2, Search } from 'lucide-react';
import { cn } from '@/utils/classNames';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { SegmentedToggle } from '@/components/ui/SegmentedToggle';
import { Skeleton } from '@/components/ui/Skeleton';
import { KnowledgeBasePicker } from '@/components/ClawAgents/KnowledgeBasePicker/KnowledgeBasePicker';
import { useAuth } from '@/hooks/useAuth';
import { useClawKnowledgeBaseTree } from '@/hooks/useClawKnowledgeBaseTree';
import { useClawSkills } from '@/hooks/useClawSkills';
import { clawAgentDetailKey } from '@/hooks/useClawAgentDetail';
import { updateClawAgent } from '@/services/claw/clawAuthAgentsService';
import type { Agent } from '@/services/claw/clawAuthAgentTypes';
import type { AgentPermissions } from '@/services/claw/agentPermissions';
import type { KbCollectionNode, KbFile, KbSelection } from '@/services/claw/clawKnowledgeBaseTypes';
import type { Skill } from '@/services/claw/clawSkillsTypes';
import { DetailSection, EmptyPanel } from './detailTabUtils';

interface KnowledgeTabProps {
  agent: Agent;
  permissions: AgentPermissions;
}

const walkCollections = (
  nodes: KbCollectionNode[],
  onNode: (node: KbCollectionNode) => void,
  onFile: (file: KbFile, parent: KbCollectionNode) => void,
): void => {
  for (const node of nodes) {
    onNode(node);
    for (const file of node.items ?? []) onFile(file, node);
    walkCollections(node.children ?? [], onNode, onFile);
  }
};

const kbKey = (collectionId: string, fileId: string | null): string =>
  `${collectionId}::${fileId ?? ''}`;

const KB_SCOPES = [
  {
    value: 'COLLECTIONS' as const,
    label: 'Selected collections & files',
    hint: 'Pick an explicit allowlist. Same scope for everyone who runs the agent.',
  },
  {
    value: 'USER' as const,
    label: 'Match user access',
    hint: "Inherits the running user's spaces access — per session.",
  },
];

/**
 * Knowledge tab — skills + Knowledge Base grants. Editable by anyone with
 * `canEdit` (owner/editor/contributor, same gate as Persona), matching the
 * reference frontend's Knowledge sub-tab. Owns its Save button, separate from
 * the header's Persona/Behaviour save — same convention as ModelProviderTab.
 */
const KnowledgeTab = ({ agent, permissions }: KnowledgeTabProps): ReactElement => {
  const canEdit = permissions.canEdit;
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const userId = user?.id;

  const { data: kbTree, isLoading: kbTreeLoading } = useClawKnowledgeBaseTree({
    enabled: canEdit || (agent.collections?.length ?? 0) > 0,
  });
  const { data: skillsCatalog, isLoading: skillsLoading } = useClawSkills();

  const { collectionNames, fileNames } = useMemo(() => {
    const collections = new Map<string, string>();
    const files = new Map<string, { name: string; parentName: string }>();
    walkCollections(
      kbTree?.collections ?? [],
      node => collections.set(node.id, node.name),
      (file, parent) => files.set(file.id, { name: file.name, parentName: parent.name }),
    );
    return { collectionNames: collections, fileNames: files };
  }, [kbTree?.collections]);

  const [draftSkillIds, setDraftSkillIds] = useState<string[]>([]);
  const [draftKbScope, setDraftKbScope] = useState<'COLLECTIONS' | 'USER'>('COLLECTIONS');
  const [draftKbResources, setDraftKbResources] = useState<KbSelection[]>([]);
  const [saving, setSaving] = useState(false);
  const [skillSearch, setSkillSearch] = useState('');
  const [skillFilter, setSkillFilter] = useState<'all' | 'global' | 'mine'>('all');

  // Seed on mount / when the agent identity changes.
  useEffect(() => {
    setDraftSkillIds((agent.skills ?? []).map(s => s.skillId));
    setDraftKbScope(agent.kbScope === 'USER' ? 'USER' : 'COLLECTIONS');
    setDraftKbResources(
      (agent.collections ?? []).map(c => ({ collectionId: c.collectionId, fileId: c.fileId })),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent.id]);

  const dirty = useMemo(() => {
    const baseSkillIds = (agent.skills ?? []).map(s => s.skillId);
    const skillsChanged =
      baseSkillIds.length !== draftSkillIds.length ||
      !baseSkillIds.every(id => draftSkillIds.includes(id));
    const baseKb = (agent.collections ?? []).map(c => kbKey(c.collectionId, c.fileId)).sort();
    const draftKb = draftKbResources.map(r => kbKey(r.collectionId, r.fileId)).sort();
    const kbChanged = baseKb.length !== draftKb.length || baseKb.some((k, i) => k !== draftKb[i]);
    const scopeChanged = draftKbScope !== (agent.kbScope === 'USER' ? 'USER' : 'COLLECTIONS');
    return skillsChanged || kbChanged || scopeChanged;
  }, [agent, draftSkillIds, draftKbResources, draftKbScope]);

  const toggleSkill = (id: string): void =>
    setDraftSkillIds(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));

  const handleSave = async (): Promise<void> => {
    if (!canEdit || !dirty || saving) return;
    setSaving(true);
    try {
      const updated = await updateClawAgent(agent.slug, {
        skills: draftSkillIds,
        // The server clears stored grants either way when scope is USER, so we
        // skip sending `knowledgeBase` to keep the payload honest.
        ...(draftKbScope === 'COLLECTIONS' ? { knowledgeBase: draftKbResources } : {}),
        kbScope: draftKbScope,
      });
      queryClient.setQueryData(clawAgentDetailKey(agent.slug), updated);
      void queryClient.invalidateQueries({ queryKey: ['claw-auth-agents'] });
      setDraftSkillIds((updated.skills ?? []).map(s => s.skillId));
      setDraftKbScope(updated.kbScope === 'USER' ? 'USER' : 'COLLECTIONS');
      setDraftKbResources(
        (updated.collections ?? []).map(c => ({ collectionId: c.collectionId, fileId: c.fileId })),
      );
      toast.success('Knowledge saved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  if (!canEdit) {
    const skills = agent.skills ?? [];
    const grants = agent.collections ?? [];
    const isUserScoped = agent.kbScope === 'USER';

    if (skills.length === 0 && grants.length === 0 && !isUserScoped) {
      return (
        <div className='max-w-2xl'>
          <EmptyPanel
            title='No knowledge attached'
            description='This agent has no skills or Knowledge Base grants attached.'
          />
        </div>
      );
    }

    return (
      <div className='flex max-w-2xl flex-col gap-6'>
        <DetailSection title='Skills' description='Reference material attached to the agent.'>
          {skills.length === 0 ? (
            <EmptyPanel
              title='No skills attached'
              description='Skills can be added by an editor or the agent owner.'
            />
          ) : (
            <div className='divide-y divide-border overflow-hidden rounded-lg border border-border'>
              {skills.map(agentSkill => (
                <div key={agentSkill.id} className='px-3 py-3'>
                  <div className='flex items-start justify-between gap-3'>
                    <div className='min-w-0'>
                      <p className='truncate text-sm font-medium text-foreground'>
                        {agentSkill.skill.name}
                      </p>
                      {agentSkill.skill.description && (
                        <p className='mt-0.5 line-clamp-2 text-xs text-muted-foreground'>
                          {agentSkill.skill.description}
                        </p>
                      )}
                    </div>
                    <Badge variant='outline'>@{agentSkill.skill.slug}</Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </DetailSection>

        <DetailSection
          title='Knowledge Base'
          description='Spaces documents this agent can read during a run.'
        >
          <div className='rounded-lg border border-border p-4'>
            <div className='mb-4 flex items-center justify-between gap-3'>
              <span className='text-sm font-medium text-foreground'>Scope</span>
              <Badge variant={isUserScoped ? 'secondary' : 'outline'}>
                {isUserScoped ? 'Match user access' : 'Selected resources'}
              </Badge>
            </div>

            {isUserScoped ? (
              <p className='text-sm text-muted-foreground'>
                The agent inherits Spaces Knowledge Base access from the running user.
              </p>
            ) : kbTreeLoading ? (
              <div className='flex flex-col gap-2'>
                <Skeleton className='h-4 w-full' />
                <Skeleton className='h-4 w-2/3' />
              </div>
            ) : grants.length === 0 ? (
              <p className='text-sm text-muted-foreground'>No Knowledge Base resources selected.</p>
            ) : (
              <div className='flex flex-col gap-2'>
                {grants.map(grant => {
                  const file = grant.fileId ? fileNames.get(grant.fileId) : undefined;
                  const collectionName =
                    collectionNames.get(grant.collectionId) ?? grant.collectionId;
                  return (
                    <div
                      key={grant.id}
                      className='flex items-center justify-between gap-3 rounded-md bg-muted/50 px-3 py-2'
                    >
                      <span className='min-w-0 truncate text-sm text-foreground'>
                        {file ? file.name : collectionName}
                      </span>
                      <Badge variant='outline'>
                        {file ? `File in ${file.parentName}` : 'Collection'}
                      </Badge>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </DetailSection>
      </div>
    );
  }

  const allSkills = skillsCatalog ?? [];
  const globalCount = allSkills.filter(s => s.scope === 'global').length;
  const mineCount = allSkills.filter(s => s.ownerUserId === userId).length;

  // Plain filtering (no hook) — this branch already sits after the `!canEdit`
  // early return, so a hook here would violate the rules of hooks.
  const skillQuery = skillSearch.trim().toLowerCase();
  const filteredSkills = allSkills.filter(s => {
    if (skillFilter === 'global' && s.scope !== 'global') return false;
    if (skillFilter === 'mine' && s.ownerUserId !== userId) return false;
    if (!skillQuery) return true;
    return (
      s.name.toLowerCase().includes(skillQuery) ||
      s.slug.toLowerCase().includes(skillQuery) ||
      (s.label ?? '').toLowerCase().includes(skillQuery) ||
      (s.description ?? '').toLowerCase().includes(skillQuery)
    );
  });
  const filteredGlobalSkills = filteredSkills.filter(s => s.scope === 'global');
  const filteredMySkills = filteredSkills.filter(s => s.ownerUserId === userId);

  const skillChip = (skill: Skill): ReactElement => (
    <button
      key={skill.id}
      type='button'
      onClick={() => toggleSkill(skill.id)}
      title={skill.description || skill.slug}
      data-track-category='Claw Agents'
      data-track-name='Knowledge Tab: Toggle Skill'
      className={cn(
        'rounded-full border px-2.5 py-1 text-xs transition-colors',
        draftSkillIds.includes(skill.id)
          ? 'border-primary bg-primary/10 text-foreground'
          : 'border-border bg-card text-muted-foreground hover:border-muted-foreground/40 hover:text-foreground',
      )}
    >
      {skill.label || skill.name}
    </button>
  );

  return (
    <div className='flex max-w-2xl flex-col gap-8'>
      <DetailSection
        title='Skills'
        description='Reference material this agent can draw on during a run.'
      >
        {skillsLoading ? (
          <div className='flex items-center gap-2 text-sm text-muted-foreground'>
            <Loader2 className='size-3.5 animate-spin' /> Loading…
          </div>
        ) : allSkills.length === 0 ? (
          <EmptyPanel
            title='No skills yet'
            description='Create skills from the Skills page to attach reference material to agents.'
          />
        ) : (
          <div className='flex flex-col gap-3'>
            <div className='flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between'>
              <div className='relative w-full sm:max-w-xs'>
                <Search className='pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground' />
                <Input
                  value={skillSearch}
                  onChange={e => setSkillSearch(e.target.value)}
                  placeholder='Search skills…'
                  className='pl-8'
                />
              </div>
              <SegmentedToggle
                options={[
                  { value: 'all', label: `All (${allSkills.length})` },
                  { value: 'global', label: `Global (${globalCount})` },
                  { value: 'mine', label: `Mine (${mineCount})` },
                ]}
                value={skillFilter}
                onChange={setSkillFilter}
              />
            </div>

            {filteredSkills.length === 0 ? (
              <EmptyPanel
                title='No matching skills'
                description='Try a different search term or filter.'
              />
            ) : skillFilter === 'all' ? (
              <div className='flex flex-col gap-4'>
                {filteredGlobalSkills.length > 0 && (
                  <div>
                    <p className='mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground'>
                      Global skills
                    </p>
                    <div className='flex flex-wrap gap-1.5'>
                      {filteredGlobalSkills.map(skillChip)}
                    </div>
                  </div>
                )}
                {filteredMySkills.length > 0 && (
                  <div>
                    <p className='mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground'>
                      My skills
                    </p>
                    <div className='flex flex-wrap gap-1.5'>{filteredMySkills.map(skillChip)}</div>
                  </div>
                )}
              </div>
            ) : (
              <div className='flex flex-wrap gap-1.5'>{filteredSkills.map(skillChip)}</div>
            )}

            <p className='text-xs text-muted-foreground'>
              {draftSkillIds.length === 0
                ? 'No skills attached.'
                : `${draftSkillIds.length} skill${draftSkillIds.length === 1 ? '' : 's'} attached`}
            </p>
          </div>
        )}
      </DetailSection>

      <DetailSection
        title='Knowledge Base'
        description='Spaces documents this agent can read during a run.'
      >
        <div className='flex flex-col gap-3'>
          <fieldset className='grid grid-cols-1 gap-2 sm:grid-cols-2'>
            {KB_SCOPES.map(opt => {
              const selected = draftKbScope === opt.value;
              return (
                <label
                  key={opt.value}
                  className={cn(
                    'flex cursor-pointer flex-col gap-1 rounded-lg border px-3 py-2 transition-colors',
                    selected ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/40',
                  )}
                >
                  <span className='flex items-center gap-2'>
                    <input
                      type='radio'
                      name='kb-scope'
                      value={opt.value}
                      checked={selected}
                      onChange={() => setDraftKbScope(opt.value)}
                      data-track-category='Claw Agents'
                      data-track-name='Knowledge Tab: Set KB Scope'
                      className='size-3.5'
                    />
                    <span className='text-sm font-medium text-foreground'>{opt.label}</span>
                  </span>
                  <span className='pl-[22px] text-xs leading-snug text-muted-foreground'>
                    {opt.hint}
                  </span>
                </label>
              );
            })}
          </fieldset>

          {draftKbScope === 'USER' ? (
            <p className='rounded-lg border border-border bg-muted/40 px-3 py-3 text-sm text-muted-foreground'>
              This agent is scoped at the user level — its Knowledge Base reach is whatever the
              running user can already see in spaces.
            </p>
          ) : (
            <>
              <KnowledgeBasePicker value={draftKbResources} onChange={setDraftKbResources} />
              <p className='text-xs text-muted-foreground'>
                {draftKbResources.length === 0
                  ? 'No KB resources attached — the agent won’t be able to read documents.'
                  : `${draftKbResources.length} grant${draftKbResources.length === 1 ? '' : 's'} attached`}
              </p>
            </>
          )}
        </div>
      </DetailSection>

      <div className='flex items-center gap-3 border-t border-border pt-4'>
        <Button
          type='button'
          size='sm'
          loading={saving}
          disabled={!dirty}
          onClick={() => void handleSave()}
          data-track-category='Claw Agents'
          data-track-name='SAVE_KNOWLEDGE'
        >
          {saving ? 'Saving…' : 'Save changes'}
        </Button>
        {dirty && !saving && <span className='text-xs text-muted-foreground'>Unsaved changes</span>}
      </div>
    </div>
  );
};

export default KnowledgeTab;
