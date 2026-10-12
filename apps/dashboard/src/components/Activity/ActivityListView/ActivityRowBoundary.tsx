import { Component, type ErrorInfo, type ReactNode } from 'react';
import { logger, Event } from '../../../utils/logger';
import type { ActivityWithRelated } from '../../../types/activity';

interface ActivityRowBoundaryProps {
  activityId: string;
  actorAction: string;
  /** The row's activity, read only to describe a malformed one in the log. */
  activity?: ActivityWithRelated | undefined;
  /** Where this row's data came from — `cache` implicates the persisted store. */
  dataSource?: 'cache' | 'fresh' | 'unknown' | undefined;
  children: ReactNode;
}

// Keyed on the row's data, not the render, so a row that stays broken settles
// instead of retrying in a loop.
const dataSignature = (activity: ActivityWithRelated | undefined): string =>
  activity
    ? `${activity.updatedAt ?? ''}|${activity.message?.messageId ?? ''}|${typeof activity.message?.content}`
    : '';

interface ActivityRowBoundaryState {
  hasError: boolean;
}

/**
 * Last-resort isolation for a single Activity feed row.
 *
 * A net, not a fix — the real fixes are the cache version stamp and the nullable
 * preview helpers. What this adds is the diagnosis the crash reports lacked: the
 * router boundary swallowed every stack trace, so there was no record of which
 * field was missing or where the row came from. It logs the row's shape, never
 * its content.
 */
export class ActivityRowBoundary extends Component<
  ActivityRowBoundaryProps,
  ActivityRowBoundaryState
> {
  override state: ActivityRowBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ActivityRowBoundaryState {
    return { hasError: true };
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    const { activity, activityId, actorAction, dataSource } = this.props;
    const message = activity?.message;

    logger.error(Event.FRONTEND_ERROR, {
      type: 'activity_row_render_error',
      error,
      message: error.message,
      errorName: error.name,
      stack: error.stack,
      componentStack: errorInfo.componentStack,
      activityId,
      actorAction,
      // Shape, never content: enough to name the missing field without putting
      // message bodies into logs.
      dataSource: dataSource ?? 'unknown',
      activityKeys: activity ? Object.keys(activity).sort().join(',') : null,
      messageKeys: message ? Object.keys(message).sort().join(',') : null,
      messageContentType: message ? typeof message.content : 'no-message',
      hasConversation: message ? Boolean(message.conversation) : false,
    });
  }

  override componentDidUpdate(prevProps: ActivityRowBoundaryProps): void {
    if (!this.state.hasError) return;
    // Virtuoso recycles row containers; reset when the row now holds a different activity.
    if (prevProps.activityId !== this.props.activityId) {
      this.setState({ hasError: false });
      return;
    }
    // Same row, new data — usually the missing field arriving. Retry once.
    if (dataSignature(prevProps.activity) !== dataSignature(this.props.activity)) {
      this.setState({ hasError: false });
    }
  }

  override render(): ReactNode {
    if (this.state.hasError) return null;
    return this.props.children;
  }
}
