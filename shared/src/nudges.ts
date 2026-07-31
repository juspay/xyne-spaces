export type NudgeActionMode = 'read' | 'write';
export type NudgeActionSuccess = 'none' | 'acted_on' | 'dismissed';
export type SurfaceAreaIdField = 'messageId' | 'ticketId' | 'canvasId' | 'callId' | 'conversationId';
export type NudgeAudienceScope = 'user' | 'channel' | 'generic';

export interface NudgeActionBehavior {
  actionMode: NudgeActionMode;
  onSuccess: NudgeActionSuccess;
  createSurfaceLink: boolean;
}

export function getNudgeActionBehavior(actions: unknown): NudgeActionBehavior {
  const payload =
    actions && typeof actions === 'object' && !Array.isArray(actions)
      ? (actions as Record<string, unknown>)
      : {};
  const actionType =
    typeof payload['actionType'] === 'string' ? payload['actionType'] : undefined;

  const defaults = (() => {
    switch (actionType) {
      case 'OPEN_RELATED_MESSAGE':
      case 'OPEN_TICKET':
        return {
          actionMode: 'read' as const,
          onSuccess: 'none' as const,
          createSurfaceLink: false,
        };
      case 'CREATE_TICKET_FROM_MESSAGE':
        return {
          actionMode: 'write' as const,
          onSuccess: 'acted_on' as const,
          createSurfaceLink: true,
        };
      default:
        return {
          actionMode: 'write' as const,
          onSuccess: 'acted_on' as const,
          createSurfaceLink: true,
        };
    }
  })();

  const actionMode =
    payload['actionMode'] === 'read' || payload['actionMode'] === 'write'
      ? payload['actionMode']
      : defaults.actionMode;
  const onSuccess =
    payload['onSuccess'] === 'none' ||
    payload['onSuccess'] === 'acted_on' ||
    payload['onSuccess'] === 'dismissed'
      ? payload['onSuccess']
      : defaults.onSuccess;
  const createSurfaceLink =
    typeof payload['createSurfaceLink'] === 'boolean'
      ? payload['createSurfaceLink']
      : defaults.createSurfaceLink;

  return { actionMode, onSuccess, createSurfaceLink };
}

export function getSurfaceAreaIdField(
  surfaceAreaType: string,
): SurfaceAreaIdField | null {
  switch (surfaceAreaType) {
    case 'MESSAGE':
      return 'messageId';
    case 'TICKET':
      return 'ticketId';
    case 'CANVAS':
      return 'canvasId';
    case 'CALL':
      return 'callId';
    case 'CONVERSATION':
      return 'conversationId';
    default:
      return null;
  }
}

export function buildSurfaceNudgeCountRowId(params: {
  sourceType: string;
  sourceId: string;
  scope: NudgeAudienceScope;
  audienceId: string;
  gidType?: string | null;
}): string {
  const { sourceType, sourceId, scope, audienceId, gidType } = params;
  if (scope === 'generic' && gidType) {
    return `snc:${scope}:${gidType}:${audienceId}:${sourceType}:${sourceId}`;
  }
  return `snc:${scope}:${audienceId}:${sourceType}:${sourceId}`;
}
