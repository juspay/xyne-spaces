import Svg, { Path, type SvgProps } from 'react-native-svg';

const TicketBadgeIcon = ({ ...props }: SvgProps) => {
  const color = props.color ?? '#344054';

  return (
    <Svg width={12} height={12} viewBox='0 0 12 12' fill='none' {...props}>
      <Path
        d='M7.56857 1.60257C7.35265 1.44185 7.07256 1.39567 6.81552 1.46795L2.90806 2.55178C2.46404 2.67388 2.17388 3.11943 2.27195 3.57096L3.32627 8.47051C3.42434 8.92204 3.87176 9.22112 4.32429 9.12986L8.23175 8.04603C8.4888 7.97375 8.70691 7.78704 8.81847 7.54078L10.5569 3.64594C10.7339 3.25239 10.5563 2.79238 10.1628 2.61543L7.56857 1.60257Z'
        stroke={color}
        strokeWidth={0.8}
        strokeLinecap='round'
        strokeLinejoin='round'
      />
      <Path
        d='M5 4.5L7 4'
        stroke={color}
        strokeWidth={0.8}
        strokeLinecap='round'
        strokeLinejoin='round'
      />
      <Path
        d='M5.25 6L7.25 5.5'
        stroke={color}
        strokeWidth={0.8}
        strokeLinecap='round'
        strokeLinejoin='round'
      />
    </Svg>
  );
};

export default TicketBadgeIcon;
