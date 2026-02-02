import { ReactElement } from 'react';

const XyneRename = ({
  color = 'black',
  size = 20,
}: {
  color?: string;
  size?: number;
}): ReactElement => {
  return (
    <svg
      width={size}
      height={size}
      viewBox='0 0 16 16'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
    >
      <g clipPath='url(#clip0_9048_7180)'>
        <path
          d='M8.66602 14H13.9993'
          stroke={color}
          strokeWidth='1.33333'
          strokeLinecap='round'
          strokeLinejoin='round'
        />
        <path
          d='M14.1166 4.54126C14.4691 4.18888 14.6671 3.71091 14.6672 3.2125C14.6673 2.71409 14.4693 2.23607 14.1169 1.8836C13.7646 1.53112 13.2866 1.33307 12.7882 1.33301C12.2898 1.33295 11.8117 1.53088 11.4593 1.88326L2.56194 10.7826C2.40715 10.9369 2.29268 11.127 2.22861 11.3359L1.34794 14.2373C1.33071 14.2949 1.32941 14.3562 1.34417 14.4145C1.35894 14.4728 1.38922 14.5261 1.4318 14.5686C1.47439 14.6111 1.52769 14.6413 1.58605 14.656C1.6444 14.6707 1.70565 14.6693 1.76327 14.6519L4.66527 13.7719C4.87405 13.7084 5.06406 13.5947 5.21861 13.4406L14.1166 4.54126Z'
          stroke={color}
          strokeWidth='1.33333'
          strokeLinecap='round'
          strokeLinejoin='round'
        />
      </g>
      <defs>
        <clipPath id='clip0_9048_7180'>
          <rect width='16' height='16' fill='white' />
        </clipPath>
      </defs>
    </svg>
  );
};

export default XyneRename;
