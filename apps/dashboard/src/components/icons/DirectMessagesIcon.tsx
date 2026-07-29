import { ReactElement } from 'react';

const DirectMessagesIcon = (): ReactElement => {
  return (
    <svg
      width={335}
      height={339}
      viewBox='0 0 335 339'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
    >
      {/* BACK BUBBLE */}
      <g filter='url(#filter0)'>
        <path
          d='M141.727 3.39957C73.7802 3.39957 18.6978 54.5665 18.6978 117.684C18.6978 136.128 23.4051 153.551 31.7593 168.976L20.1675 238.146C19.0991 244.523 25.3025 249.685 31.3794 247.476L96.2417 223.901C110.312 229.104 125.66 231.968 141.727 231.968C209.674 231.968 264.755 180.801 264.755 117.684C264.755 54.5666 209.674 3.39976 141.727 3.39957Z'
          fill='url(#paint0)'
        />
      </g>

      {/* FRONT BUBBLE */}
      <g filter='url(#filter1)'>
        <path
          d='M201.014 47.5627C264.805 47.5628 316.518 95.6 316.518 154.857C316.518 172.173 312.099 188.53 304.256 203.011L315.138 267.95C316.141 273.937 310.318 278.784 304.612 276.71L243.717 254.576C230.507 259.462 216.098 262.151 201.014 262.151C137.223 262.151 85.5098 214.113 85.5098 154.857C85.5098 95.6 137.223 47.5627 201.014 47.5627Z'
          fill='#B9DDFF'
          fillOpacity={0.9}
        />
      </g>

      {/* DOTS */}

      <circle cx='161.946' cy='156.838' r='11.3239' fill='white' />

      <circle cx='201.013' cy='156.838' r='11.3239' fill='white' />

      <circle cx='240.081' cy='156.838' r='11.3239' fill='white' />

      <defs>
        {/* BACK SHADOW */}
        <filter id='filter0' x='0' y='0' width='335' height='339' filterUnits='userSpaceOnUse'>
          <feOffset dy='2.83298' />
          <feGaussianBlur stdDeviation='3.11628' />
          <feColorMatrix
            type='matrix'
            values='0 0 0 0 0
                        0 0 0 0 0
                        0 0 0 0 0
                        0 0 0 0.06 0'
          />
          <feBlend mode='normal' in2='BackgroundImageFix' result='effect1' />
          <feBlend mode='normal' in='SourceGraphic' in2='effect1' />
        </filter>

        {/* FRONT SHADOW */}
        <filter id='filter1' x='0' y='0' width='335' height='339' filterUnits='userSpaceOnUse'>
          <feOffset dy='2.6597' />
          <feGaussianBlur stdDeviation='2.92567' />
          <feColorMatrix
            type='matrix'
            values='0 0 0 0 0
                        0 0 0 0 0
                        0 0 0 0 0
                        0 0 0 0.06 0'
          />
          <feBlend mode='normal' in2='BackgroundImageFix' result='effect1' />
          <feBlend mode='normal' in='SourceGraphic' in2='effect1' />
        </filter>

        {/* GRADIENT */}
        <linearGradient
          id='paint0'
          x1='193.777'
          y1='56.9048'
          x2='5.21857'
          y2='122.136'
          gradientUnits='userSpaceOnUse'
        >
          <stop stopColor='#7FC0FB' />
          <stop offset='1' stopColor='#4088F4' />
        </linearGradient>
      </defs>
    </svg>
  );
};

export default DirectMessagesIcon;
