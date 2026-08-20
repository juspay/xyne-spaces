import { useMemo, useState, type ReactElement } from 'react';
import { Loader2 } from 'lucide-react';
import { useClawAvailableTools } from '@/hooks/useClawAvailableTools';
import type { SubagentDef } from '@/services/claw/clawSubagentsTypes';
import { DetailListCard, type DetailListItem } from '../../../shared/primitives/DetailListCard';
import {
  DetailLockedNote,
  DetailSection,
  DetailStack,
  ManageButton,
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
import { useSaveSubagent } from '../knowledge/subagentUpdate';

const LOCK_NOTE =
  'Only the person who created this subagent, an editor, or an admin can change it.';
const BUILT_IN_NOTE =
  'This is a built-in subagent. It ships with the platform, so its tools can’t be changed.';

const withIcon = (kind: SubagentToolKind, source: string): { iconType?: string } =>
  kind === 'server' ? { iconType: source } : {};

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
  const { save, saving } = useSaveSubagent(subagent);

  const [manage, setManage] = useState<SubagentToolKind | null>(null);
  const [draft, setDraft] = useState<SubagentSelection | null>(null);

  const direct = useMemo(() => subagent.tools?.direct ?? [], [subagent.tools?.direct]);
  const custom = useMemo(() => subagent.tools?.custom ?? [], [subagent.tools?.custom]);

  const saved = useMemo<SubagentSelection>(
    () => normalizeSelection({ subagents: [], direct, custom, gateway: [] }),
    [direct, custom],
  );

  const sections = useMemo(() => buildSubagentToolSections(tools.data ?? null), [tools.data]);

  const selectedIn = (section: SubagentToolSectionData): SubagentToolEntry[] =>
    section.groups.flatMap(group =>
      group.tools.filter(tool => isToolSelected(saved, section.kind, tool)),
    );

  const note = canEdit ? null : (
    <DetailLockedNote>{isBuiltIn ? BUILT_IN_NOTE : LOCK_NOTE}</DetailLockedNote>
  );

  const persist = (next: SubagentSelection, message: string): void => {
    void save({ tools: { direct: next.direct, custom: next.custom } }, message);
  };

  const closeManage = (): void => {
    const next = draft;
    setManage(null);
    setDraft(null);
    if (!next) return;
    const same = (a: readonly string[], b: readonly string[]): boolean =>
      a.length === b.length && a.every(value => b.includes(value));
    if (same(next.direct, direct) && same(next.custom, custom)) return;
    persist(next, 'Tools updated');
  };

  const activeSection = manage ? sections.find(entry => entry.kind === manage) : undefined;

  return (
    <DetailSection heading='section' label='Tools'>
      <DetailStack>
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
                    trackName='Subagent detail v2: manage tools'
                    onClick={() => {
                      setDraft(saved);
                      setManage(section.kind);
                    }}
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
              if (!open) closeManage();
            }}
            section={activeSection}
            selection={draft ?? saved}
            onSelectionChange={setDraft}
            loading={tools.isLoading}
          />
        )}
      </DetailStack>
    </DetailSection>
  );
}
