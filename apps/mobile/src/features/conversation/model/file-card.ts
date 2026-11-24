import { formatFileSize } from '@/src/components/chat/message/message-attachments.utils';

/** "PDF · 1.2 MB · Name" under a file's title; the size and sender drop out when unknown. */
export function fileCardSubtitle(
  typeLabel: string,
  sizeBytes: number | null | undefined,
  senderName: string,
): string {
  const size = typeof sizeBytes === 'number' && sizeBytes > 0 ? formatFileSize(sizeBytes) : '';
  return [typeLabel, size, senderName].filter(Boolean).join(' · ');
}
