import Svg, { Path, type SvgProps } from 'react-native-svg';

const TurnUpLeftIcon = ({ ...props }: SvgProps) => {
  const color = props.color ?? '#E0E0E0';

  return (
    <Svg width={20} height={20} viewBox='0 0 20 20' fill='none' {...props}>
      <Path
        d='M7.38092 3.3335C5.92023 4.41375 4.6083 5.67571 3.47753 7.08744C3.38053 7.20854 3.33203 7.35435 3.33203 7.50016M7.38092 11.6668C5.92023 10.5866 4.6083 9.32462 3.47753 7.91288C3.38053 7.79178 3.33203 7.64597 3.33203 7.50016M3.33203 7.50016H9.9987C12.3322 7.50016 13.499 7.50016 14.3903 7.9543C15.1743 8.35378 15.8118 8.99119 16.2112 9.7752C16.6654 10.6665 16.6654 11.8333 16.6654 14.1668L16.6654 16.6668'
        stroke={color}
        strokeWidth={1.4}
        strokeLinecap='round'
        strokeLinejoin='round'
      />
    </Svg>
  );
};

export default TurnUpLeftIcon;
