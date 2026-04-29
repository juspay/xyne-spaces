import React from 'react';
import type { FlowComponent } from '@xyne/shared';

interface HeadingNodeProps {
  node: FlowComponent;
  children?: React.ReactNode;
}

export const HeadingNode: React.FC<HeadingNodeProps> = ({ node }) => {
  const props = node.props as
    | {
        content?: string;
        level?: 1 | 2 | 3 | 4;
      }
    | undefined;

  const level = props?.level || 2;
  const className = 'font-semibold text-foreground';

  const content = props?.content || '';

  switch (level) {
    case 1:
      return (
        <h1 className={`text-2xl ${className}`} style={node.style}>
          {content}
        </h1>
      );
    case 2:
      return (
        <h2 className={`text-xl ${className}`} style={node.style}>
          {content}
        </h2>
      );
    case 3:
      return (
        <h3 className={`text-lg ${className}`} style={node.style}>
          {content}
        </h3>
      );
    case 4:
      return (
        <h4 className={`text-base ${className}`} style={node.style}>
          {content}
        </h4>
      );
    default:
      return (
        <h2 className={`text-xl ${className}`} style={node.style}>
          {content}
        </h2>
      );
  }
};
