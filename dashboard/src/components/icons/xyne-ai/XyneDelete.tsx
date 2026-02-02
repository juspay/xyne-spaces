import { ReactElement } from 'react';

const XyneDelete = ({
  color = '#FF4F4F',
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
      <path
        d='M12.6673 4V13.3333C12.6673 13.687 12.5268 14.0261 12.2768 14.2761C12.0267 14.5262 11.6876 14.6667 11.334 14.6667H4.66732C4.3137 14.6667 3.97456 14.5262 3.72451 14.2761C3.47446 14.0261 3.33398 13.687 3.33398 13.3333V4'
        stroke={color}
        strokeWidth='1.33333'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
      <path
        d='M2 4H14'
        stroke={color}
        strokeWidth='1.33333'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
      <path
        d='M5.33398 4.00016V2.66683C5.33398 2.31321 5.47446 1.97407 5.72451 1.72402C5.97456 1.47397 6.3137 1.3335 6.66732 1.3335H9.33398C9.68761 1.3335 10.0267 1.47397 10.2768 1.72402C10.5268 1.97407 10.6673 2.31321 10.6673 2.66683V4.00016'
        stroke={color}
        strokeWidth='1.33333'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
    </svg>
  );
};

export default XyneDelete;
