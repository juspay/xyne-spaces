import { ReactNode } from 'react';

/**
 * Highlights matching text with HTML <mark> element
 */
export const highlightText = (text: string, query: string): ReactNode => {
  if (!query.trim()) {
    return text;
  }

  const parts = text.split(new RegExp(`(${query})`, 'gi'));

  return parts.map((part, index) => {
    if (part.toLowerCase() === query.toLowerCase()) {
      return (
        <mark key={index} className='bg-yellow-200 text-foreground roundedm'>
          {part}
        </mark>
      );
    }
    return part;
  });
};
