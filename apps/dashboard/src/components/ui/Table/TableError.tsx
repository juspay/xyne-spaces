import React, { ReactNode } from 'react';

interface TableErrorProps {
  colSpan: number;
  children?: ReactNode;
}

export const TableError: React.FC<TableErrorProps> = ({ colSpan, children }) => (
  <tbody data-slot='table-error'>
    <tr>
      <td colSpan={colSpan} className='py-12'>
        <div className='flex flex-col items-center justify-center text-destructive text-sm'>
          {children ?? 'Something went wrong'}
        </div>
      </td>
    </tr>
  </tbody>
);
