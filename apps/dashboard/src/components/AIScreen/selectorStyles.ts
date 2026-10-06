/**
 * Row style shared by the composer's agent and model menus, so the two read as
 * one control rather than two that happen to look similar. Lives here rather
 * than in either component: it belongs to neither, and importing a style
 * constant from a sibling component made ModelThinkingSelector depend on
 * AIAgentSelector for no behavioural reason.
 */
export const SELECTOR_ROW_CLASS =
  'flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left text-sm text-foreground transition-colors hover:bg-accent';

/**
 * Selected row. Same tint as hover on purpose — the check mark beside the
 * label is what says "this one is picked", so the two states never need to
 * differ by colour.
 */
export const SELECTOR_ROW_SELECTED_CLASS = 'bg-accent';
