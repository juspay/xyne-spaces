import React from 'react';
import { MermaidBlock } from '../components/Markdown/MermaidBlock';

/**
 * Creates markdown components configuration with Mermaid diagram support and external link handling
 * @param messageId - The message ID to pass to MermaidBlock for caching
 * @returns Markdown components configuration object
 */
export const createMarkdownComponents = (
  messageId: string,
): {
  code: (
    props: React.HTMLAttributes<HTMLElement> & { children?: React.ReactNode },
  ) => React.ReactElement;
  a: (
    props: React.AnchorHTMLAttributes<HTMLAnchorElement> & { children?: React.ReactNode },
  ) => React.ReactElement;
} => ({
  code: ({
    className,
    children,
    ...props
  }: React.HTMLAttributes<HTMLElement> & {
    children?: React.ReactNode;
  }): React.ReactElement => {
    const match = /language-(\w+)/.exec(String(className || ''));
    const language = match ? match[1] : '';
    const codeString = Array.isArray(children)
      ? children.join('')
      : typeof children === 'string'
        ? children.replace(/\n$/, '')
        : '';

    // Render Mermaid diagrams for code blocks with mermaid language
    if (className && language === 'mermaid') {
      return <MermaidBlock chart={codeString} messageId={messageId} />;
    }

    // Regular code blocks
    return (
      <code className={className} {...props}>
        {children}
      </code>
    );
  },
  a: ({
    href,
    children,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & {
    children?: React.ReactNode;
  }): React.ReactElement => {
    // Check if URL is external
    const isExternal = (() => {
      if (!href) return false;
      try {
        const urlObj = new URL(href, window.location.origin);
        return urlObj.origin !== window.location.origin;
      } catch {
        return true; // Treat invalid URLs as external for safety
      }
    })();

    // Add target="_blank" for external links
    if (isExternal) {
      return (
        <a href={href} target='_blank' rel='noopener noreferrer' {...props}>
          {children}
        </a>
      );
    }

    return (
      <a href={href} {...props}>
        {children}
      </a>
    );
  },
});
