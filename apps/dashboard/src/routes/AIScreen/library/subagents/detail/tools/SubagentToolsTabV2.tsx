import { useMemo, useState, type ReactElement } from 'react';
import { Loader2 } from 'lucide-react';
import { useClawAvailableTools } from '@/hooks/useClawAvailableTools';
import type { SubagentDef } from '@/services/claw/clawSubagentsTypes';
import { DetailListCard, type DetailListItem } from '../../../shared/primitives/DetailListCard';
import {
  DetailLockedNote,
  DetailSection,
  ReadOnlyBadge,
} from '../../../shared/primitives/DetailPrimitives';
import { BrowseSubagentToolsDialog } from '../../create/toolbox/BrowseSubagentToolsDialog';
import {
  buildSubagentToolSections,
  isToolSelected,
  normalizeSelection,
  setToolsSelected,
  type SubagentSelection,
  type SubagentToolEntry,
  type SubagentToolKind,
  type SubagentToolSectionData,
} from '../../create/toolbox/subagentToolCatalog';
import { useOptimisticSave } from '../../../shared/hooks/useOptimisticSave';
import { useSaveSubagent } from '../knowledge/subagentUpdate';

const LOCK_NOTE =
  'Only the person who created this subagent, an editor, or an admin can change it.';
const BUILT_IN_NOTE =
  'This is a built-in subagent. It ships with the platform, so its tools can’t be changed.';

const withIcon = (kind: SubagentToolKind, source: string): { iconType?: string } =>
  kind === 'server' ? { iconType: source } : {};

function ManageButton({ label, onClick }: { label: string; onClick: () => void }): ReactElement {
  return (
    <button
      type='button'
      onClick={onClick}
      aria-label={label}
      data-track-category='Claw Agents'
      data-track-name='Subagent detail v2: manage tools'
      className='flex h-6 shrink-0 items-center rounded-md bg-muted px-1.5 text-sm leading-5 text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground'
    >
      Manage
    </button>
  );
}

export function SubagentToolsTabV2({
  subagent,
  canEdit,
  isBuiltIn,
}: {
  subagent: SubagentDef;
  canEdit: boolean;
  isBuiltIn: boolean;
}): ReactElement {
  const tools = useClawAvailableTools();
  const { save } = useSaveSubagent(subagent);

  const [manage, setManage] = useState<SubagentToolKind | null>(null);

  const direct = useMemo(() => subagent.tools?.direct ?? [], [subagent.tools?.direct]);
  const custom = useMemo(() => subagent.tools?.custom ?? [], [subagent.tools?.custom]);

  const committed = useMemo<SubagentSelection>(
    () => normalizeSelection({ subagents: [], direct, custom, gateway: [] }),
    [direct, custom],
  );
  const selection = useOptimisticSave<SubagentSelection>(committed);
  const saved = selection.value;
  const saving = selection.saving;

  const sections = useMemo(() => buildSubagentToolSections(tools.data ?? null), [tools.data]);

  const selectedIn = (section: SubagentToolSectionData): SubagentToolEntry[] =>
    section.groups.flatMap(group =>
      group.tools.filter(tool => isToolSelected(saved, section.kind, tool)),
    );

  const note = canEdit ? null : (
    <DetailLockedNote>{isBuiltIn ? BUILT_IN_NOTE : LOCK_NOTE}</DetailLockedNote>
  );

  const persist = (next: SubagentSelection, message: string): void => {
    selection.save(next, () =>
      save({ tools: { direct: next.direct, custom: next.custom } }, message),
    );
  };

  const activeSection = manage ? sections.find(entry => entry.kind === manage) : undefined;

  return (
    <div className='flex w-full flex-col gap-8'>
      {sections.map(section => {
        const picked = selectedIn(section);
        const items: DetailListItem[] = picked.map(tool => ({
          key: tool.key,
          name: tool.name,
          description: tool.source,
          ...withIcon(section.kind, tool.source),
        }));

        return (
          <DetailSection
            key={section.kind}
            label={section.title}
            info={section.caption}
            trailing={
              canEdit ? (
                <ManageButton
                  label={`Manage ${section.title}`}
                  onClick={() => setManage(section.kind)}
                />
              ) : (
                <ReadOnlyBadge />
              )
            }
            trailingAlign='end'
          >
            <DetailListCard
              items={items}
              loading={tools.isLoading}
              emptyLabel={`No ${section.title.toLowerCase()} added yet.`}
              canEdit={canEdit && !saving}
              note={note}
              removeLabel={item => `Remove ${item.name}`}
              onRemove={item => {
                const tool = picked.find(entry => entry.key === item.key);
                if (!tool) return;
                persist(
                  setToolsSelected(saved, section.kind, [tool], false),
                  `${item.name} removed`,
                );
              }}
            />
          </DetailSection>
        );
      })}

      {saving && (
        <span className='flex items-center gap-2 text-xs font-normal leading-4 text-muted-foreground'>
          <Loader2 className='size-3.5 animate-spin' aria-hidden />
          Saving…
        </span>
      )}

      {activeSection && (
        <BrowseSubagentToolsDialog
          open
          onOpenChange={open => {
            if (!open) setManage(null);
          }}
          section={activeSection}
          selection={saved}
          onSelectionChange={next => persist(next, 'Tools updated')}
          loading={tools.isLoading}
        />
      )}
    </div>
  );
}
