import { ReactElement } from 'react';

const AIAgentIcon = ({ color = '#363A3F' }: { color?: string }): ReactElement => {
  return (
    <svg width='18' height='18' viewBox='0 0 18 18' fill='none' xmlns='http://www.w3.org/2000/svg'>
      <path
        d='M5.83662 2.25H12.1627C14.3737 2.25 15.75 3.81089 15.75 6.01978V11.9802C15.75 14.1891 14.3738 15.75 12.1619 15.75H5.83662C3.62554 15.75 2.25 14.1891 2.25 11.9802V6.01978C2.25 3.81089 3.63211 2.25 5.83662 2.25Z'
        stroke={color}
        strokeWidth='1.5'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
      <path
        d='M5.70044 11.3054L7.7178 6.69434L9.7932 11.3054'
        stroke={color}
        strokeWidth='1.5'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
      <path d='M6.24097 10.1192H9.2526' stroke={color} strokeWidth='1.5' />
      <path
        d='M12.0183 11.3042V6.86279'
        stroke={color}
        strokeWidth='1.5'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
    </svg>
  );
};

export default AIAgentIcon;
