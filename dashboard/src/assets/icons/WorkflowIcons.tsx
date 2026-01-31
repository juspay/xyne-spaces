import React, { JSX } from 'react';

interface IconProps {
  size?: number;
  color?: string;
  className?: string;
}

// Code Review Icon
export const CodeReviewIcon: React.FC<IconProps> = ({
  size = 16,
  color = 'currentColor',
  className = '',
}) => (
  <svg
    width={size}
    height={size}
    viewBox='0 0 24 24'
    fill='none'
    xmlns='http://www.w3.org/2000/svg'
    className={className}
  >
    <path
      d='M9 12L11 14L15 10M21 12C21 16.9706 16.9706 21 12 21C7.02944 21 3 16.9706 3 12C3 7.02944 7.02944 3 12 3C16.9706 3 21 7.02944 21 12Z'
      stroke={color}
      strokeWidth='2'
      strokeLinecap='round'
      strokeLinejoin='round'
    />
  </svg>
);

// More Vertical Icon
export const MoreVertIcon: React.FC<IconProps> = ({
  size = 16,
  color = 'currentColor',
  className = '',
}) => (
  <svg
    width={size}
    height={size}
    viewBox='0 0 24 24'
    fill='none'
    xmlns='http://www.w3.org/2000/svg'
    className={className}
  >
    <path
      d='M12 13C12.5523 13 13 12.5523 13 12C13 11.4477 12.5523 11 12 11C11.4477 11 11 11.4477 11 12C11 12.5523 11.4477 13 12 13Z'
      stroke={color}
      strokeWidth='2'
      strokeLinecap='round'
      strokeLinejoin='round'
    />
    <path
      d='M12 6C12.5523 6 13 5.55228 13 5C13 4.44772 12.5523 4 12 4C11.4477 4 11 4.44772 11 5C11 5.55228 11.4477 6 12 6Z'
      stroke={color}
      strokeWidth='2'
      strokeLinecap='round'
      strokeLinejoin='round'
    />
    <path
      d='M12 20C12.5523 20 13 19.5523 13 19C13 18.4477 12.5523 18 12 18C11.4477 18 11 18.4477 11 19C11 19.5523 11.4477 20 12 20Z'
      stroke={color}
      strokeWidth='2'
      strokeLinecap='round'
      strokeLinejoin='round'
    />
  </svg>
);

// Running Icon
export const RunningIcon: React.FC<IconProps> = ({
  size = 16,
  color = 'currentColor',
  className = '',
}) => (
  <svg
    width={size}
    height={size}
    viewBox='0 0 24 24'
    fill='none'
    xmlns='http://www.w3.org/2000/svg'
    className={className}
  >
    <path d='M8 5V19L19 12L8 5Z' fill={color} />
  </svg>
);

// Completed Icon
export const CompletedIcon: React.FC<IconProps> = ({
  size = 16,
  color = 'currentColor',
  className = '',
}) => (
  <svg
    width={size}
    height={size}
    viewBox='0 0 24 24'
    fill='none'
    xmlns='http://www.w3.org/2000/svg'
    className={className}
  >
    <path
      d='M9 12L11 14L15 10M21 12C21 16.9706 16.9706 21 12 21C7.02944 21 3 16.9706 3 12C3 7.02944 7.02944 3 12 3C16.9706 3 21 7.02944 21 12Z'
      stroke={color}
      strokeWidth='2'
      strokeLinecap='round'
      strokeLinejoin='round'
    />
  </svg>
);

// Pending Icon
export const PendingIcon: React.FC<IconProps> = ({
  size = 16,
  color = 'currentColor',
  className = '',
}) => (
  <svg
    width={size}
    height={size}
    viewBox='0 0 24 24'
    fill='none'
    xmlns='http://www.w3.org/2000/svg'
    className={className}
  >
    <path
      d='M12 6V12L16 14M22 12C22 17.5228 17.5228 22 12 22C6.47715 22 2 17.5228 2 12C2 6.47715 6.47715 2 12 2C17.5228 2 22 6.47715 22 12Z'
      stroke={color}
      strokeWidth='2'
      strokeLinecap='round'
      strokeLinejoin='round'
    />
  </svg>
);

// Failed Icon
export const FailedIcon: React.FC<IconProps> = ({
  size = 16,
  color = 'currentColor',
  className = '',
}) => (
  <svg
    width={size}
    height={size}
    viewBox='0 0 24 24'
    fill='none'
    xmlns='http://www.w3.org/2000/svg'
    className={className}
  >
    <path
      d='M10 14L12 12M12 12L14 10M12 12L10 10M12 12L14 14M21 12C21 16.9706 16.9706 21 12 21C7.02944 21 3 16.9706 3 12C3 7.02944 7.02944 3 12 3C16.9706 3 21 7.02944 21 12Z'
      stroke={color}
      strokeWidth='2'
      strokeLinecap='round'
      strokeLinejoin='round'
    />
  </svg>
);

// Skipped Icon
export const SkippedIcon: React.FC<IconProps> = ({
  size = 16,
  color = 'currentColor',
  className = '',
}) => (
  <svg
    width={size}
    height={size}
    viewBox='0 0 24 24'
    fill='none'
    xmlns='http://www.w3.org/2000/svg'
    className={className}
  >
    <path
      d='M5 4L19 12L5 20V4Z'
      stroke={color}
      strokeWidth='2'
      strokeLinecap='round'
      strokeLinejoin='round'
    />
    <path
      d='M19 5V19'
      stroke={color}
      strokeWidth='2'
      strokeLinecap='round'
      strokeLinejoin='round'
    />
  </svg>
);

// Retries Icon
export const RetriesIcon: React.FC<IconProps> = ({
  size = 16,
  color = 'currentColor',
  className = '',
}) => (
  <svg
    width={size}
    height={size}
    viewBox='0 0 24 24'
    fill='none'
    xmlns='http://www.w3.org/2000/svg'
    className={className}
  >
    <path
      d='M1 4V10H7M23 20V14H17'
      stroke={color}
      strokeWidth='2'
      strokeLinecap='round'
      strokeLinejoin='round'
    />
    <path
      d='M20.49 9A9 9 0 0 0 5.64 5.64L1 10M23 14L18.36 18.36A9 9 0 0 1 3.51 15'
      stroke={color}
      strokeWidth='2'
      strokeLinecap='round'
      strokeLinejoin='round'
    />
  </svg>
);

// Play Icon
export const PlayIcon: React.FC<IconProps> = ({
  size = 16,
  color = 'currentColor',
  className = '',
}) => (
  <svg
    width={size}
    height={size}
    viewBox='0 0 24 24'
    fill='none'
    xmlns='http://www.w3.org/2000/svg'
    className={className}
  >
    <path d='M8 5V19L19 12L8 5Z' fill={color} />
  </svg>
);

// Pause Icon
export const PauseIcon: React.FC<IconProps> = ({
  size = 16,
  color = 'currentColor',
  className = '',
}) => (
  <svg
    width={size}
    height={size}
    viewBox='0 0 24 24'
    fill='none'
    xmlns='http://www.w3.org/2000/svg'
    className={className}
  >
    <path d='M10 4H6V20H10V4Z' fill={color} />
    <path d='M18 4H14V20H18V4Z' fill={color} />
  </svg>
);

// Stop Icon
export const StopIcon: React.FC<IconProps> = ({
  size = 16,
  color = 'currentColor',
  className = '',
}) => (
  <svg
    width={size}
    height={size}
    viewBox='0 0 24 24'
    fill='none'
    xmlns='http://www.w3.org/2000/svg'
    className={className}
  >
    <rect x='6' y='6' width='12' height='12' fill={color} />
  </svg>
);

// Restart Icon
export const RestartIcon: React.FC<IconProps> = ({
  size = 16,
  color = 'currentColor',
  className = '',
}) => (
  <svg
    width={size}
    height={size}
    viewBox='0 0 24 24'
    fill='none'
    xmlns='http://www.w3.org/2000/svg'
    className={className}
  >
    <path
      d='M1 4V10H7M23 20V14H17'
      stroke={color}
      strokeWidth='2'
      strokeLinecap='round'
      strokeLinejoin='round'
    />
    <path
      d='M20.49 9A9 9 0 0 0 5.64 5.64L1 10M23 14L18.36 18.36A9 9 0 0 1 3.51 15'
      stroke={color}
      strokeWidth='2'
      strokeLinecap='round'
      strokeLinejoin='round'
    />
  </svg>
);

// Code Icon
export const CodeIcon: React.FC<IconProps> = ({
  size = 16,
  color = 'currentColor',
  className = '',
}) => (
  <svg
    width={size}
    height={size}
    viewBox='0 0 24 24'
    fill='none'
    xmlns='http://www.w3.org/2000/svg'
    className={className}
  >
    <path
      d='M16 18L22 12L16 6M8 6L2 12L8 18'
      stroke={color}
      strokeWidth='2'
      strokeLinecap='round'
      strokeLinejoin='round'
    />
  </svg>
);

// Build Icon
export const BuildIcon: React.FC<IconProps> = ({
  size = 16,
  color = 'currentColor',
  className = '',
}) => (
  <svg
    width={size}
    height={size}
    viewBox='0 0 24 24'
    fill='none'
    xmlns='http://www.w3.org/2000/svg'
    className={className}
  >
    <path
      d='M21 16V8A2 2 0 0 0 19 6H5A2 2 0 0 0 3 8V16A2 2 0 0 0 5 18H19A2 2 0 0 0 21 16Z'
      stroke={color}
      strokeWidth='2'
      strokeLinecap='round'
      strokeLinejoin='round'
    />
    <path
      d='M7 10H17'
      stroke={color}
      strokeWidth='2'
      strokeLinecap='round'
      strokeLinejoin='round'
    />
  </svg>
);

// Test Icon
export const TestIcon: React.FC<IconProps> = ({
  size = 16,
  color = 'currentColor',
  className = '',
}) => (
  <svg
    width={size}
    height={size}
    viewBox='0 0 24 24'
    fill='none'
    xmlns='http://www.w3.org/2000/svg'
    className={className}
  >
    <path
      d='M7 13L10 16L17 9'
      stroke={color}
      strokeWidth='2'
      strokeLinecap='round'
      strokeLinejoin='round'
    />
    <path
      d='M21 12C21 16.9706 16.9706 21 12 21C7.02944 21 3 16.9706 3 12C3 7.02944 7.02944 3 12 3C16.9706 3 21 7.02944 21 12Z'
      stroke={color}
      strokeWidth='2'
      strokeLinecap='round'
      strokeLinejoin='round'
    />
  </svg>
);

// Git Icon
export const GitIcon: React.FC<IconProps> = ({
  size = 16,
  color = 'currentColor',
  className = '',
}) => (
  <svg
    width={size}
    height={size}
    viewBox='0 0 24 24'
    fill='none'
    xmlns='http://www.w3.org/2000/svg'
    className={className}
  >
    <path
      d='M9 19C-2 22 -2 12 -6 11M15 22V18.13A3.37 3.37 0 0 0 14.17 15.62C17.03 15.28 20 14.35 20 9.5A4.22 4.22 0 0 0 19.91 8A3.92 3.92 0 0 0 19.5 4.5S18.73 4.17 15.5 6.5A13.38 13.38 0 0 0 12 6A13.38 13.38 0 0 0 8.5 6.5C5.27 4.17 4.5 4.5 4.5 4.5A3.92 3.92 0 0 0 4.09 8A4.22 4.22 0 0 0 4 9.5C4 14.35 6.97 15.28 9.83 15.62A3.37 3.37 0 0 0 9 18.13V22'
      stroke={color}
      strokeWidth='2'
      strokeLinecap='round'
      strokeLinejoin='round'
    />
  </svg>
);

// Agent Icon
export const AgentIcon: React.FC<IconProps> = ({
  size = 16,
  color = 'currentColor',
  className = '',
}) => (
  <svg
    width={size}
    height={size}
    viewBox='0 0 24 24'
    fill='none'
    xmlns='http://www.w3.org/2000/svg'
    className={className}
  >
    <path
      d='M12 2L2 7L12 12L22 7L12 2Z'
      stroke={color}
      strokeWidth='2'
      strokeLinecap='round'
      strokeLinejoin='round'
    />
    <path
      d='M2 17L12 22L22 17'
      stroke={color}
      strokeWidth='2'
      strokeLinecap='round'
      strokeLinejoin='round'
    />
    <path
      d='M2 12L12 17L22 12'
      stroke={color}
      strokeWidth='2'
      strokeLinecap='round'
      strokeLinejoin='round'
    />
  </svg>
);

// Robot Icon
export const RobotIcon: React.FC<IconProps> = ({
  size = 16,
  color = 'currentColor',
  className = '',
}) => (
  <svg
    width={size}
    height={size}
    viewBox='0 0 24 24'
    fill='none'
    xmlns='http://www.w3.org/2000/svg'
    className={className}
  >
    <rect x='3' y='11' width='18' height='10' rx='2' stroke={color} strokeWidth='2' />
    <circle cx='12' cy='5' r='2' stroke={color} strokeWidth='2' />
    <path d='M12 7V11' stroke={color} strokeWidth='2' />
    <line x1='8' y1='16' x2='8' y2='16' stroke={color} strokeWidth='2' strokeLinecap='round' />
    <line x1='16' y1='16' x2='16' y2='16' stroke={color} strokeWidth='2' strokeLinecap='round' />
    <path d='M9 7L7 9M15 7L17 9' stroke={color} strokeWidth='2' strokeLinecap='round' />
  </svg>
);

// AI Brain Icon
export const AIBrainIcon: React.FC<IconProps> = ({
  size = 16,
  color = 'currentColor',
  className = '',
}) => (
  <svg
    width={size}
    height={size}
    viewBox='0 0 24 24'
    fill='none'
    xmlns='http://www.w3.org/2000/svg'
    className={className}
  >
    <path
      d='M9.5 2A2.5 2.5 0 0 0 7 4.5V6A6 6 0 0 0 1 12A6 6 0 0 0 7 18V19.5A2.5 2.5 0 0 0 9.5 22H10A2.5 2.5 0 0 0 12.5 19.5V18A6 6 0 0 0 18.5 12A6 6 0 0 0 12.5 6V4.5A2.5 2.5 0 0 0 10 2H9.5Z'
      stroke={color}
      strokeWidth='2'
    />
    <circle cx='9' cy='10' r='1' fill={color} />
    <circle cx='15' cy='10' r='1' fill={color} />
    <path
      d='M9 14C9 14 10.5 16 12 16S15 14 15 14'
      stroke={color}
      strokeWidth='2'
      strokeLinecap='round'
    />
  </svg>
);

// Check Circle Icon
export const CheckCircleIcon: React.FC<IconProps> = ({
  size = 16,
  color = 'currentColor',
  className = '',
}) => (
  <svg
    width={size}
    height={size}
    viewBox='0 0 24 24'
    fill='none'
    xmlns='http://www.w3.org/2000/svg'
    className={className}
  >
    <path
      d='M9 12L11 14L15 10M21 12C21 16.9706 16.9706 21 12 21C7.02944 21 3 16.9706 3 12C3 7.02944 7.02944 3 12 3C16.9706 3 21 7.02944 21 12Z'
      stroke={color}
      strokeWidth='2'
      strokeLinecap='round'
      strokeLinejoin='round'
    />
  </svg>
);

// Settings Icon
export const SettingsIcon: React.FC<IconProps> = ({
  size = 16,
  color = 'currentColor',
  className = '',
}) => (
  <svg
    width={size}
    height={size}
    viewBox='0 0 24 24'
    fill='none'
    xmlns='http://www.w3.org/2000/svg'
    className={className}
  >
    <path
      d='M12 15C13.6569 15 15 13.6569 15 12C15 10.3431 13.6569 9 12 9C10.3431 9 9 10.3431 9 12C9 13.6569 10.3431 15 12 15Z'
      stroke={color}
      strokeWidth='2'
      strokeLinecap='round'
      strokeLinejoin='round'
    />
    <path
      d='M19.4 15A1.65 1.65 0 0 0 19.04 14.36L20.28 13.12A2.07 2.07 0 0 0 20.28 10.88L19.04 9.64A1.65 1.65 0 0 0 19.4 9A1.65 1.65 0 0 0 17.75 7.35L16.51 8.59A1.65 1.65 0 0 0 15.87 8.23V6.5A2.07 2.07 0 0 0 13.8 4.43H10.2A2.07 2.07 0 0 0 8.13 6.5V8.23A1.65 1.65 0 0 0 7.49 8.59L6.25 7.35A1.65 1.65 0 0 0 4.6 9A1.65 1.65 0 0 0 4.96 9.64L3.72 10.88A2.07 2.07 0 0 0 3.72 13.12L4.96 14.36A1.65 1.65 0 0 0 4.6 15A1.65 1.65 0 0 0 6.25 16.65L7.49 15.41A1.65 1.65 0 0 0 8.13 15.77V17.5A2.07 2.07 0 0 0 10.2 19.57H13.8A2.07 2.07 0 0 0 15.87 17.5V15.77A1.65 1.65 0 0 0 16.51 15.41L17.75 16.65A1.65 1.65 0 0 0 19.4 15Z'
      stroke={color}
      strokeWidth='2'
      strokeLinecap='round'
      strokeLinejoin='round'
    />
  </svg>
);

// Analysis Icon
export const AnalysisIcon: React.FC<IconProps> = ({
  size = 16,
  color = 'currentColor',
  className = '',
}) => (
  <svg
    width={size}
    height={size}
    viewBox='0 0 24 24'
    fill='none'
    xmlns='http://www.w3.org/2000/svg'
    className={className}
  >
    <path
      d='M18 20V10M12 20V4M6 20V14'
      stroke={color}
      strokeWidth='2'
      strokeLinecap='round'
      strokeLinejoin='round'
    />
  </svg>
);

// Search Icon
export const SearchIcon: React.FC<IconProps> = ({
  size = 16,
  color = 'currentColor',
  className = '',
}) => (
  <svg
    width={size}
    height={size}
    viewBox='0 0 24 24'
    fill='none'
    xmlns='http://www.w3.org/2000/svg'
    className={className}
  >
    <circle cx='11' cy='11' r='8' stroke={color} strokeWidth='2' />
    <path
      d='M21 21L16.65 16.65'
      stroke={color}
      strokeWidth='2'
      strokeLinecap='round'
      strokeLinejoin='round'
    />
  </svg>
);

// Book Icon
export const BookIcon: React.FC<IconProps> = ({
  size = 16,
  color = 'currentColor',
  className = '',
}) => (
  <svg
    width={size}
    height={size}
    viewBox='0 0 24 24'
    fill='none'
    xmlns='http://www.w3.org/2000/svg'
    className={className}
  >
    <path
      d='M4 19.5A2.5 2.5 0 0 1 6.5 17H20'
      stroke={color}
      strokeWidth='2'
      strokeLinecap='round'
      strokeLinejoin='round'
    />
    <path
      d='M6.5 2H20V22H6.5A2.5 2.5 0 0 1 4 19.5V4.5A2.5 2.5 0 0 1 6.5 2Z'
      stroke={color}
      strokeWidth='2'
      strokeLinecap='round'
      strokeLinejoin='round'
    />
  </svg>
);

// Deploy Icon
export const DeployIcon: React.FC<IconProps> = ({
  size = 16,
  color = 'currentColor',
  className = '',
}) => (
  <svg
    width={size}
    height={size}
    viewBox='0 0 24 24'
    fill='none'
    xmlns='http://www.w3.org/2000/svg'
    className={className}
  >
    <path
      d='M12 2L2 7L12 12L22 7L12 2Z'
      stroke={color}
      strokeWidth='2'
      strokeLinecap='round'
      strokeLinejoin='round'
    />
    <path
      d='M2 17L12 22L22 17'
      stroke={color}
      strokeWidth='2'
      strokeLinecap='round'
      strokeLinejoin='round'
    />
    <path
      d='M2 12L12 17L22 12'
      stroke={color}
      strokeWidth='2'
      strokeLinecap='round'
      strokeLinejoin='round'
    />
  </svg>
);

// Not Executed Icon
export const NotExecutedIcon: React.FC<IconProps> = ({
  size = 16,
  color = 'currentColor',
  className = '',
}) => (
  <svg
    width={size}
    height={size}
    viewBox='0 0 24 24'
    fill='none'
    xmlns='http://www.w3.org/2000/svg'
    className={className}
  >
    <circle
      cx='12'
      cy='12'
      r='9'
      stroke={color}
      strokeWidth='2'
      strokeLinecap='round'
      strokeLinejoin='round'
    />
    <path
      d='M9 9L15 15M15 9L9 15'
      stroke={color}
      strokeWidth='2'
      strokeLinecap='round'
      strokeLinejoin='round'
    />
  </svg>
);

export const FailedStatusIcon: React.FC<IconProps> = ({ size = 15, className = '' }) => (
  <svg
    width={size}
    height={size}
    viewBox='0 0 15 15'
    fill='none'
    xmlns='http://www.w3.org/2000/svg'
    className={className}
  >
    <g filter='url(#filter0_d_7018_3882)'>
      <circle cx='7.5' cy='7.5' r='3' fill='#F53838' />
    </g>
    <defs>
      <filter
        id='filter0_d_7018_3882'
        x='0'
        y='0'
        width={size}
        height={size}
        filterUnits='userSpaceOnUse'
        colorInterpolationFilters='sRGB'
      >
        <feFlood floodOpacity='0' result='BackgroundImageFix' />
        <feColorMatrix
          in='SourceAlpha'
          type='matrix'
          values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0'
          result='hardAlpha'
        />
        <feMorphology
          radius='4.5'
          operator='dilate'
          in='SourceAlpha'
          result='effect1_dropShadow_7018_3882'
        />
        <feOffset />
        <feComposite in2='hardAlpha' operator='out' />
        <feColorMatrix
          type='matrix'
          values='0 0 0 0 0.862745 0 0 0 0 0.027451 0 0 0 0 0.027451 0 0 0 0.17 0'
        />
        <feBlend mode='normal' in2='BackgroundImageFix' result='effect1_dropShadow_7018_3882' />
        <feBlend
          mode='normal'
          in='SourceGraphic'
          in2='effect1_dropShadow_7018_3882'
          result='shape'
        />
      </filter>
    </defs>
  </svg>
);

export const SuccessStatusIcon: React.FC<IconProps> = ({ size = 15, className = '' }) => (
  <svg
    width={size}
    height={size}
    viewBox='0 0 12 12'
    fill='none'
    xmlns='http://www.w3.org/2000/svg'
    className={className}
  >
    <g filter='url(#filter0_d_7013_3801)'>
      <circle cx='6' cy='6' r='3' fill='#06B60F' />
    </g>
    <defs>
      <filter
        id='filter0_d_7013_3801'
        x='0'
        y='0'
        width={size}
        height={size}
        filterUnits='userSpaceOnUse'
        colorInterpolationFilters='sRGB'
      >
        <feFlood floodOpacity='0' result='BackgroundImageFix' />
        <feColorMatrix
          in='SourceAlpha'
          type='matrix'
          values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0'
          result='hardAlpha'
        />
        <feMorphology
          radius='3'
          operator='dilate'
          in='SourceAlpha'
          result='effect1_dropShadow_7013_3801'
        />
        <feOffset />
        <feComposite in2='hardAlpha' operator='out' />
        <feColorMatrix
          type='matrix'
          values='0 0 0 0 0.0226149 0 0 0 0 0.712549 0 0 0 0 0.0571116 0 0 0 0.17 0'
        />
        <feBlend mode='normal' in2='BackgroundImageFix' result='effect1_dropShadow_7013_3801' />
        <feBlend
          mode='normal'
          in='SourceGraphic'
          in2='effect1_dropShadow_7013_3801'
          result='shape'
        />
      </filter>
    </defs>
  </svg>
);

export const PendingStatusIcon: React.FC<IconProps> = ({ size = 15, className = '' }) => (
  <svg
    width={size}
    height={size}
    viewBox='0 0 15 15'
    fill='none'
    xmlns='http://www.w3.org/2000/svg'
    className={className}
  >
    <g filter='url(#filter0_d_pending)'>
      <circle cx='7.5' cy='7.5' r='3' fill='#FFA500' />
    </g>
    <defs>
      <filter
        id='filter0_d_pending'
        x='0'
        y='0'
        width={size}
        height={size}
        filterUnits='userSpaceOnUse'
        colorInterpolationFilters='sRGB'
      >
        <feFlood floodOpacity='0' result='BackgroundImageFix' />
        <feColorMatrix
          in='SourceAlpha'
          type='matrix'
          values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0'
          result='hardAlpha'
        />
        <feMorphology
          radius='4.5'
          operator='dilate'
          in='SourceAlpha'
          result='effect1_dropShadow_pending'
        />
        <feOffset />
        <feComposite in2='hardAlpha' operator='out' />
        <feColorMatrix type='matrix' values='0 0 0 0 1 0 0 0 0 0.647059 0 0 0 0 0 0 0 0 0.17 0' />
        <feBlend mode='normal' in2='BackgroundImageFix' result='effect1_dropShadow_pending' />
        <feBlend mode='normal' in='SourceGraphic' in2='effect1_dropShadow_pending' result='shape' />
      </filter>
    </defs>
  </svg>
);

// Icon lookup function
export const getWorkflowIcon = (name: string, props: IconProps = {}): JSX.Element => {
  const icons: Record<string, React.FC<IconProps>> = {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    'code-review': CodeReviewIcon,
    // eslint-disable-next-line @typescript-eslint/naming-convention
    'more-vert': MoreVertIcon,
    running: RunningIcon,
    completed: CompletedIcon,
    pending: PendingIcon,
    failed: FailedIcon,
    skipped: SkippedIcon,
    retries: RetriesIcon,
    play: PlayIcon,
    pause: PauseIcon,
    stop: StopIcon,
    restart: RestartIcon,
    code: CodeIcon,
    build: BuildIcon,
    test: TestIcon,
    git: GitIcon,
    agent: AgentIcon,
    robot: RobotIcon,
    // eslint-disable-next-line @typescript-eslint/naming-convention
    'ai-brain': AIBrainIcon,
    // eslint-disable-next-line @typescript-eslint/naming-convention
    'check-circle': CheckCircleIcon,
    settings: SettingsIcon,
    analysis: AnalysisIcon,
    search: SearchIcon,
    book: BookIcon,
    deploy: DeployIcon,
    // eslint-disable-next-line @typescript-eslint/naming-convention
    not_executed: NotExecutedIcon,
  };

  const IconComponent = icons[name] ?? CodeReviewIcon;

  return <IconComponent {...props} />;
};
