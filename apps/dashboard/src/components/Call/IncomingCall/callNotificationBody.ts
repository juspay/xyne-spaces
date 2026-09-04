import type {
  IncomingCallContextKind,
  IncomingCallPlace,
  IncomingCallViewModel,
} from './IncomingCallCard.types';

/**
 * Body text for the desktop OS call notification.
 *
 * Scheduled calls say where they are, in the same shape as the modal's context
 * line but with this notification's own copy for a group DM (`group`, not
 * `group DM`). Every other kind reads as `<inviter> is inviting you to a call`.
 *
 * Built from the view model's structured `kind` and `place` -- never from the
 * modal's rendered `text` -- so a wording change on the card cannot silently
 * change (or break) what the notification says.
 *
 * Kept free of runtime imports on purpose: it is unit-tested in isolation.
 */

function scheduledPrefix(kind: IncomingCallContextKind): string | null {
  switch (kind) {
    case 'scheduled':
    case 'calendar':
      return 'Scheduled call';
    case 'scheduled-thread':
      return 'Scheduled thread call';
    default:
      return null;
  }
}

function describePlace(place: IncomingCallPlace): string | null {
  if (!place) {
    return null;
  }
  return place.kind === 'channel' ? `#${place.name}` : 'group';
}

export function buildCallNotificationBody(
  vm: Pick<IncomingCallViewModel, 'context'>,
  callerName: string,
): string {
  const prefix = scheduledPrefix(vm.context.kind);
  if (!prefix) {
    return `${callerName} is inviting you to a call`;
  }
  const place = describePlace(vm.context.place);
  return place ? `${prefix} in ${place}` : prefix;
}
