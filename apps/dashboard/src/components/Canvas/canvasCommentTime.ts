export const formatRelativeCommentTime = (timestamp?: number): string => {
  if (!timestamp) return '';
  const diffMs = Date.now() - timestamp;
  if (diffMs < 60_000) return 'Just now';

  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;

  const commentDate = new Date(timestamp);
  const shouldShowYear = commentDate.getFullYear() !== new Date().getFullYear();

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    ...(shouldShowYear && { year: 'numeric' }),
  }).format(commentDate);
};
