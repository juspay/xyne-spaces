import { ReactElement } from 'react';

interface StopIconProps {
  className?: string;
}

export const StopIcon = ({ className }: StopIconProps): ReactElement => {
  return (
    <svg
      xmlns='http://www.w3.org/2000/svg'
      width='10'
      height='10'
      viewBox='0 0 10 10'
      fill='none'
      className={className}
    >
      <path
        d='M8.88889 0H1.11111C0.497461 0 0 0.497461 0 1.11111V8.88889C0 9.50254 0.497461 10 1.11111 10H8.88889C9.50254 10 10 9.50254 10 8.88889V1.11111C10 0.497461 9.50254 0 8.88889 0Z'
        fill='currentColor'
      />
    </svg>
  );
};
