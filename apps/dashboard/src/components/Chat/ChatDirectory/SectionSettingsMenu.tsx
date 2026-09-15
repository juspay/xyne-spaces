import type { ComponentType, ReactElement } from 'react';
import {
  CheckTickSingle,
  ChevronRight,
  ChevronSortVertical,
  FilterFunnel,
  type PikaIconProps,
} from '@xyne/icons';
import { ChannelFilterMode, ChannelSortOrder } from '@xyne/shared';
import {
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '../../ui/dropdown-menu';

// Matches SidebarMoreMenu (AppSidebar.tsx) so every popover in the app reads the same.
export const MENU_ROW = 'gap-3 rounded-md px-2.5 py-2 text-sm';

const FILTER_OPTIONS: { label: string; hint?: string; value: ChannelFilterMode }[] = [
  {
    label: 'Active only',
    hint: 'New activity within the last 30 days',
    value: ChannelFilterMode.ACTIVE,
  },
  { label: 'Unreads', value: ChannelFilterMode.UNREADS },
  { label: 'Mentions', value: ChannelFilterMode.MENTIONS },
  { label: 'All', value: ChannelFilterMode.ALL },
];

const SORT_OPTIONS: { label: string; value: ChannelSortOrder | null }[] = [
  { label: 'Unread & Activity', value: ChannelSortOrder.UNREAD },
  { label: 'Recency', value: ChannelSortOrder.RECENCY },
  { label: 'Alphabetical A-Z', value: ChannelSortOrder.ALPHABETICAL },
  { label: 'Manual order', value: null },
];

const RowIcon = ({ icon }: { icon: ComponentType<PikaIconProps> }): ReactElement => {
  const Glyph = icon;
  return (
    <span className='flex size-5 shrink-0 items-center justify-center'>
      <Glyph size={16} />
    </span>
  );
};

interface SectionSettingsMenuProps {
  filterMode: ChannelFilterMode;
  sortOrder: ChannelSortOrder | null;
  onSetFilter: (mode: ChannelFilterMode) => void;
  onSetSort: (order: ChannelSortOrder | null) => void;
  /** Only custom sections have a drag order to fall back to. */
  showManualSort?: boolean;
  allowMentionsFilter?: boolean;
}

/**
 * The "Section settings" block (Filter + Sort) shared by every sidebar group —
 * Starred, Channels, Direct Messages, and each custom section.
 */
const SectionSettingsMenu = ({
  filterMode,
  sortOrder,
  onSetFilter,
  onSetSort,
  showManualSort = false,
  allowMentionsFilter = true,
}: SectionSettingsMenuProps): ReactElement => {
  const sortOptions = showManualSort ? SORT_OPTIONS : SORT_OPTIONS.filter(o => o.value !== null);
  const filterOptions = allowMentionsFilter
    ? FILTER_OPTIONS
    : FILTER_OPTIONS.filter(o => o.value !== ChannelFilterMode.MENTIONS);
  const currentFilterLabel = filterOptions.find(o => o.value === filterMode)?.label ?? 'All';
  const currentSortLabel =
    sortOptions.find(o => o.value === sortOrder)?.label ?? (showManualSort ? 'Manual order' : '');

  return (
    <>
      <p className='px-2.5 pt-1 pb-1.5 text-sm font-semibold text-popover-foreground'>
        Section settings
      </p>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger className={MENU_ROW}>
          <RowIcon icon={FilterFunnel} />
          <span className='flex-1'>Filter</span>
          <span className='truncate max-w-[120px] text-muted-foreground'>{currentFilterLabel}</span>
          <ChevronRight size={14} className='shrink-0 text-muted-foreground' />
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent sideOffset={6} className='min-w-[220px] p-1'>
          {filterOptions.map(opt => (
            <DropdownMenuItem
              key={opt.value}
              className={MENU_ROW}
              onClick={e => {
                e.stopPropagation();
                onSetFilter(opt.value);
              }}
              data-track-category='CHAT_SIDEBAR'
              data-track-name='SECTION_SET_FILTER'
            >
              <span className='flex-1'>
                <span className='block'>{opt.label}</span>
                {opt.hint && (
                  <span className='block text-xs text-muted-foreground'>{opt.hint}</span>
                )}
              </span>
              {filterMode === opt.value && <CheckTickSingle size={16} className='shrink-0' />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger className={MENU_ROW}>
          <RowIcon icon={ChevronSortVertical} />
          <span className='flex-1'>Sort</span>
          <span className='truncate max-w-[120px] text-muted-foreground'>{currentSortLabel}</span>
          <ChevronRight size={14} className='shrink-0 text-muted-foreground' />
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent sideOffset={6} className='min-w-[190px] p-1'>
          {sortOptions.map(opt => (
            <DropdownMenuItem
              key={opt.label}
              className={MENU_ROW}
              onClick={e => {
                e.stopPropagation();
                onSetSort(opt.value);
              }}
              data-track-category='CHAT_SIDEBAR'
              data-track-name='SECTION_SET_SORT'
            >
              <span className='flex-1'>{opt.label}</span>
              {sortOrder === opt.value && <CheckTickSingle size={16} className='shrink-0' />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    </>
  );
};

export default SectionSettingsMenu;
