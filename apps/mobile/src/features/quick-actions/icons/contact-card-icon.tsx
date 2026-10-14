import * as React from 'react';
import Svg, { Path } from 'react-native-svg';

type ContactCardIconProps = {
  size?: number;
  color?: string;
  strokeWidth?: number;
};

function ContactCardIcon({
  size = 24,
  color = '#111111',
  strokeWidth = 2,
}: ContactCardIconProps): React.ReactElement {
  return (
    <Svg width={size} height={size} viewBox='0 0 24 24' fill='none'>
      <Path
        d='M2 8H4M2 16H4M11 22H13C15.8003 22 17.2004 22 18.27 21.455C19.2108 20.9757 19.9757 20.2108 20.455 19.27C21 18.2004 21 16.8003 21 14V10C21 7.19974 21 5.79961 20.455 4.73005C19.9757 3.78924 19.2108 3.02433 18.27 2.54497C17.2004 2 15.8003 2 13 2H11C8.19974 2 6.79961 2 5.73005 2.54497C4.78924 3.02433 4.02433 3.78924 3.54497 4.73005C3 5.79961 3 7.19974 3 10V14C3 16.8003 3 18.2004 3.54497 19.27C4.02433 20.2108 4.78924 20.9757 5.73005 21.455C6.79961 22 8.19974 22 11 22ZM14.2222 8.76886C14.2222 9.99616 13.2273 10.9911 12 10.9911C10.7727 10.9911 9.77778 9.99616 9.77778 8.76886C9.77778 7.54156 10.7727 6.54664 12 6.54664C13.2273 6.54664 14.2222 7.54156 14.2222 8.76886ZM9.77778 13.6667C8.55048 13.6667 7.55556 14.6616 7.55556 15.8889C7.55556 16.5025 8.05302 17 8.66667 17H15.3333C15.947 17 16.4444 16.5025 16.4444 15.8889C16.4444 14.6616 15.4495 13.6667 14.2222 13.6667H9.77778Z'
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap='round'
        strokeLinejoin='round'
      />
    </Svg>
  );
}

export default ContactCardIcon;
