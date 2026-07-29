import React from 'react';

/**
 * Microsoft Logo SVG component for Sign In button
 * Uses the official Microsoft 4-square logo design
 */
export const MicrosoftLogo: React.FC<{ className?: string }> = ({ className = '' }) => (
  <svg
    className={className}
    xmlns='http://www.w3.org/2000/svg'
    viewBox='0 0 21 21'
    width='18'
    height='18'
    aria-hidden='true'
  >
    {/* Microsoft 4-square logo */}
    <rect x='1' y='1' width='9' height='9' fill='#f25022' />
    <rect x='1' y='11' width='9' height='9' fill='#00a4ef' />
    <rect x='11' y='1' width='9' height='9' fill='#7fba00' />
    <rect x='11' y='11' width='9' height='9' fill='#ffb900' />
  </svg>
);

export default MicrosoftLogo;
