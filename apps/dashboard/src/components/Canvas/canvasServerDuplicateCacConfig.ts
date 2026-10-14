import { useCacConfig } from '@xyne/shared/hooks';

/**
 * CAC key: "canvas_server_duplicate_config"
 *
 * Routes "Duplicate" and "Make a copy" of a canvas version through
 * POST /canvas/:canvasId/duplicate, which copies the live collaborative
 * content and the canvas's attachments on the server. While this is off, both
 * fall back to creating the copy client-side from the canvas row.
 *
 * On by default; Superposition CAC is the kill switch:
 *   key:   canvas_server_duplicate_config
 *   value: { "enabled": false, "allowedEmails": [] }
 *
 * With enabled: true, a non-empty allowedEmails narrows it to those users; an
 * EMPTY list means every user in the workspace.
 */

export const CANVAS_SERVER_DUPLICATE_CAC_KEY = 'canvas_server_duplicate_config';

export interface CanvasServerDuplicateCacConfig {
  enabled: boolean;
  allowedEmails: string[];
}

export const DEFAULT_CANVAS_SERVER_DUPLICATE_CAC_CONFIG: CanvasServerDuplicateCacConfig = {
  enabled: true,
  allowedEmails: [],
};

export function useCanvasServerDuplicateEnabled(userEmail: string | null | undefined): boolean {
  const { config } = useCacConfig<CanvasServerDuplicateCacConfig>({
    key: CANVAS_SERVER_DUPLICATE_CAC_KEY,
    fallbackConfig: DEFAULT_CANVAS_SERVER_DUPLICATE_CAC_CONFIG,
  });

  if (!config.enabled) return false;
  const allowed = config.allowedEmails ?? [];
  if (allowed.length === 0) return true;

  const normalizedEmail = userEmail?.toLowerCase();
  return !!normalizedEmail && allowed.some(e => e.toLowerCase() === normalizedEmail);
}
