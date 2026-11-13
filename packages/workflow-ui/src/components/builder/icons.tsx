/**
 * v2/icons — Centralized icon registry keyed by ICON NAME from backend.
 *
 * Components call getStepIcon(iconName) — never check step type.
 * Icon names come from StepSummary.icon / TriggerSummary.icon provided by the backend.
 */

import type React from 'react';

export interface IconProps {
  size?: number;
  className?: string;
}

type IconComponent = (props: IconProps) => React.ReactElement;

const ICON_MAP: Record<string, IconComponent> = {
  // Step icons
  filter: ({ size = 16, className }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M3 6h18"/><path d="M7 12h10"/><path d="M10 18h4"/>
    </svg>
  ),
  code: ({ size = 16, className }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>
    </svg>
  ),
  'file-spreadsheet': ({ size = 16, className }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8"/><path d="M8 17h8"/><path d="M11 11v8"/>
    </svg>
  ),
  globe: ({ size = 16, className }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
    </svg>
  ),
  repeat: ({ size = 16, className }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M17 2l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>
    </svg>
  ),
  columns: ({ size = 16, className }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M8 3v18"/><path d="M16 3v18"/><path d="M3 8h4"/><path d="M3 16h4"/><path d="M17 8h4"/><path d="M17 16h4"/>
    </svg>
  ),
  clock: ({ size = 16, className }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
    </svg>
  ),
  'copy-check': ({ size = 16, className }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="2" y="6" width="13" height="13" rx="2"/><path d="M9 2h9a2 2 0 0 1 2 2v9"/><path d="m15 11-4 4-2-2"/>
    </svg>
  ),
  'git-branch': ({ size = 16, className }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M12 3v6"/><path d="M12 15v6"/><circle cx="12" cy="12" r="3"/><path d="M3 12h6"/><path d="M15 12h6"/>
    </svg>
  ),
  'git-fork': ({ size = 16, className }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M6 3v12"/><path d="m18 9-6 6-6-6"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="6" r="3"/>
    </svg>
  ),

  // Connector icons
  hammer: ({ size = 16, className }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="m15 12-8.373 8.373a1 1 0 1 1-3-3L12 9"/><path d="m18 15 4-4"/><path d="m21.5 11.5-1.914-1.914A2 2 0 0 1 19 8.172V7l-2.26-1.26a6 6 0 0 0-2.507-.93l-3.887-.785.886.887a6 6 0 0 1 1.567 2.753L13.5 9.5l1.914 1.914A2 2 0 0 1 16 12.828V14l1.5 1.5"/>
    </svg>
  ),
  blocks: ({ size = 16, className }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect width="7" height="7" x="14" y="3" rx="1"/><path d="M10 21V8a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-5a1 1 0 0 0-1-1H3"/>
    </svg>
  ),
  bot: ({ size = 16, className }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/>
    </svg>
  ),

  // Trigger icons
  cursor: ({ size = 16, className }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
    </svg>
  ),
  satellite: ({ size = 16, className }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M18 16.98h1a2 2 0 0 0 1.94-2.48L19.6 8.27a2 2 0 0 0-1.94-1.52H6.34a2 2 0 0 0-1.94 1.52L3.06 14.5A2 2 0 0 0 5 16.98h1"/>
      <path d="M12 17v5"/><circle cx="12" cy="12" r="4"/>
    </svg>
  ),
  timer: ({ size = 16, className }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
    </svg>
  ),
  bell: ({ size = 16, className }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>
    </svg>
  ),

  // Fallback
  zap: ({ size = 16, className }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
    </svg>
  ),
};

/**
 * Get an icon component by name (from backend StepSummary.icon / TriggerSummary.icon).
 * Returns a fallback icon for unknown names.
 */
export function getIcon(iconName?: string, props: IconProps = {}): React.ReactElement {
  const Icon = iconName ? ICON_MAP[iconName] : undefined;
  if (Icon) return <Icon {...props} />;
  return ICON_MAP['zap']!(props);
}

/**
 * Get a step icon by name — alias for getIcon.
 */
export function getStepIcon(iconName?: string, props: IconProps = {}): React.ReactElement {
  return getIcon(iconName, props);
}

/**
 * Get a trigger icon by name — alias for getIcon.
 */
export function getTriggerIcon(iconName?: string, props: IconProps = {}): React.ReactElement {
  return getIcon(iconName, props);
}
