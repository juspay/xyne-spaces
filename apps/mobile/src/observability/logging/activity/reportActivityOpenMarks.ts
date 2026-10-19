import {
  getPendingActivityOpenTarget,
  markActivityChatSkeletonShown,
  markActivityListReady,
  markActivityMessageHighlighted,
  type ActivityOpenTarget,
} from './activityOpen';

type TargetMatch = Readonly<{
  channelId?: string;
  messageId?: string;
}>;

function matchesPendingTarget(target: ActivityOpenTarget, match: TargetMatch | undefined): boolean {
  if (match?.channelId !== undefined && match.channelId !== target.channelId) return false;
  if (
    match?.messageId !== undefined &&
    target.messageId !== undefined &&
    match.messageId !== target.messageId
  ) {
    return false;
  }
  return true;
}

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

export function reportActivityChatSkeletonShown(match?: TargetMatch): void {
  const target = getPendingActivityOpenTarget();
  if (target === null || !matchesPendingTarget(target, match)) return;
  markActivityChatSkeletonShown(nowMs());
}

export function reportActivityListReady(match?: TargetMatch): void {
  const target = getPendingActivityOpenTarget();
  if (target === null || !matchesPendingTarget(target, match)) return;
  markActivityListReady(nowMs());
}

export function reportActivityMessageHighlighted(match?: TargetMatch): void {
  const target = getPendingActivityOpenTarget();
  if (target === null || !matchesPendingTarget(target, match)) return;
  markActivityMessageHighlighted(nowMs());
}
