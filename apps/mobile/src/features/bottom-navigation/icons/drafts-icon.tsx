import * as React from 'react';
import { NAV_ICON_STROKE_WIDTH } from '../constants';
import Svg, { G, Path, type SvgProps } from 'react-native-svg';

function DraftsIcon({
  width = 24,
  height = 24,
  color = '#17181C',
  strokeWidth = NAV_ICON_STROKE_WIDTH,
  ...props
}: SvgProps): React.ReactElement {
  const stroke = props.stroke ?? color;

  return (
    <Svg width={width} height={height} viewBox='0 0 24 24' fill='none' {...props}>
      <G fill='none' stroke={stroke} strokeWidth={strokeWidth}>
        <Path
          strokeLinecap='round'
          strokeLinejoin='round'
          d='M19.75 11v-1c0-3.771 0-5.657-1.171-6.828S15.52 2 11.75 2h-1C6.98 2 5.093 2 3.922 3.172S2.75 6.229 2.75 10v4c0 3.771 0 5.657 1.172 6.828S6.979 22 10.75 22'
        />
        <Path strokeLinecap='round' d='M7.25 7h8m-8 5h8' />
        <Path
          strokeLinejoin='round'
          d='M13.25 20.827V22h1.174c.409 0 .614 0 .798-.076s.329-.221.618-.51l4.824-4.825c.273-.273.41-.41.482-.556c.139-.28.139-.61 0-.89c-.073-.147-.21-.283-.482-.556c-.274-.273-.41-.41-.557-.483a1 1 0 0 0-.89 0c-.147.073-.284.21-.556.483l-4.824 4.824c-.29.289-.434.434-.51.618s-.077.388-.077.798Z'
        />
      </G>
    </Svg>
  );
}

export default DraftsIcon;
