import { memo, type ReactElement } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { xyneCalendarSidebarMotionVariants } from './xyneCalendarSidebar.utils';

interface XyneCalendarSidebarProps {
  open: boolean;
}

const XyneCalendarSidebarComponent = ({ open }: XyneCalendarSidebarProps): ReactElement => {
  const shouldReduceMotion = useReducedMotion();

  return (
    <motion.aside
      aria-label='Calendar'
      className='h-full w-full bg-transparent'
      initial={shouldReduceMotion ? false : 'hidden'}
      animate={open ? 'visible' : 'hidden'}
      variants={xyneCalendarSidebarMotionVariants}
    />
  );
};

export const XyneCalendarSidebar = memo(XyneCalendarSidebarComponent);

XyneCalendarSidebar.displayName = 'XyneCalendarSidebar';
