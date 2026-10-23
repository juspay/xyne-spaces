/**
 * Clear space between the button and the top of the bottom bar.
 *
 * The button is drawn by a screen, the bar by the shell, so nothing lays
 * these two out together — this is the only thing keeping them apart.
 */
export const FAB_GAP = 12;

/** Between the lowest action pill and the button. */
export const FAB_ACTIONS_GAP = 12;

/** Between pills. */
export const FAB_ACTION_SPACING = 12;

/**
 * The entrance spring, taken unchanged from the reference this animation
 * copies. Its comment there says damping 40 / stiffness 300; its code says
 * 120 / 1000, and the code is what produces the motion.
 */
export const FAB_SPRING = { damping: 120, stiffness: 1000 } as const;

/** How far a pill sits to the right of its resting place while closed. */
export const FAB_SLIDE_X = 20;
