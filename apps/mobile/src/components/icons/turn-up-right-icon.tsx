import Svg, { Path, type SvgProps } from 'react-native-svg';

const TurnUpRightIcon = (props: SvgProps) => {
  const color = props.color ?? '#E0E0E0';

  return (
    <Svg width={20} height={20} viewBox='0 0 20 20' fill='none' {...props}>
      <Path
        d='M12.6165 3.3335C14.0772 4.41375 15.3891 5.67571 16.5199 7.08744C16.6169 7.20854 16.6654 7.35435 16.6654 7.50016M12.6165 11.6668C14.0772 10.5866 15.3891 9.32462 16.5199 7.91288C16.6169 7.79178 16.6654 7.64597 16.6654 7.50016M16.6654 7.50016H9.9987C7.66515 7.50016 6.49837 7.50016 5.60707 7.9543C4.82306 8.35378 4.18564 8.99119 3.78617 9.7752C3.33203 10.6665 3.33203 11.8333 3.33203 14.1668V16.6668'
        stroke={color}
        strokeWidth={1.4}
        strokeLinecap='round'
        strokeLinejoin='round'
      />
    </Svg>
  );
};
export default TurnUpRightIcon;
