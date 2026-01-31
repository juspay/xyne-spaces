import { ReactElement } from 'react';

const ThreadsIcon = ({ color = '#363A3F' }: { color?: string }): ReactElement => {
  return (
    <svg width='18' height='18' viewBox='0 0 18 18' fill='none' xmlns='http://www.w3.org/2000/svg'>
      <path
        d='M11.6524 9.00045H6.3457M11.6524 9.00045L9.51172 6.86902M11.6524 9.00045L9.51172 11.1321'
        stroke={color}
        strokeWidth='1.5'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
      <path
        d='M2.25 8.96955C2.25 5.2542 5.27208 2.24231 9 2.24231C12.728 2.24231 15.75 5.2542 15.75 8.96955C15.75 12.6849 12.728 15.6968 9 15.6968H3C2.58579 15.6968 2.25 15.3622 2.25 14.9493V8.96955Z'
        stroke={color}
        strokeWidth='1.5'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
    </svg>
  );
};

export default ThreadsIcon;
