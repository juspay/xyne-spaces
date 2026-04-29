import React from 'react';
import type { FlowComponent } from '@xyne/shared';

interface ContainerNodeProps {
  node: FlowComponent;
  children?: React.ReactNode;
}

export const CardNode: React.FC<ContainerNodeProps> = ({ node, children }) => {
  return (
    <div className='rounded-lg border border-border bg-card p-4 shadow-sm' style={node.style}>
      {children}
    </div>
  );
};

export const ColumnNode: React.FC<ContainerNodeProps> = ({ node, children }) => {
  return (
    <div className='flex flex-col gap-3' style={node.style}>
      {children}
    </div>
  );
};

export const RowNode: React.FC<ContainerNodeProps> = ({ node, children }) => {
  return (
    <div className='flex flex-row gap-3 items-start flex-wrap' style={node.style}>
      {children}
    </div>
  );
};
