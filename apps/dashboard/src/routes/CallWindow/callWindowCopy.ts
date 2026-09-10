import type {
  IncomingCallContextVM,
  IncomingCallPlace,
  IncomingCallViewModel,
} from '../../components/Call/IncomingCall/IncomingCallCard.types';
import { formatCallPlace } from '../../components/Call/IncomingCall/IncomingCallCard.utils';

export interface CallWindowCopy {
  context: IncomingCallContextVM | null;
  name: string;
  subtitle: string | null;
  windowLine: string;
}

const composeWindowLine = (
  context: IncomingCallContextVM | null,
  name: string,
  preposition: 'from' | 'with',
): string => {
  if (!name) return context?.text ?? 'Call';
  if (!context || context.kind === 'direct' || context.kind === 'unknown') {
    return `Call ${preposition} ${name}`;
  }
  return `${context.text} ${preposition} ${name}`;
};

export interface OutgoingCallTarget {
  displayName: string | null;
  channelName: string | null;
  isDm: boolean;
  isGroupDm: boolean;
  conversationId: string | null;
}

function describeOutgoing(target: OutgoingCallTarget): {
  context: IncomingCallContextVM | null;
  name: string;
  windowLine: string;
} {
  const { displayName, channelName, isDm, isGroupDm, conversationId } = target;
  const place: IncomingCallPlace = channelName
    ? { kind: 'channel', name: channelName }
    : isGroupDm
      ? { kind: 'group-dm' }
      : null;
  const placeText = place ? formatCallPlace(place) : null;
  const fallbackName = displayName ?? 'Start call';

  if (conversationId) {
    return {
      context: {
        kind: 'thread',
        icon: 'thread',
        place,
        text: placeText ? `Thread call in ${placeText}` : 'Thread call',
      },
      name: placeText ?? fallbackName,
      windowLine: placeText ? `Starting a thread call in ${placeText}` : 'Starting a thread call',
    };
  }

  if (channelName && !isDm) {
    return {
      context: { kind: 'channel', icon: 'hash', place, text: `Call in #${channelName}` },
      name: `#${channelName}`,
      windowLine: `Starting a call in #${channelName}`,
    };
  }

  if (isGroupDm) {
    return {
      context: { kind: 'group', icon: 'users', place: { kind: 'group-dm' }, text: 'Group call' },
      name: fallbackName,
      windowLine: displayName
        ? `Starting a group call with ${displayName}`
        : 'Starting a group call',
    };
  }

  return {
    context: null,
    name: fallbackName,
    windowLine: displayName ? `Calling ${displayName}` : 'Start call',
  };
}

interface DescribeInput {
  vm: IncomingCallViewModel | null;
  isRinging: boolean;
  isNewCall: boolean;
  outgoing: OutgoingCallTarget;
}

export function describeCallWindow(input: DescribeInput): CallWindowCopy {
  const { vm, isRinging, isNewCall, outgoing } = input;

  if (isNewCall) {
    const described = describeOutgoing(outgoing);
    return { ...described, subtitle: null };
  }

  if (!vm) {
    return { context: null, name: 'Join call', subtitle: null, windowLine: 'Join call' };
  }

  return {
    context: vm.context,
    name: vm.name,
    subtitle: vm.subtitle,
    windowLine: composeWindowLine(vm.context, vm.name, isRinging ? 'from' : 'with'),
  };
}
