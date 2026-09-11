import { ReactElement } from 'react';

const DirectMessagesIcon = ({ className }: { className?: string }): ReactElement => {
  return (
    <svg
      width={176}
      height={89}
      viewBox='0 0 348 176'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
      className={className}
      aria-hidden='true'
      focusable='false'
    >
      <rect x={4} y={4} width={213} height={111} rx={18} className='fill-muted' />
      <path d='M34 106 L64 106 L44 131 Q38 136 35 128 Z' className='fill-muted' />

      <g filter='url(#dm-empty-bubble-shadow)'>
        <path
          d='M128 38 L324 38 A20 20 0 0 1 344 58 L344 135 A20 20 0 0 1 324 155 L304 155 L295 167 Q290 172 286 167 L264 155 L128 155 A20 20 0 0 1 108 135 L108 58 A20 20 0 0 1 128 38 Z'
          className='fill-background stroke-border'
          strokeWidth={1.5}
          strokeLinejoin='round'
        />
      </g>

      <circle cx={195} cy={96} r={7} className='fill-border' />
      <circle cx={226} cy={96} r={7} className='fill-border' />
      <circle cx={257} cy={96} r={7} className='fill-border' />

      <defs>
        <filter
          id='dm-empty-bubble-shadow'
          x={90}
          y={26}
          width={270}
          height={160}
          filterUnits='userSpaceOnUse'
        >
          <feDropShadow dx={0} dy={2} stdDeviation={4} floodColor='#000' floodOpacity={0.06} />
        </filter>
      </defs>
    </svg>
  );
};

export default DirectMessagesIcon;
