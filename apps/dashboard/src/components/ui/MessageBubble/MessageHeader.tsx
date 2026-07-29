import React from 'react';

interface MessageHeaderProps {
  backgroundColor: string;
  icon: string;
  text: string;
  showIcon?: boolean;
  svgBgColor?: string;
  textColor?: string;
}

export const MessageHeader: React.FC<MessageHeaderProps> = ({
  backgroundColor,
  icon,
  text,
  showIcon = true,
  svgBgColor,
  textColor,
}) => {
  const getIcon = (): React.ReactElement | null => {
    if (icon === 'visibility') {
      return (
        <svg
          xmlns='http://www.w3.org/2000/svg'
          className='w-4 h-4 fill-current'
          viewBox='0 0 24 24'
        >
          <path d='M12 5C7 5 2.73 8.11 1 12c1.73 3.89 6 7 11 7s9.27-3.11 11-7c-1.73-3.89-6-7-11-7zm0 12a5 5 0 1 1 0-10 5 5 0 0 1 0 10zm0-8a3 3 0 1 0 .001 6.001A3 3 0 0 0 12 9z' />
        </svg>
      );
    }
    return null;
  };
  return (
    <div className='flex'>
      <div className='flex'>
        <div className={`w-3 ${backgroundColor} h-[28px]`}></div>
        <svg
          width='45'
          height='28'
          viewBox='0 0 45 28'
          fill='none'
          xmlns='http://www.w3.org/2000/svg'
        >
          <path
            d='M22.7583 0 C26.0788 0 28.9922 2.21308 29.8829 5.41191 L33.6868 19.0735 C35.0011 23.7938 39.3003 28 44.2003 28 H0 V0 L22.7583 0Z'
            fill={svgBgColor}
          />
        </svg>
      </div>

      <div className='flex -ml-3'>
        <svg
          width='19'
          height='24'
          viewBox='0 0 19 24'
          fill='none'
          xmlns='http://www.w3.org/2000/svg'
        >
          <path
            d='M0.177312 5.17012C-0.609158 2.59923 1.31384 0 4.00234 0H12.8192C16.1329 0 18.8192 2.68631 18.8192 6.00003L18.8191 20C18.8191 22.2092 17.0282 24 14.8191 24H10.3766C7.73898 24 5.41067 22.2774 4.63908 19.7552L0.177312 5.17012Z'
            fill={svgBgColor}
          />
        </svg>

        <div
          className={`${backgroundColor} ${textColor} pl-1 pr-2 pb-1.5 pt-1 -mx-2 h-[24px] mb-1 flex w-fit flex align-center`}
        >
          {showIcon && getIcon()}
          <span className='text-xs ml-2'>{text}</span>
        </div>
        <svg
          width='19'
          height='24'
          viewBox='0 0 19 24'
          fill='none'
          xmlns='http://www.w3.org/2000/svg'
        >
          <path
            d='M18.642 18.8299C19.4285 21.4008 17.5055 24 14.817 24H6.00016C2.68644 24 0.000144958 21.3137 0.000164032 18L0.000236511 3.99998C0.000247955 1.79085 1.79111 -3.8147e-06 4.00024 -3.8147e-06H8.44273C11.0804 -3.8147e-06 13.4087 1.72256 14.1803 4.24481L18.642 18.8299Z'
            fill={svgBgColor}
          />
        </svg>
      </div>
    </div>
  );
};
