import Svg, { Path, type SvgProps } from 'react-native-svg';

const ChevronLeftIcon = (props: SvgProps) => {
  const stroke = props.stroke ?? 'black';

  return (
    <Svg width={7} height={12} viewBox='0 0 7 12' fill='none' {...props}>
      <Path
        d='M6 11C4.18267 9.68583 2.55299 8.14755 1.15236 6.4251C0.949212 6.17527 0.949212 5.82473 1.15236 5.5749C2.55299 3.85245 4.18267 2.31417 6 1'
        stroke={stroke}
        strokeWidth={2}
        strokeLinecap='round'
        strokeLinejoin='round'
      />
    </Svg>
  );
};

export default ChevronLeftIcon;
