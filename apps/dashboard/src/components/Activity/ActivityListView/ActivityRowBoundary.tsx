import { Component, type ErrorInfo, type ReactNode } from 'react';
import { logger, Event } from '../../../utils/logger';
import type { ActivityWithRelated } from '../../../types/activity';

interface ActivityRowBoundaryProps {
  activityId: string;
  actorAction: string;
  /** The row's activity, read only to describe a malformed one in the log. */
  activity?: ActivityWithRelated | undefined;
  /** Where this row's data came from — `cache` implicates the persisted store. */
  dataSource?: 'cache' | 'fresh' | undefined;
  children: ReactNode;
}

interface ActivityRowBoundaryState {
  hasError: boolean;
}

/**
 * Last-resort isolation for a single Activity feed row.
 *
 * This is a net, not a fix. Row-level errors in this feed came from malformed
 * data reaching render, and the fixes for that live upstream — a version stamp
 * on persisted cache entries, a field-wise conversation merge, and nullable
 * contracts on the preview helpers. What this adds is the diagnosis the original
 * crash reports lacked: the router boundary swallowed every stack trace, so
 * there was no record of *which* field was missing or where the row came from.
 *
 * It logs the shape of the offending row — the key sets of the activity and its
 * message relation, plus whether the row was served from the persisted cache —
 * which is exactly what identifies the producer of a partial row. Keep it until
 * `activity_row_render_error` goes quiet in production; a silent feed would hide
 * the next regression of this class rather than surfacing it.
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
    // Virtuoso recycles row containers; reset when the row now holds a different activity.
    if (this.state.hasError && prevProps.activityId !== this.props.activityId) {
      this.setState({ hasError: false });
    }
  }

  override render(): ReactNode {
    if (this.state.hasError) return null;
    return this.props.children;
  }
}
