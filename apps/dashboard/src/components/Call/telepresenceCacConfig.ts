/**
 * CAC key: "xyne_telepresence_config"
 *
 * Feature flag for the telepresence/presentation mode button in calls.
 * Controls both the master enable switch and the list of users allowed to use it.
 *
 * Toggle from Superposition CAC:
 *   key:   xyne_telepresence_config
 *   value: { "enabled": true, "allowedEmails": ["user@example.com"] }
 *
 * For local dev without Superposition, temporarily set enabled: true
 * in DEFAULT_TELEPRESENCE_CAC_CONFIG and add your email to allowedEmails.
 */

export const TELEPRESENCE_CAC_KEY = 'xyne_telepresence_config';

export interface TelepresenceCacConfig {
  enabled: boolean;
  allowedEmails: string[];
}

export const DEFAULT_TELEPRESENCE_CAC_CONFIG: TelepresenceCacConfig = {
  enabled: false,
  allowedEmails: [],
};

// Hardcoded flag for the "Enable Xyne Telepresence" toggle button shown in presentation mode.
export const isTelepresenceToggleEnable = false;
