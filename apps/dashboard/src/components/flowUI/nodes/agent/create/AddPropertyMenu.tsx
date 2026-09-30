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
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/utils/classNames';
import type { AgentCreateHubRow } from './types';
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

export const PROPERTY_MENU_PANEL =
  'w-[150px] rounded-xl border-[0.8px] border-solid border-border bg-popover p-1 text-popover-foreground shadow-[0px_55px_16px_0px_rgba(0,0,0,0),0px_35px_14px_0px_rgba(0,0,0,0.01),0px_20px_12px_0px_rgba(0,0,0,0.02),0px_9px_9px_0px_rgba(0,0,0,0.03),0px_2px_5px_0px_rgba(0,0,0,0.04)]';

export const PROPERTY_MENU_ITEM =
  'h-9 gap-2 rounded-lg px-2 text-sm font-normal leading-5 text-popover-foreground focus:bg-accent focus:text-popover-foreground';

/** 200×230 card. Figma 1931:27057 padding is 4px; each row adds its own 8px. */
const ADD_PROPERTY_MENU_PANEL = cn(
  PROPERTY_MENU_PANEL,
  'box-border flex h-[230px] w-[200px] min-w-[200px] max-w-[200px] flex-col items-stretch gap-0 overflow-hidden rounded-[12px] p-1',
);

/** Row padding from Figma item frames (8px). Hover fills the row, inset by the card padding. */
const ADD_PROPERTY_MENU_ITEM = cn(PROPERTY_MENU_ITEM, 'rounded-[10px] p-2');

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

  return (
    <DropdownMenu>
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
                className={ADD_PROPERTY_MENU_ITEM}
                data-track-category='Claw Agents'
                data-track-name={`Create agent: add ${item.label}`}
              >
                <Icon className='size-4 shrink-0 text-muted-foreground' aria-hidden />
                {item.label}
              </DropdownMenuItem>
            );
          })}
          {onAddSchedule ? (
            <DropdownMenuItem
              onSelect={onAddSchedule}
              className={ADD_PROPERTY_MENU_ITEM}
              data-testid='add-property-schedule'
              data-track-category='Claw Agents'
              data-track-name='Create agent: add Schedule'
            >
              <AlarmDefault className='size-4 shrink-0 text-muted-foreground' aria-hidden />
              Schedule
            </DropdownMenuItem>
          ) : null}
          {hasBuiltins ? (
            <div
              aria-hidden
              data-testid='add-property-menu-divider'
              className='flex h-[16px] shrink-0 items-center px-2'
            >
              <div className='h-[0.8px] w-full bg-border' />
            </div>
          ) : null}
          {CUSTOM_PROPERTY_TYPES.map(type => {
            const Icon = TYPE_ICON[type];
            const label = CUSTOM_PROPERTY_LABEL[type];
            return (
              <DropdownMenuItem
                key={type}
                onSelect={() => onAddCustom(type)}
                className={ADD_PROPERTY_MENU_ITEM}
                data-testid={`add-property-${type}`}
                data-track-category='Claw Agents'
                data-track-name={`Create agent: add ${label}`}
              >
                <Icon className='size-4 shrink-0 text-muted-foreground' aria-hidden />
                <span className='truncate'>{label}</span>
              </DropdownMenuItem>
            );
          })}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
