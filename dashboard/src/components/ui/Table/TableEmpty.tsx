import React, { ReactNode } from 'react';

interface TableEmptyProps {
  colSpan: number;
  children?: ReactNode;
}

export const TableEmpty: React.FC<TableEmptyProps> = ({ colSpan, children }) => (
  <tbody data-slot='table-empty' className='h-full'>
    <tr className='h-full'>
      <td colSpan={colSpan} className='h-full'>
        <div className='flex flex-col items-center justify-center text-muted-foreground text-sm h-full min-h-[200px]'>
          {children ?? 'No data found'}
        </div>
      </td>
    </tr>
  </tbody>
);
