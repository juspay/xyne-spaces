import type { ReactElement } from 'react';
import {
  AlarmDefault,
  CalendarDefault,
  CalendarTimer,
  FolderDefault,
  GitCompare,
  ListCheckBox,
  Number123,
  PlusDefault,
  Staroflife,
  Subtask,
  Tag,
  Text,
} from '@xyne/icons';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/utils/classNames';
import './draft-chat.css';
import type { AgentCreateHubRow } from './types';
import { useExclusiveMenu } from './useExclusiveMenu';
import {
  CUSTOM_PROPERTY_LABEL,
  CUSTOM_PROPERTY_TYPES,
  type CustomPropertyType,
} from './customProperty';

const TYPE_ICON: Record<CustomPropertyType, typeof Text> = {
  text: Text,
  number: Number123,
  checkbox: ListCheckBox,
  tags: Tag,
  date: CalendarDefault,
  datetime: CalendarTimer,
};

const HUB_ITEMS: Array<{ row: AgentCreateHubRow; label: string; icon: typeof Staroflife }> = [
  { row: 'skills', label: 'Skill', icon: Staroflife },
  { row: 'subagent', label: 'Subagent', icon: Subtask },
  { row: 'mcp', label: 'MCP', icon: GitCompare },
  { row: 'knowledge', label: 'Knowledge', icon: FolderDefault },
];

/*
 * The canvas's menus (this one, each row's "…" menu, Change type) look like the
 * test chat's + menu: the same panel, rows, hairlines and type (dc-menu in
 * draft-chat.css). An item with an icon wraps icon and label in
 * PROPERTY_MENU_LABEL, since a row spreads its children apart.
 */
export const PROPERTY_MENU_PANEL = 'dc-menu-content dc-menu-compact';
export const PROPERTY_MENU_ITEM = 'dc-menu-item';
export const PROPERTY_MENU_LABEL = 'dc-menu-item-label';
export const PROPERTY_MENU_SEPARATOR = 'dc-menu-separator';

/** 200×230 card; past that the list scrolls. */
const ADD_PROPERTY_MENU_PANEL = cn(
  PROPERTY_MENU_PANEL,
  'box-border flex h-[230px] flex-col items-stretch gap-0',
);

/** Fills the padded card. Overflow scrolls without an extra layout gap. */
const ADD_PROPERTY_MENU_LIST =
  'flex min-h-0 w-full flex-1 flex-col gap-0 overflow-y-auto overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden';

interface AddPropertyMenuProps {
  added: ReadonlySet<AgentCreateHubRow>;
  onAdd: (row: AgentCreateHubRow) => void;
  onAddCustom: (type: CustomPropertyType) => void;
  /** Omitted when the Schedule row is already on the canvas. */
  onAddSchedule?: (() => void) | undefined;
  disabled?: boolean;
}

export function AddPropertyMenu({
  added,
  onAdd,
  onAddCustom,
  onAddSchedule,
  disabled,
}: AddPropertyMenuProps): ReactElement {
  const hubItems = HUB_ITEMS.filter(item => !added.has(item.row));
  const hasBuiltins = hubItems.length > 0 || Boolean(onAddSchedule);
  const menu = useExclusiveMenu();

  return (
    <DropdownMenu open={menu.open} onOpenChange={menu.onOpenChange}>
      <DropdownMenuTrigger
        disabled={disabled}
        className='inline-flex w-fit items-center gap-1.5 self-start rounded-md text-sm font-normal leading-[18px] text-muted-foreground outline-none transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-50'
        data-track-category='Claw Agents'
        data-track-name='Create agent: add property'
        data-testid='add-property'
      >
        <PlusDefault className='size-4' aria-hidden />
        Add property
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align='start'
        sideOffset={6}
        data-testid='add-property-menu'
        className={ADD_PROPERTY_MENU_PANEL}
        style={{ width: 200, height: 230 }}
      >
        <div className={ADD_PROPERTY_MENU_LIST}>
          {hubItems.map(item => {
            const Icon = item.icon;
            return (
              <DropdownMenuItem
                key={item.row}
                onSelect={() => onAdd(item.row)}
                className={PROPERTY_MENU_ITEM}
                data-track-category='Claw Agents'
                data-track-name={`Create agent: add ${item.label}`}
              >
                <span className={PROPERTY_MENU_LABEL}>
                  <Icon aria-hidden />
                  <span>{item.label}</span>
                </span>
              </DropdownMenuItem>
            );
          })}
          {onAddSchedule ? (
            <DropdownMenuItem
              onSelect={onAddSchedule}
              className={PROPERTY_MENU_ITEM}
              data-testid='add-property-schedule'
              data-track-category='Claw Agents'
              data-track-name='Create agent: add Schedule'
            >
              <span className={PROPERTY_MENU_LABEL}>
                <AlarmDefault aria-hidden />
                <span>Schedule</span>
              </span>
            </DropdownMenuItem>
          ) : null}
          {hasBuiltins ? (
            <DropdownMenuSeparator
              data-testid='add-property-menu-divider'
              className={PROPERTY_MENU_SEPARATOR}
            />
          ) : null}
          {CUSTOM_PROPERTY_TYPES.map(type => {
            const Icon = TYPE_ICON[type];
            const label = CUSTOM_PROPERTY_LABEL[type];
            return (
              <DropdownMenuItem
                key={type}
                onSelect={() => onAddCustom(type)}
                className={PROPERTY_MENU_ITEM}
                data-testid={`add-property-${type}`}
                data-track-category='Claw Agents'
                data-track-name={`Create agent: add ${label}`}
              >
                <span className={PROPERTY_MENU_LABEL}>
                  <Icon aria-hidden />
                  <span>{label}</span>
                </span>
              </DropdownMenuItem>
            );
          })}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
