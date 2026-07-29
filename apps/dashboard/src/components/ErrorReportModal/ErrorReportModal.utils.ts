export const MAX_ERROR_REPORT_ATTACHMENTS = 9;
export const MAX_ATTACHMENT_SIZE_BYTES = 1024 * 1024 * 1024; // 1 GB

export const getTicketsPath = (
  channelId: string,
  boardId?: string | null,
  userId?: string | null,
): string => {
  const params = new URLSearchParams({
    tab: 'tickets',
    viewType: 'stage',
    layout: 'table',
    tags: 'Support Ticket',
    ...(boardId && { board: boardId }),
    ...(userId && { createdBy: userId }),
  });
  return `/chat/dir/${channelId}?${params.toString()}`;
};
