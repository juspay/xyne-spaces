export interface TokenGroup {
  label: string;
  tokens: string[];
}

/**
 * Every CSS custom property declared on `:root` / `[data-theme="…"]` in
 * global.css, grouped by name prefix. Names only — values are always read
 * live via getComputedStyle so this list never goes stale on its own, but if
 * a token is renamed or removed in global.css it needs updating here too.
 *
 * Verified against global.css: the four theme blocks (`:root` L8, "classic"
 * L22, "summer_breeze" L146, "midnight" L262) plus three smaller `:root` /
 * `[data-theme="midnight"]` blocks that add BlockNote editor tokens (L2127),
 * and Xyne semantic tokens (L4031, overridden for midnight at L4047).
 */
export const TOKEN_GROUPS: TokenGroup[] = [
  {
    label: 'Core & Semantic Surfaces',
    tokens: [
      '--background',
      '--foreground',
      '--card',
      '--card-foreground',
      '--popover',
      '--popover-foreground',
      '--primary',
      '--primary-foreground',
      '--secondary',
      '--secondary-foreground',
      '--muted',
      '--muted-foreground',
      '--accent',
      '--accent-foreground',
      '--destructive',
      '--destructive-foreground',
      '--border',
      '--input',
      '--ring',
      '--radius',
    ],
  },
  {
    label: 'Sidebar',
    tokens: [
      '--sidebar',
      '--sidebar-foreground',
      '--sidebar-primary',
      '--sidebar-primary-foreground',
      '--sidebar-accent',
      '--sidebar-accent-foreground',
      '--sidebar-border',
      '--sidebar-accent-ring',
      '--sidebar-avatar-ring',
      '--sidebar-background-blur',
    ],
  },
  {
    label: 'Status',
    tokens: [
      '--status-new',
      '--status-pending',
      '--status-scheduled',
      '--status-success',
      '--status-failure',
      '--status-paused',
    ],
  },
  {
    label: 'Stage',
    tokens: [
      '--stage-todo-bg',
      '--stage-todo-border',
      '--stage-completed-bg',
      '--stage-completed-border',
      '--stage-cancelled-bg',
      '--stage-cancelled-border',
    ],
  },
  {
    label: 'Chart / Graph',
    tokens: ['--chart-1', '--chart-2', '--chart-3', '--chart-4', '--chart-5'],
  },
  {
    label: 'Xyne Semantic (color-xyne-*)',
    tokens: [
      '--color-xyne-surface',
      '--color-xyne-surface-subtle',
      '--color-xyne-surface-sunken',
      '--color-xyne-fg-primary',
      '--color-xyne-fg-secondary',
      '--color-xyne-fg-tertiary',
      '--color-xyne-fg-muted',
      '--color-xyne-fg-inverse',
      '--color-xyne-border-subtle',
      '--color-xyne-border',
      '--color-xyne-border-strong',
      '--color-xyne-brand',
      '--color-xyne-brand-ghost',
    ],
  },
  {
    label: 'Action',
    tokens: ['--action-primary', '--action-accent', '--action-primary-foreground'],
  },
  {
    label: 'Navigation',
    tokens: [
      '--nav-active-icon',
      '--nav-disabled-icon',
      '--nav-icon-seperator',
      '--nav-search-btn-bg',
      '--nav-search-btn-text',
    ],
  },
  {
    label: 'Mention',
    tokens: [
      '--mention-color',
      '--mention-hover-color',
      '--mention-bg',
      '--mention-current-user-bg',
      '--mention-current-user-color',
      '--mention-channel-bg',
      '--mention-channel-hover-bg',
      '--mention-group-color',
    ],
  },
  {
    label: 'Desk Settings',
    tokens: [
      '--desk-helper-foreground',
      '--desk-muted-foreground',
      '--desk-border',
      '--desk-accent',
      '--desk-accent-hover',
      '--desk-accent-subtle',
      '--desk-accent-foreground',
      '--desk-accent-badge-bg',
      '--desk-destructive',
      '--desk-switch-track-off',
    ],
  },
  {
    label: 'Claw AI Accent',
    tokens: [
      '--claw-ai-fg',
      '--claw-ai-fg-muted',
      '--claw-ai-surface',
      '--claw-ai-border',
      '--claw-ai-solid',
      '--claw-ai-solid-hover',
    ],
  },
  {
    label: 'PR Badge',
    tokens: [
      '--pr-badge-created-bg',
      '--pr-badge-created-fg',
      '--pr-badge-merged-bg',
      '--pr-badge-merged-fg',
      '--pr-badge-danger-bg',
      '--pr-badge-danger-fg',
    ],
  },
  {
    label: 'Plan Chip',
    tokens: ['--plan-chip-approved-bg', '--plan-chip-approved-fg'],
  },
  {
    label: 'Wallpaper',
    tokens: [
      '--wallpaper-image',
      '--wallpaper-overlay',
      '--wallpaper-overlay-opacity',
      '--wallpaper-overlay-blur',
    ],
  },
  {
    label: 'BlockNote Editor (bn-colors-*)',
    tokens: [
      '--bn-colors-editor-text',
      '--bn-colors-editor-background',
      '--bn-colors-menu-text',
      '--bn-colors-menu-background',
      '--bn-colors-tooltip-text',
      '--bn-colors-tooltip-background',
      '--bn-colors-hovered-text',
      '--bn-colors-hovered-background',
      '--bn-colors-selected-text',
      '--bn-colors-selected-background',
      '--bn-colors-disabled-text',
      '--bn-colors-disabled-background',
      '--bn-colors-shadow',
      '--bn-colors-border',
      '--bn-colors-side-menu',
    ],
  },
  {
    label: 'Theme Preview',
    tokens: [
      '--theme-preview-classic',
      '--theme-preview-summer_breeze',
      '--theme-preview-midnight',
    ],
  },
  {
    label: 'Other',
    tokens: [
      '--root-bg',
      '--root-border',
      '--metrics-bar-color',
      '--metrics-bar-divider',
      '--update-btn-bg',
      '--update-btn-text',
      '--call-action-button-color',
      '--chat-mobile-my-bubble',
      '--search-result-highlight-bg',
      '--search-result-active-bg',
      '--link-color',
      '--link-hover-color',
      '--mobile-panel-bg',
      '--ticket-accent',
    ],
  },
];
