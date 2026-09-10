import { ReactElement } from 'react';

const ActivityEmptyIcon = ({ className }: { className?: string }): ReactElement => {
  return (
    <svg
      width={124}
      height={75}
      viewBox='0 0 260 158'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
      className={className}
      aria-hidden='true'
      focusable='false'
    >
      <rect
        x={8}
        y={40}
        width={242}
        height={102}
        rx={12}
        className='fill-muted'
        transform='rotate(-3.9 129 91)'
      />

      <g filter='url(#activity-empty-card-shadow)'>
        <rect
          x={6}
          y={2}
          width={248}
          height={124}
          rx={12}
          className='fill-background stroke-border'
          strokeWidth={1.5}
        />
      </g>

      <rect x={27} y={25} width={86} height={11} rx={5.5} className='fill-border' />

      <rect x={27} y={73} width={22} height={29} rx={3} className='fill-border' />
      <rect x={59} y={55} width={22} height={47} rx={3} className='fill-border' />
      <rect x={91} y={81} width={22} height={21} rx={3} className='fill-border' />
      <rect x={123} y={62} width={22} height={40} rx={3} className='fill-border' />

      <defs>
        <filter
          id='activity-empty-card-shadow'
          x={-10}
          y={-6}
          width={280}
          height={160}
          filterUnits='userSpaceOnUse'
        >
          <feDropShadow dx={0} dy={2} stdDeviation={3} floodColor='#000' floodOpacity={0.05} />
        </filter>
      </defs>
    </svg>
  );
};

export default ActivityEmptyIcon;
