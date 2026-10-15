import Svg, { Path, SvgProps } from 'react-native-svg';

const BookmarkIcon = (props: SvgProps) => {
  const color = props.color ?? '#E0E0E0';

  return (
    <Svg width={20} height={20} viewBox='0 0 20 20' fill='none' {...props}>
      <Path
        d='M4.16797 7.49984C4.16797 5.94877 4.16797 5.17324 4.3719 4.5456C4.78406 3.27711 5.77857 2.28259 7.04706 1.87044C7.6747 1.6665 8.45023 1.6665 10.0013 1.6665C11.5524 1.6665 12.3279 1.6665 12.9555 1.87044C14.224 2.28259 15.2185 3.27711 15.6307 4.5456C15.8346 5.17324 15.8346 5.94877 15.8346 7.49984V18.3332L14.3399 17.052C12.8 15.7321 12.0301 15.0721 11.1666 14.8206C10.4055 14.5989 9.59706 14.5989 8.83601 14.8206C7.97253 15.0721 7.20258 15.7321 5.66269 17.052L4.16797 18.3332V7.49984Z'
        stroke={color}
        strokeWidth={1.4}
        strokeLinecap='round'
        strokeLinejoin='round'
      />
    </Svg>
  );
};

export default BookmarkIcon;
