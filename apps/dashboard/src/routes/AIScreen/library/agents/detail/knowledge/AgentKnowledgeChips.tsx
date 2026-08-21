import { useMemo, type ReactElement } from 'react';
import { FolderDefault, Staroflife } from '@xyne/icons';
import { Loader2 } from 'lucide-react';
import { useClawKnowledgeBaseTree } from '@/hooks/useClawKnowledgeBaseTree';
import { BrowseKnowledgeDialog } from '../../../shared/pickers/knowledge/BrowseKnowledgeDialog';
import {
  buildKbIndex,
  describeGrants,
  removeGrant,
} from '../../../shared/pickers/knowledge/knowledgeCatalog';
import { BrowseSkillsDialog } from '../../../shared/pickers/skill/BrowseSkillsDialog';
import { disableSkill, isSkillSelected } from '../../../shared/pickers/skill/skillCatalog';
import { useSkillCatalog } from '../../../shared/pickers/skill/useSkillCatalog';
import {
  CapabilityChip,
  CapabilityChipRow,
  CapabilityRow,
} from '../../../shared/primitives/CapabilityChips';
import type { DetailTypeScale } from '../../../shared/primitives/DetailPrimitives';
import { ChipIconTile } from '../../../shared/primitives/TokenChip';
import type { AgentKnowledge } from './useAgentKnowledge';

function skillChipLabel(label: string): string {
  return label.startsWith('/') ? label : `/${label}`;
}

function fileCountCopy(count: number): string {
  return `${count} ${count === 1 ? 'file' : 'files'}`;
}

export function AgentKnowledgeChips({
  canEdit,
  knowledge,
  trackName,
  showAdd = true,
  typeScale = 'library',
}: {
  canEdit: boolean;
  knowledge: AgentKnowledge;
  trackName: string;
  showAdd?: boolean;
  typeScale?: DetailTypeScale;
}): ReactElement {
  const skills = useSkillCatalog();
  const tree = useClawKnowledgeBaseTree();

  const selectedSkills = useMemo(
    () => skills.entries.filter(entry => isSkillSelected(knowledge.skillIds, entry)),
    [skills.entries, knowledge.skillIds],
  );

  const knowledgeChips = useMemo(() => {
    if (knowledge.scope === 'USER') return [];
    const index = buildKbIndex(tree.data?.collections ?? []);
    return describeGrants(knowledge.grants, index).map(grant => {
      const collection = index.get(grant.selection.collectionId);
      const count = grant.selection.fileId ? 1 : (collection?.files.size ?? 0);
      return { ...grant, fileCount: count };
    });
  }, [tree.data?.collections, knowledge.grants, knowledge.scope]);

  return (
    <>
      <CapabilityRow
        label='Skills'
        info='Add reusable instructions for specialized workflows.'
        addLabel='Add skills'
        canEdit={canEdit}
        showAdd={showAdd}
        onAdd={(): void => knowledge.openBrowse('skills')}
        addTrackName={`${trackName}: add skills`}
      >
        {selectedSkills.length > 0 && (
          <CapabilityChipRow gap='tight'>
            {selectedSkills.map(entry => {
              const label = skillChipLabel(entry.label);
              return (
                <CapabilityChip
                  key={entry.id}
                  typeScale={typeScale}
                  radius='12'
                  icon={
                    <ChipIconTile>
                      <Staroflife className='size-4' variant='Solid' />
                    </ChipIconTile>
                  }
                  label={label}
                  removeTrackName={`${trackName}: remove chip`}
                  onRemove={
                    canEdit
                      ? (): void =>
                          knowledge.saveSkills(
                            disableSkill(knowledge.skillIds, entry),
                            `${label} removed`,
                          )
                      : undefined
                  }
                />
              );
            })}
          </CapabilityChipRow>
        )}
      </CapabilityRow>

      <CapabilityRow
        label='Knowledge'
        info='Give your agent trusted information to reference.'
        addLabel='Add knowledge'
        canEdit={canEdit}
        showAdd={showAdd}
        onAdd={(): void => knowledge.openBrowse('documents')}
        addTrackName={`${trackName}: add knowledge`}
      >
        {knowledgeChips.length > 0 && (
          <CapabilityChipRow gap='tight'>
            {knowledgeChips.map(grant => (
              <CapabilityChip
                key={grant.key}
                typeScale={typeScale}
                icon={
                  <ChipIconTile>
                    <FolderDefault className='size-4' variant='Solid' />
                  </ChipIconTile>
                }
                label={grant.label}
                secondary={fileCountCopy(grant.fileCount)}
                removeTrackName={`${trackName}: remove chip`}
                onRemove={
                  canEdit
                    ? (): void =>
                        knowledge.saveKb(
                          knowledge.scope,
                          removeGrant(knowledge.grants, grant.selection),
                          `${grant.label} removed`,
                        )
                    : undefined
                }
              />
            ))}
          </CapabilityChipRow>
        )}
      </CapabilityRow>

      {knowledge.saving && (
        <span className='flex items-center gap-2 text-xs font-normal leading-4 text-muted-foreground'>
          <Loader2 className='size-3.5 animate-spin' aria-hidden />
          Saving…
        </span>
      )}

      {showAdd && (
        <>
          <BrowseSkillsDialog
            open={knowledge.browse === 'skills'}
            onOpenChange={(open): void => {
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
            onOpenChange={(open): void => {
              if (!open) knowledge.closeBrowse();
            }}
            scope={knowledge.draftScope}
            onScopeChange={knowledge.setDraftScope}
            grants={knowledge.draftGrants}
            onGrantsChange={knowledge.setDraftGrants}
          />
        </>
      )}
    </>
  );
}
