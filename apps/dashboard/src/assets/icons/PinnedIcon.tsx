// src/components/Icons/PinnedIcon.tsx
import React from 'react';

export const PinnedIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    xmlns='http://www.w3.org/2000/svg'
    fill='currentColor'
    viewBox='0 0 20 20'
    className={className}
  >
    <path d='M9 2a1 1 0 011 1v1.382c1.165.413 2 1.524 2 2.784V10h1a1 1 0 010 2h-2v5a1 1 0 11-2 0v-5H7a1 1 0 010-2h1V7.166c0-1.26.835-2.37 2-2.784V3a1 1 0 011-1z' />
  </svg>
);
