import { useMemo, useState, type ReactElement } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { PlusDefault } from '@xyne/icons';
import { useClawKnowledgeBaseTree } from '@/hooks/useClawKnowledgeBaseTree';
import { clawErrorText } from '@/services/claw/clawRequest';
import type { Agent } from '@/services/claw/clawAuthAgentTypes';
import { Pill } from '../../create-v2/shared/Pill';
import { BrowseKnowledgeDialog } from '../../create-v2/knowledge/BrowseKnowledgeDialog';
import {
  buildKbIndex,
  describeGrants,
  removeGrant,
} from '../../create-v2/knowledge/knowledgeCatalog';
import { BrowseSkillsDialog } from '../../create-v2/skill/BrowseSkillsDialog';
import { disableSkill, isSkillSelected } from '../../create-v2/skill/skillCatalog';
import { useSkillCatalog } from '../../create-v2/skill/useSkillCatalog';
import { DetailListCard, type DetailListItem } from '../DetailListCard';
import {
  DetailLockedNote,
  DetailRow,
  DetailSection,
  DetailValue,
  ReadOnlyBadge,
} from '../DetailPrimitives';
import { BehaviourSelect } from '../behaviour/BehaviourRows';
import {
  agentMemoryKey,
  deleteAgentMemory,
  isDigitalTwin,
  useAgentMemories,
  useAgentMemoryStatus,
} from './agentMemoryService';
import { MemoryManageDialog } from './MemoryManageDialog';
import { useAgentKnowledge } from './useAgentKnowledge';

const LOCK_NOTE = 'Only the owner, a contributor, or an admin can change what this agent knows.';

const SOURCE_LABELS: Record<string, string> = {
  seeded: 'Built-in',
  'user-created': 'Custom',
  uploaded: 'Uploaded',
};

const SCOPE_OPTIONS = [
  { value: 'COLLECTIONS', label: 'Same set for everyone' },
  { value: 'USER', label: "Each person's own access" },
];

const DATE = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

function formatAdded(value: string | null): string {
  if (!value) return 'Added recently';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 'Added recently' : `Added ${DATE.format(parsed)}`;
}

function ManageButton({ label, onClick }: { label: string; onClick: () => void }): ReactElement {
  return (
    <button
      type='button'
      onClick={onClick}
      aria-label={label}
      data-track-category='Claw Agents'
      data-track-name='Agent detail v2: manage knowledge'
      className='flex h-6 shrink-0 items-center rounded-md bg-muted px-1.5 text-sm leading-5 text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground'
    >
      Manage
    </button>
  );
}

export function AgentKnowledgeTabV2({
  agent,
  canEdit,
}: {
  agent: Agent;
  canEdit: boolean;
}): ReactElement {
  const queryClient = useQueryClient();
  const knowledge = useAgentKnowledge(agent);
  const skills = useSkillCatalog();
  const tree = useClawKnowledgeBaseTree();

  const [memoryOpen, setMemoryOpen] = useState(false);
  const [removingMemory, setRemovingMemory] = useState(false);

  const memories = useAgentMemories(agent.slug);
  const memoryStatus = useAgentMemoryStatus(agent.slug);

  const skillItems = useMemo<DetailListItem[]>(
    () =>
      skills.entries
        .filter(entry => isSkillSelected(knowledge.skillIds, entry))
        .map(entry => ({
          key: entry.id,
          name: `/${entry.slug}`,
          description: entry.description,
          badge: <Pill tone='neutral'>{SOURCE_LABELS[entry.source] ?? entry.scope}</Pill>,
        })),
    [skills.entries, knowledge.skillIds],
  );

  const grantItems = useMemo<DetailListItem[]>(() => {
    if (knowledge.scope === 'USER') return [];
    const index = buildKbIndex(tree.data?.collections ?? []);
    return describeGrants(knowledge.grants, index).map(grant => ({
      key: grant.key,
      name: grant.label,
      description: grant.detail ?? '',
    }));
  }, [tree.data?.collections, knowledge.grants, knowledge.scope]);

  const memoryItems = useMemo<DetailListItem[]>(
    () =>
      (memories.data ?? []).map(memory => ({
        key: memory.id,
        name: memory.content,
        description: formatAdded(memory.createdAt),
        ...(memory.category ? { badge: <Pill tone='neutral'>{memory.category}</Pill> } : {}),
        ...(memory.recallHits7d > 0
          ? { meta: `${memory.recallHits7d} recall${memory.recallHits7d === 1 ? '' : 's'}` }
          : {}),
      })),
    [memories.data],
  );

  const note = canEdit ? null : <DetailLockedNote>{LOCK_NOTE}</DetailLockedNote>;

  const trailingFor = (label: string, onClick: () => void): ReactElement =>
    canEdit ? <ManageButton label={label} onClick={onClick} /> : <ReadOnlyBadge />;

  const removeMemory = async (id: string): Promise<void> => {
    if (removingMemory) return;
    setRemovingMemory(true);
    try {
      await deleteAgentMemory(agent.slug, id);
      void queryClient.invalidateQueries({ queryKey: agentMemoryKey(agent.slug) });
      toast.success('Memory removed');
    } catch (err) {
      toast.error(clawErrorText(err, 'Could not remove that memory'));
    } finally {
      setRemovingMemory(false);
    }
  };

  return (
    <div className='flex w-full flex-col gap-8'>
      <DetailSection
        label='Skills'
        info='Reusable instruction packs this agent can run as a slash command'
        trailing={trailingFor('Manage skills', () => knowledge.openBrowse('skills'))}
        trailingAlign='end'
      >
        <DetailListCard
          items={skillItems}
          loading={skills.loading}
          emptyLabel='No skills attached yet.'
          canEdit={canEdit}
          note={note}
          removeLabel={item => `Remove ${item.name}`}
          onRemove={item => {
            const entry = skills.entries.find(candidate => candidate.id === item.key);
            if (!entry) return;
            knowledge.saveSkills(disableSkill(knowledge.skillIds, entry), `${item.name} removed`);
          }}
        />
      </DetailSection>

      <DetailSection
        label='Documents'
        info='Collections and files this agent can look things up in'
        {...(canEdit ? {} : { trailing: <ReadOnlyBadge />, trailingAlign: 'end' as const })}
      >
        <DetailListCard
          items={grantItems}
          loading={tree.isLoading && knowledge.scope === 'COLLECTIONS'}
          emptyLabel={
            knowledge.scope === 'USER'
              ? 'This agent reads whatever the person running it can already see.'
              : 'No collections attached yet.'
          }
          canEdit={canEdit}
          note={note}
          removeLabel={item => `Remove ${item.name}`}
          onRemove={item => {
            const index = buildKbIndex(tree.data?.collections ?? []);
            const target = describeGrants(knowledge.grants, index).find(
              grant => grant.key === item.key,
            );
            if (!target) return;
            knowledge.saveKb(
              knowledge.scope,
              removeGrant(knowledge.grants, target.selection),
              `${item.name} removed`,
            );
          }}
        >
          <DetailRow title='Applies To' hint='Whose access decides what this agent can read'>
            <BehaviourSelect
              value={knowledge.scope}
              options={SCOPE_OPTIONS}
              editable={canEdit}
              disabled={knowledge.saving}
              label='Who this applies to'
              trackName='Agent detail v2: set kb scope'
              onChange={next =>
                knowledge.saveKb(
                  next === 'USER' ? 'USER' : 'COLLECTIONS',
                  knowledge.grants,
                  'Document access updated',
                )
              }
            />
          </DetailRow>

          <DetailRow title='Collections' hint='What it can look things up in'>
            {knowledge.scope === 'USER' ? (
              <DetailValue>Not used</DetailValue>
            ) : canEdit ? (
              <button
                type='button'
                onClick={() => knowledge.openBrowse('documents')}
                data-track-category='Claw Agents'
                data-track-name='Agent detail v2: add collections'
                className='flex h-9 shrink-0 items-center gap-2 rounded-[10px] border border-border bg-card px-3 text-sm leading-5 text-foreground transition-colors hover:bg-muted/50'
              >
                <PlusDefault className='size-4 shrink-0 text-muted-foreground' aria-hidden />
                Add
              </button>
            ) : (
              <DetailValue>{knowledge.grants.length} attached</DetailValue>
            )}
          </DetailRow>
        </DetailListCard>
      </DetailSection>

      {!isDigitalTwin(agent.slug) && (
        <DetailSection
          label='Memory'
          info='Facts this agent carries between sessions'
          trailing={trailingFor('Manage memory', () => setMemoryOpen(true))}
          trailingAlign='end'
        >
          <DetailListCard
            items={memoryItems}
            loading={memories.isLoading}
            emptyLabel={
              memoryStatus.data?.memoryEnabled === false
                ? 'Memory is off for this agent.'
                : 'Nothing remembered yet.'
            }
            canEdit={canEdit && !removingMemory}
            note={note}
            removeLabel={() => 'Forget this memory'}
            onRemove={item => void removeMemory(item.key)}
          />
        </DetailSection>
      )}

      {knowledge.saving && (
        <span className='flex items-center gap-2 text-xs font-normal leading-4 text-muted-foreground'>
          <Loader2 className='size-3.5 animate-spin' aria-hidden />
          Saving…
        </span>
      )}

      <BrowseSkillsDialog
        open={knowledge.browse === 'skills'}
        onOpenChange={open => {
          if (!open) knowledge.closeBrowse();
        }}
        catalog={skills.entries}
        loading={skills.loading}
        isError={skills.isError}
        onRetry={skills.refetch}
        selectedIds={knowledge.draftSkillIds}
        onChange={knowledge.setDraftSkillIds}
      />

      <BrowseKnowledgeDialog
        open={knowledge.browse === 'documents'}
        onOpenChange={open => {
          if (!open) knowledge.closeBrowse();
        }}
        scope={knowledge.draftScope}
        onScopeChange={knowledge.setDraftScope}
        grants={knowledge.draftGrants}
        onGrantsChange={knowledge.setDraftGrants}
      />

      <MemoryManageDialog
        open={memoryOpen}
        onOpenChange={setMemoryOpen}
        slug={agent.slug}
        status={memoryStatus.data}
        memoryCount={memoryItems.length}
        canEdit={canEdit}
      />
    </div>
  );
}
