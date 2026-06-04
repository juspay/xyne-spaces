import React from 'react';
import type { FlowComponent } from '@xyne/shared';
import { TextNode } from './TextNode';

interface TableNodeProps {
  node: FlowComponent;
  children?: React.ReactNode;
}

/** Render a table cell string through TextNode's inline mrkdwn parser. */
const CellContent: React.FC<{ content: string }> = ({ content }) => (
  <TextNode node={{ id: '', type: 'text', props: { content } }} />
);

export const TableNode: React.FC<TableNodeProps> = ({ node }) => {
  const props = node.props as
    | {
        rows?: string[][];
        hasHeader?: boolean;
        columnAlignments?: Array<'left' | 'center' | 'right'>;
      }
    | undefined;

  const rows = props?.rows ?? [];
  const hasHeader = props?.hasHeader ?? false;
  const columnAlignments = props?.columnAlignments ?? [];

  if (!rows.length) return null;

  const headerRow = hasHeader ? rows[0] : null;
  const dataRows = hasHeader ? rows.slice(1) : rows;

  const align = (colIndex: number): 'left' | 'center' | 'right' =>
    columnAlignments[colIndex] ?? 'left';

  return (
    <div className='overflow-x-auto my-1' style={node.style as React.CSSProperties | undefined}>
      <table
        className='text-sm border-collapse'
        style={{ width: 'auto', minWidth: '100%', tableLayout: 'auto' }}
      >
        {headerRow && (
          <thead>
            <tr className='border-b border-border bg-muted/40'>
              {headerRow.map((cell, i) => (
                <th
                  key={i}
                  className='px-3 py-1.5 text-left font-semibold text-foreground whitespace-nowrap'
                  style={{ textAlign: align(i) }}
                >
                  <CellContent content={cell} />
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {dataRows.map((row, ri) => (
            <tr key={ri} className='border-b border-border last:border-0'>
              {row.map((cell, ci) => (
                <td
                  key={ci}
                  className='px-3 py-1.5 text-foreground whitespace-nowrap'
                  style={{ textAlign: align(ci) }}
                >
                  <CellContent content={cell} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
