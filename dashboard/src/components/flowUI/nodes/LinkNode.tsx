import React from 'react';
import type { FlowComponent } from '@xyne/shared';

interface LinkNodeProps {
  node: FlowComponent;
  children?: React.ReactNode;
}

export const LinkNode: React.FC<LinkNodeProps> = ({ node }) => {
  const props = node.props as
    | {
        href?: string;
        label?: string;
        external?: boolean;
        underline?: boolean;
      }
    | undefined;

  const href = props?.href || '';
  const label = props?.label || href;
  if (!label) {
    return null;
  }

  // Only http(s) targets are clickable — mirrors TextNode's inline link parser
  // so payload-supplied hrefs can't inject javascript: URLs.
  if (!/^https?:\/\//i.test(href)) {
    return (
      <span className='text-foreground' style={node.style}>
        {label}
      </span>
    );
  }

  const underlineClass = props?.underline === false ? '' : 'underline';
  const externalProps =
    props?.external === false ? {} : { target: '_blank', rel: 'noopener noreferrer' };

  return (
    <a
      href={href}
      {...externalProps}
      className={`text-[var(--link-color)] hover:text-[var(--link-hover-color)] break-all ${underlineClass}`}
      style={node.style}
    >
      {label}
    </a>
  );
};
