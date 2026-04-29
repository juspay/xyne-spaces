import React from 'react';
import type { FlowComponent } from '@xyne/shared';

interface DividerNodeProps {
  node: FlowComponent;
  children?: React.ReactNode;
}

export const DividerNode: React.FC<DividerNodeProps> = ({ node }) => {
  return (
    <hr
      className='border-t border-gray-200'
      style={{
        margin: node.style?.margin || '16px 0',
        width: node.style?.width,
      }}
    />
  );
};
