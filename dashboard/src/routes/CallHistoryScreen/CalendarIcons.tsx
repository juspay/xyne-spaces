import type { ReactElement } from 'react';

/** Microsoft 4-square logo with official brand colors */
export function MicrosoftIcon({ size = 14 }: { size?: number }): ReactElement {
  const half = size / 2 - 0.5;
  return (
    <svg
      width={size}
      height={size}
      viewBox='0 0 14 14'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
      style={{ display: 'inline-block', flexShrink: 0 }}
    >
      <rect x='0' y='0' width={half} height={half} fill='#f25022' />
      <rect x={size - half} y='0' width={half} height={half} fill='#7fba00' />
      <rect x='0' y={size - half} width={half} height={half} fill='#00a4ef' />
      <rect x={size - half} y={size - half} width={half} height={half} fill='#ffb900' />
    </svg>
  );
}

/** Google "G" logo with official brand colors */
export function GoogleCalendarIcon({ size = 14 }: { size?: number }): ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox='0 0 14 14'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
      style={{ display: 'inline-block', flexShrink: 0 }}
    >
      {/* Blue arc (top-right) */}
      <path
        d='M13 7c0-.47-.04-.92-.12-1.36H7v2.57h3.37a2.88 2.88 0 0 1-1.25 1.89v1.57h2.02C12.34 10.52 13 8.93 13 7z'
        fill='#4285F4'
      />
      {/* Green arc (bottom-right) */}
      <path
        d='M7 13c1.7 0 3.12-.56 4.16-1.52l-2.02-1.57c-.56.38-1.28.6-2.14.6-1.64 0-3.03-1.11-3.52-2.6H1.42v1.62A6 6 0 0 0 7 13z'
        fill='#34A853'
      />
      {/* Yellow arc (bottom-left) */}
      <path
        d='M3.48 7.91A3.6 3.6 0 0 1 3.29 7c0-.32.06-.63.19-.91V4.47H1.42A6 6 0 0 0 1 7c0 .97.23 1.88.42 2.53l2.06-1.62z'
        fill='#FBBC05'
      />
      {/* Red arc (top-left) */}
      <path
        d='M7 3.49c.92 0 1.75.32 2.4.94l1.8-1.8A6 6 0 0 0 7 1a6 6 0 0 0-5.58 3.47l2.06 1.62C3.97 4.6 5.36 3.49 7 3.49z'
        fill='#EA4335'
      />
    </svg>
  );
}
