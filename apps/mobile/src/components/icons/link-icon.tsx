import Svg, { Path, SvgProps } from 'react-native-svg';

const LinkIcon = (props: SvgProps) => {
  const color = props.color ?? '#E0E0E0';

  return (
    <Svg width={20} height={20} viewBox='0 0 20 20' fill='none' {...props}>
      <Path
        d='M11.768 8.232L8.23248 11.7675M8.82174 5.28572L9.411 4.69646C11.0382 3.06928 13.6764 3.06928 15.3036 4.69646C16.9307 6.32365 16.9307 8.96184 15.3036 10.589L14.7143 11.1783M5.28621 8.82125L4.69695 9.41051C3.06977 11.0377 3.06977 13.6759 4.69695 15.3031C6.32414 16.9302 8.96232 16.9302 10.5895 15.3031L11.1788 14.7138'
        stroke={color}
        strokeWidth={1.4}
        strokeLinecap='round'
        strokeLinejoin='round'
      />
    </Svg>
  );
};

export default LinkIcon;
