import { ReactElement } from 'react';

interface GlassStarProps {
  shouldRotate?: boolean;
  size?: number;
}

const GlassStar = ({ shouldRotate = true, size = 72 }: GlassStarProps): ReactElement => {
  const starPath =
    'M32.7214 68.5841C32.7148 56.9838 31.0275 49.997 27.0435 45.7624C23.105 41.5762 16.1364 39.2694 3.2694 39.2694C1.46284 39.2694 0.00153034 37.8062 0 36C0 34.1925 1.46189 32.7214 3.2694 32.7214C16.1365 32.7214 23.105 30.4147 27.0435 26.2284C31.0265 21.9935 32.715 15.0066 32.7214 3.40677C32.7215 3.36166 32.7215 3.31462 32.7214 3.2694C32.7225 1.46262 34.1932 0 36 0C37.8055 0.00152977 39.2684 1.46357 39.2694 3.2694C39.2694 3.31702 39.2694 3.36841 39.2694 3.41592C39.2766 15.0096 40.9664 21.9942 44.9473 26.2284C48.8855 30.4143 55.8565 32.721 68.7214 32.7214C70.529 32.7214 72 34.1925 72 36C71.9985 37.8062 70.528 39.2694 68.7214 39.2694C55.8565 39.2698 48.8855 41.5765 44.9473 45.7624C40.9645 49.9972 39.276 56.9853 39.2694 68.5841C39.2694 68.6297 39.2694 68.6849 39.2694 68.7306C39.2663 70.5347 37.8042 71.9985 36 72C34.1945 72 32.7245 70.5356 32.7214 68.7306C32.7215 68.6849 32.7215 68.6297 32.7214 68.5841Z';

  return (
    <div
      style={{
        position: 'relative',
        width: `${size}px`,
        height: `${size}px`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <style>
        {`
          @keyframes smartRotate {
            0% {
              transform: rotate(0deg);
            }
            100% {
              transform: rotate(180deg);
            }
          }
          @keyframes orbit1 {
            0% { transform: rotate(0deg) translateX(12px) rotate(0deg) scale(1); }
            25% { transform: rotate(90deg) translateX(18px) rotate(-90deg) scale(1.3); }
            50% { transform: rotate(180deg) translateX(20px) rotate(-180deg) scale(1.4); }
            75% { transform: rotate(270deg) translateX(18px) rotate(-270deg) scale(1.3); }
            100% { transform: rotate(360deg) translateX(12px) rotate(-360deg) scale(1); }
          }
          @keyframes orbit2 {
            0% { transform: rotate(120deg) translateX(15px) rotate(-120deg) scale(1.2); }
            25% { transform: rotate(75deg) translateX(16px) rotate(-75deg) scale(1.1); }
            50% { transform: rotate(-60deg) translateX(14px) rotate(60deg) scale(0.9); }
            75% { transform: rotate(-165deg) translateX(16px) rotate(165deg) scale(1.1); }
            100% { transform: rotate(-240deg) translateX(15px) rotate(240deg) scale(1.2); }
          }
          @keyframes orbit3 {
            0% { transform: rotate(240deg) translateX(13px) rotate(-240deg) scale(1.05); }
            25% { transform: rotate(165deg) translateX(19px) rotate(-165deg) scale(1.25); }
            50% { transform: rotate(60deg) translateX(20px) rotate(-60deg) scale(1.35); }
            75% { transform: rotate(-75deg) translateX(19px) rotate(75deg) scale(1.25); }
            100% { transform: rotate(-120deg) translateX(13px) rotate(120deg) scale(1.05); }
          }
          @keyframes starBreath {
            0%, 100% { transform: scale(0.95); }
            25% { transform: scale(1.08); }
            50% { transform: scale(1.0); }
            75% { transform: scale(1.1); }
          }
          .star-container {
            animation: ${shouldRotate ? 'smartRotate 2.2s cubic-bezier(0.68, -0.20, 0.265, 1.10) forwards' : 'none'};
            transform-origin: 36px 36px;
            will-change: transform;
          }
          .fluid-group {
            opacity: 0.9;
            animation: none;
          }
          @keyframes fadeIn {
            0% { visibility: visible; opacity: 0; }
            100% { visibility: visible; opacity: 0.9; }
          }
          @keyframes fadeGlow {
            0% { opacity: 0; }
            100% { opacity: 1; }
          }
          @keyframes sparkleFloat1 {
            0% { transform: translate(-2px, -3px) scale(0.8); opacity: 0.6; }
            25% { transform: translate(-6px, -10px) scale(0.7); opacity: 0.5; }
            50% { transform: translate(-10px, -17px) scale(0.5); opacity: 0.35; }
            75% { transform: translate(-14px, -24px) scale(0.25); opacity: 0.15; }
            100% { transform: translate(-18px, -30px) scale(0); opacity: 0; }
          }
          @keyframes sparkleFloat2 {
            0% { transform: translate(2px, -2px) scale(0.8); opacity: 0.6; }
            25% { transform: translate(7px, -8px) scale(0.7); opacity: 0.5; }
            50% { transform: translate(12px, -15px) scale(0.5); opacity: 0.35; }
            75% { transform: translate(17px, -22px) scale(0.25); opacity: 0.15; }
            100% { transform: translate(22px, -28px) scale(0); opacity: 0; }
          }
          @keyframes sparkleFloat3 {
            0% { transform: translate(2px, 3px) scale(0.8); opacity: 0.6; }
            25% { transform: translate(5px, 9px) scale(0.7); opacity: 0.5; }
            50% { transform: translate(9px, 16px) scale(0.5); opacity: 0.35; }
            75% { transform: translate(13px, 22px) scale(0.25); opacity: 0.15; }
            100% { transform: translate(16px, 28px) scale(0); opacity: 0; }
          }
          @keyframes sparkleFloat4 {
            0% { transform: translate(-2px, 2px) scale(0.8); opacity: 0.6; }
            25% { transform: translate(-6px, 8px) scale(0.7); opacity: 0.5; }
            50% { transform: translate(-10px, 14px) scale(0.5); opacity: 0.35; }
            75% { transform: translate(-14px, 20px) scale(0.25); opacity: 0.15; }
            100% { transform: translate(-18px, 26px) scale(0); opacity: 0; }
          }
          @keyframes sparkleFloat5 {
            0% { transform: translate(-3px, 0px) scale(0.8); opacity: 0.6; }
            25% { transform: translate(-10px, 1px) scale(0.7); opacity: 0.5; }
            50% { transform: translate(-18px, 3px) scale(0.5); opacity: 0.35; }
            75% { transform: translate(-25px, 4px) scale(0.25); opacity: 0.15; }
            100% { transform: translate(-32px, 5px) scale(0); opacity: 0; }
          }
          @keyframes sparkleFloat6 {
            0% { transform: translate(3px, 0px) scale(0.8); opacity: 0.6; }
            25% { transform: translate(10px, -1px) scale(0.7); opacity: 0.5; }
            50% { transform: translate(18px, -3px) scale(0.5); opacity: 0.35; }
            75% { transform: translate(25px, -4px) scale(0.25); opacity: 0.15; }
            100% { transform: translate(32px, -5px) scale(0); opacity: 0; }
          }
        `}
      </style>
      <div className='star-container'>
        <svg
          width={size}
          height={size}
          viewBox='0 0 72 72'
          fill='none'
          xmlns='http://www.w3.org/2000/svg'
          style={{ overflow: 'visible' }}
        >
          <defs>
            {/* ClipPath for crisp star edges */}
            <clipPath id='starClip'>
              <path d={starPath} />
            </clipPath>

            {/* Fluid ink blur */}
            <filter id='fluidBlur' x='-150%' y='-150%' width='400%' height='400%'>
              <feGaussianBlur in='SourceGraphic' stdDeviation='10' />
            </filter>

            {/* Glow filter for sparkles */}
            <filter id='sparkleGlow' x='-150%' y='-150%' width='400%' height='400%'>
              <feGaussianBlur in='SourceGraphic' stdDeviation='0.8' result='blur' />
              <feMerge>
                <feMergeNode in='blur' />
                <feMergeNode in='SourceGraphic' />
              </feMerge>
            </filter>

            {/* Figma-spec Inner Shadow */}
            <filter
              id='innerShadow'
              x='0'
              y='0'
              width='72'
              height='73.6696'
              filterUnits='userSpaceOnUse'
              colorInterpolationFilters='sRGB'
            >
              <feFlood floodOpacity='0' result='BackgroundImageFix' />
              <feBlend mode='normal' in='SourceGraphic' in2='BackgroundImageFix' result='shape' />
              <feColorMatrix
                in='SourceAlpha'
                type='matrix'
                values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0'
                result='hardAlpha'
              />
              <feOffset dy='1.66956' />
              <feGaussianBlur stdDeviation='1.63453' />
              <feComposite in2='hardAlpha' operator='arithmetic' k2='-1' k3='1' />
              <feColorMatrix type='matrix' values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0.5 0' />
              <feBlend mode='normal' in2='shape' result='effect1_innerShadow' />
            </filter>
          </defs>

          {/* Neutral Base Star */}
          <path d={starPath} fill='hsl(0, 0%, 100%)' />

          {/* Glass Content clipped to star */}
          <g clipPath='url(#starClip)'>
            <g filter='url(#fluidBlur)' className='fluid-group'>
              {/* Red ink - Central orbit */}
              <ellipse
                cx='36'
                cy='36'
                rx='18'
                ry='12.5'
                fill='#FF5689'
                style={{
                  transformOrigin: '36px 36px',
                  animation: `orbit1 6s ease-in-out infinite ${shouldRotate ? '' : 'none'}`,
                }}
              />
              {/* Orange ink - Offset orbit */}
              <ellipse
                cx='36'
                cy='36'
                rx='16'
                ry='10.5'
                fill='rgb(255, 67, 95)'
                style={{
                  transformOrigin: '36px 36px',
                  animation: `orbit2 6s ease-in-out infinite ${shouldRotate ? '' : 'none'}`,
                }}
              />
              {/* Pink ink - Wide orbit */}
              <ellipse
                cx='36'
                cy='36'
                rx='14.5'
                ry='10'
                fill='#f44c1a'
                style={{
                  transformOrigin: '36px 36px',
                  animation: `orbit3 6s ease-in-out infinite ${shouldRotate ? '' : 'none'}`,
                }}
              />
            </g>
          </g>

          {/* Glossy Overlay with Inner Shadow */}
          <path d={starPath} fill='#FF4E4F' fillOpacity='0.08' filter='url(#innerShadow)' />

          {/* Glowing sparkles floating from center */}
          <g filter='url(#sparkleGlow)'>
            <circle
              cx='36'
              cy='36'
              r='1'
              fill='#FFEEDD'
              style={{
                transformOrigin: '36px 36px',
                animation: 'sparkleFloat1 5s linear infinite',
              }}
            />
            <circle
              cx='36'
              cy='36'
              r='0.8'
              fill='#FFE0CC'
              style={{
                transformOrigin: '36px 36px',
                animation: 'sparkleFloat2 5s linear infinite 1.25s',
              }}
            />
            <circle
              cx='36'
              cy='36'
              r='0.85'
              fill='#FFF5EA'
              style={{
                transformOrigin: '36px 36px',
                animation: 'sparkleFloat5 5s linear infinite 2.5s',
              }}
            />
            <circle
              cx='36'
              cy='36'
              r='0.75'
              fill='#FFEADD'
              style={{
                transformOrigin: '36px 36px',
                animation: 'sparkleFloat6 5s linear infinite 3.75s',
              }}
            />
          </g>
        </svg>
      </div>
    </div>
  );
};

export default GlassStar;
