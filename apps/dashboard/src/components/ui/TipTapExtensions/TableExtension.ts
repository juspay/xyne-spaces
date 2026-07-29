import { Table } from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import type { AnyExtension } from '@tiptap/core';

// Inline styles, not classes — the Tiptap editor, the iframe-rendered
// email view, and the recipient's mail client all render the same way
// because inline `style="..."` survives every sanitizer + UA stylesheet.
const BORDER = '1px solid #d1d5db';
const CELL_PADDING = '8px 12px';
const HEADER_BG = '#f9fafb';

/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
export const TableExtension = Table.configure({
  resizable: false,
  HTMLAttributes: {
    class: 'chat-table',
    style: `border-collapse: collapse; border: ${BORDER}; max-width: 100%;`,
  },
});

export const TableRowExtension = TableRow.configure({
  HTMLAttributes: { class: 'chat-table-row' },
});

export const TableCellExtension = TableCell.configure({
  HTMLAttributes: {
    class: 'chat-table-cell',
    style: `border: ${BORDER}; padding: ${CELL_PADDING}; vertical-align: top;`,
  },
});

export const TableHeaderExtension = TableHeader.configure({
  HTMLAttributes: {
    class: 'chat-table-header',
    style: `border: ${BORDER}; padding: ${CELL_PADDING}; background: ${HEADER_BG}; font-weight: 600; text-align: left;`,
  },
});

export const TableExtensions: AnyExtension[] = [
  TableExtension,
  TableRowExtension,
  TableCellExtension,
  TableHeaderExtension,
];
/* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
