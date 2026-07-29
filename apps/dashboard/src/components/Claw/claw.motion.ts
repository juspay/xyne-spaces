import type { Transition, Variants } from 'framer-motion';

export const OPEN_SPRING: Transition = { type: 'spring', stiffness: 400, damping: 30, mass: 1 };
export const CLOSE_SPRING: Transition = { type: 'spring', stiffness: 500, damping: 40 };

export const contentGroupVariants: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { duration: 0.22, ease: [0, 0, 0.2, 1] } },
  exit: { opacity: 0, y: 4, transition: { duration: 0.1, ease: [0.4, 0, 1, 1] } },
};
