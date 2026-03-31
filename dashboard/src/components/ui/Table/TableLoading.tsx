import React from 'react';
import { Skeleton } from '../Skeleton';

interface TableLoadingProps {
  colSpan: number;
  rowCount?: number;
}

export const TableLoading: React.FC<TableLoadingProps> = ({ colSpan, rowCount = 5 }) => (
  <tbody data-slot='table-loading'>
    {Array.from({ length: rowCount }).map((_, rowIndex) => (
      <tr key={rowIndex}>
        {Array.from({ length: colSpan }).map((_, colIndex) => (
          <td key={colIndex}>
            <Skeleton className='h-4 w-full' />
          </td>
        ))}
      </tr>
    ))}
  </tbody>
);
