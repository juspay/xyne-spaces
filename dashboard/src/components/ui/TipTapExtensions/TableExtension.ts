import { Table } from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import type { AnyExtension } from '@tiptap/core';

// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
export const TableExtension = Table.configure({
  resizable: false,
  HTMLAttributes: {
    class: 'chat-table border border-gray-300 border-collapse w-full',
  },
});

// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
export const TableRowExtension = TableRow.configure({
  HTMLAttributes: {
    class: 'chat-table-row last:border-b-0',
  },
});

// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
export const TableCellExtension = TableCell.configure({
  HTMLAttributes: {
    class: 'chat-table-cell border border-gray-300 px-3 py-2',
  },
});

// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
export const TableHeaderExtension = TableHeader.configure({
  HTMLAttributes: {
    class: 'chat-table-header border border-gray-300 px-3 py-2 bg-gray-50 font-semibold',
  },
});

// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const TableExtensions: AnyExtension[] = [
  TableExtension,
  TableRowExtension,
  TableCellExtension,
  TableHeaderExtension,
];
