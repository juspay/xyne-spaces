import Svg, { Path, type SvgProps } from 'react-native-svg';

const SendToChannelIcon = (props: SvgProps) => {
  const stroke = props.stroke ?? 'currentColor';

  return (
    <Svg width={20} height={20} viewBox='0 0 24 24' fill='none' {...props}>
      <Path
        d='M9 14L4 9L9 4'
        stroke={stroke}
        strokeWidth={2}
        strokeLinecap='round'
        strokeLinejoin='round'
      />
      <Path
        d='M20 20V13C20 11.9391 19.5786 10.9217 18.8284 10.1716C18.0783 9.42143 17.0609 9 16 9H4'
        stroke={stroke}
        strokeWidth={2}
        strokeLinecap='round'
        strokeLinejoin='round'
      />
    </Svg>
  );
};

export default SendToChannelIcon;
