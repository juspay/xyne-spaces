export type TicketListColumnKey =
  | 'priority'
  | 'subject'
  | 'emails'
  | 'draft'
  | 'sender'
  | 'status'
  | 'assignee'
  | 'createdAt'
  | 'age'
  | 'latestEmail';

export interface TicketListColumnDefinition {
  key: TicketListColumnKey;
  label: string;
  defaultWidth: number;
  minWidth: number;
  maxWidth: number;
  align: 'left' | 'right' | 'center';
}

export type TicketListColumnWidths = Record<TicketListColumnKey, number>;

export const TICKET_LIST_SELECTION_COLUMN_WIDTH = 28;
export const TICKET_LIST_COLUMN_GAP = 12;
export const TICKET_LIST_COLUMN_PADDING_X = 24;
export const TICKET_LIST_HORIZONTAL_PADDING = TICKET_LIST_COLUMN_PADDING_X * 2;

export const TICKET_LIST_COLUMNS: readonly TicketListColumnDefinition[] = [
  {
    key: 'priority',
    label: 'Priority',
    defaultWidth: 64,
    minWidth: 52,
    maxWidth: 240,
    align: 'center',
  },
  {
    key: 'subject',
    label: 'Subject',
    defaultWidth: 420,
    minWidth: 180,
    maxWidth: 900,
    align: 'center',
  },
  {
    key: 'emails',
    label: 'Emails',
    defaultWidth: 64,
    minWidth: 56,
    maxWidth: 240,
    align: 'center',
  },
  {
    key: 'draft',
    label: 'Draft',
    defaultWidth: 96,
    minWidth: 72,
    maxWidth: 320,
    align: 'center',
  },
  {
    key: 'sender',
    label: 'Sender',
    defaultWidth: 300,
    minWidth: 140,
    maxWidth: 800,
    align: 'center',
  },
  {
    key: 'status',
    label: 'Status',
    defaultWidth: 112,
    minWidth: 88,
    maxWidth: 360,
    align: 'center',
  },
  {
    key: 'assignee',
    label: 'Assignee',
    defaultWidth: 80,
    minWidth: 64,
    maxWidth: 320,
    align: 'center',
  },
  {
    key: 'createdAt',
    label: 'Created at',
    defaultWidth: 128,
    minWidth: 112,
    maxWidth: 360,
    align: 'center',
  },
  {
    key: 'age',
    label: 'Age',
    defaultWidth: 64,
    minWidth: 52,
    maxWidth: 200,
    align: 'center',
  },
  {
    key: 'latestEmail',
    label: 'Latest email',
    defaultWidth: 120,
    minWidth: 104,
    maxWidth: 360,
    align: 'center',
  },
];

export const DEFAULT_TICKET_LIST_COLUMN_WIDTHS: TicketListColumnWidths =
  TICKET_LIST_COLUMNS.reduce<TicketListColumnWidths>((widths, column) => {
    widths[column.key] = column.defaultWidth;
    return widths;
  }, {} as TicketListColumnWidths);

const ALIGN_CLASS: Record<TicketListColumnDefinition['align'], string> = {
  left: 'justify-start text-left',
  center: 'justify-center text-center',
  right: 'justify-end text-right',
};

const COLUMN_BY_KEY: ReadonlyMap<TicketListColumnKey, TicketListColumnDefinition> = new Map(
  TICKET_LIST_COLUMNS.map(column => [column.key, column]),
);

// Alignment classes for a column, shared by its header and body cells so both move together.
export const getTicketListColumnAlignClass = (key: TicketListColumnKey): string =>
  ALIGN_CLASS[COLUMN_BY_KEY.get(key)?.align ?? 'left'];

export const getTicketListGridTemplate = (
  widths: TicketListColumnWidths,
  showSelectionColumn: boolean,
): string =>
  [
    ...(showSelectionColumn ? [`${TICKET_LIST_SELECTION_COLUMN_WIDTH}px`] : []),
    ...TICKET_LIST_COLUMNS.map(column => `minmax(0, ${widths[column.key]}fr)`),
  ].join(' ');
