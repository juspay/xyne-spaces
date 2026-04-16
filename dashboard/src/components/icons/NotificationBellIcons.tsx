import { ReactElement } from 'react';

const NotificationBellIcons = ({ color = 'currentColor' }: { color?: string }): ReactElement => {
  return (
    <svg width='15' height='17' viewBox='0 0 15 17' fill='none' xmlns='http://www.w3.org/2000/svg'>
      <path
        fillRule='evenodd'
        clipRule='evenodd'
        d='M7.125 12.6357C11.3544 12.6357 13.311 12.0932 13.5 9.91538C13.5 7.7391 12.1359 7.87904 12.1359 5.20883C12.1359 3.1231 10.1589 0.75 7.125 0.75C4.09108 0.75 2.11414 3.1231 2.11414 5.20883C2.11414 7.87904 0.75 7.7391 0.75 9.91538C0.939714 12.1014 2.89633 12.6357 7.125 12.6357Z'
        stroke={color}
        strokeWidth='1.5'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
      <path
        d='M8.91665 14.8929C7.89355 16.029 6.29754 16.0424 5.26465 14.8929'
        stroke={color}
        strokeWidth='1.5'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
    </svg>
  );
};

export default NotificationBellIcons;
