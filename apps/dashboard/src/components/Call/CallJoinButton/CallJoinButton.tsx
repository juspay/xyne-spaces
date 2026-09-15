import { cn } from '../../../utils/classNames';

export type CallJoinAction = 'canJoin' | 'requested' | 'requestToJoin';

interface CallJoinButtonProps {
  action: CallJoinAction;
  onJoin: () => void;
  onRequest: () => void;
  onCancelRequest?: () => void;
  isRequesting: boolean;
  isCancellingRequest?: boolean;
  /** Visual style variant */
  variant?: 'light' | 'solid' | 'text';
  /** Text to show for the join action (defaults to "Join") */
  joinLabel?: string;
  /** Static data-testid for the element */
  testId?: string;
  /** Tracking category */
  trackCategory?: string;
  /** Tracking name for join action */
  trackJoinName?: string;
  /** Tracking name for request action */
  trackRequestName?: string;
  trackCancelName?: string;
  /** Extra metadata for tracking */
  trackMetadata?: Record<string, unknown>;
  /** Additional CSS classes */
  className?: string;
  /** Disabled state */
  disabled?: boolean;
}

/**
 * Shared button component for call join / request-to-join actions.
 *
 * Renders one of three states based on the user's access level:
 * - 'canJoin'      → "Join" button (clicking triggers onJoin)
 * - 'requested'    → "Waiting..." disabled text
 * - 'requestToJoin' → "Request to Join" button (clicking triggers onRequest)
 */
export function CallJoinButton({
  action,
  onJoin,
  onRequest,
  onCancelRequest,
  isRequesting,
  isCancellingRequest = false,
  variant = 'text',
  joinLabel = 'Join',
  testId,
  trackCategory = 'CALLS',
  trackJoinName = 'JoinCall',
  trackRequestName = 'RequestToJoinCall',
  trackCancelName = 'CancelJoinRequest',
  trackMetadata,
  className,
  disabled = false,
}: CallJoinButtonProps): React.ReactElement | null {
  if (action === 'canJoin') {
    return (
      <button
        onClick={onJoin}
        disabled={disabled}
        className={cn(getVariantStyles(variant, 'canJoin'), className)}
        type='button'
        data-testid={testId}
        data-track-category={trackCategory}
        data-track-name={trackJoinName}
        {...(trackMetadata && { 'data-track-metadata': JSON.stringify(trackMetadata) })}
      >
        {joinLabel}
      </button>
    );
  }

  if (action === 'requested' || isRequesting) {
    if (action === 'requested' && onCancelRequest) {
      const waitingPillClassName = className?.split(/\s+/).includes('call-join-pill')
        ? 'call-join-pill'
        : undefined;

      return (
        <span className={cn(getRequestedGroupStyles(), className)} data-testid={testId}>
          <span className={cn(getVariantStyles(variant, 'requested'), waitingPillClassName)}>
            Waiting...
          </span>
          <button
            onClick={event => {
              event.stopPropagation();
              onCancelRequest();
            }}
            disabled={disabled || isCancellingRequest}
            className={getCancelButtonStyles(variant)}
            type='button'
            title='Stop waiting'
            data-testid={testId ? `${testId}-stop` : undefined}
            data-track-category={trackCategory}
            data-track-name={trackCancelName}
            {...(trackMetadata && { 'data-track-metadata': JSON.stringify(trackMetadata) })}
          >
            {isCancellingRequest ? 'Stopping...' : 'Stop'}
          </button>
        </span>
      );
    }

    return (
      <span
        className={cn(getVariantStyles(variant, 'requested'), 'cursor-default', className)}
        data-testid={testId}
      >
        Waiting...
      </span>
    );
  }

  // action === 'requestToJoin'
  return (
    <button
      onClick={onRequest}
      disabled={disabled}
      className={cn(getVariantStyles(variant, 'requestToJoin'), className)}
      type='button'
      data-testid={testId}
      data-track-category={trackCategory}
      data-track-name={trackRequestName}
      {...(trackMetadata && { 'data-track-metadata': JSON.stringify(trackMetadata) })}
    >
      Request to Join
    </button>
  );
}

// ─── Style helpers ───

function getVariantStyles(variant: CallJoinButtonProps['variant'], state: CallJoinAction): string {
  const base = 'text-sm font-medium transition-all';

  switch (variant) {
    case 'solid':
      return cn(
        base,
        'px-3 py-1 rounded-md',
        state === 'requested'
          ? 'bg-status-success opacity-70 text-background cursor-default'
          : 'bg-status-success hover:opacity-90 text-background',
      );

    case 'light':
      return cn(
        base,
        'hover:underline cursor-pointer',
        state === 'requested' ? 'opacity-70' : '',
        'text-white',
      );

    case 'text':
    default:
      return cn(
        base,
        'hover:opacity-90 cursor-pointer',
        state === 'requested' ? 'opacity-50 cursor-default' : '',
        'text-foreground',
      );
  }
}

function getRequestedGroupStyles(): string {
  return 'inline-flex items-center gap-2';
}

function getCancelButtonStyles(variant: CallJoinButtonProps['variant']): string {
  const base =
    'px-3 py-1 rounded-md text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

  switch (variant) {
    case 'light':
      return cn(base, 'bg-white/15 hover:bg-white/25 text-white');
    case 'solid':
    case 'text':
    default:
      return cn(base, 'bg-secondary text-secondary-foreground hover:bg-secondary/80');
  }
}
