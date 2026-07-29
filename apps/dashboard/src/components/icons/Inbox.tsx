import { ReactElement } from 'react';

const Inbox = ({
  color = 'currentColor',
  size = 20,
}: {
  color?: string;
  size?: number;
}): ReactElement => {
  return (
    <svg
      width={size}
      height={size}
      viewBox='0 0 20 20'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
    >
      <path
        d='M6.48594 2.5H13.5148C15.9716 2.5 17.5 4.23432 17.5 6.68865V13.3113C17.5 15.7657 15.9716 17.5 13.5141 17.5H6.48594C4.02919 17.5 2.5 15.7657 2.5 13.3113V6.68865C2.5 4.23432 4.03648 2.5 6.48594 2.5Z'
        stroke={color}
        strokeWidth='1.5'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
      <path
        d='M7.46582 6.57471H12.5367'
        stroke={color}
        strokeWidth='1.5'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
      <path
        d='M17.4968 10.3719H13.9268C13.1873 10.3719 12.5127 10.7903 12.1843 11.4528C11.7862 12.2554 10.9584 12.8068 10.0017 12.8068C9.04492 12.8068 8.21707 12.2554 7.81896 11.4528C7.49057 10.7903 6.81598 10.3719 6.07652 10.3719H2.50977'
        stroke={color}
        strokeWidth='1.5'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
    </svg>
  );
};

export default Inbox;
