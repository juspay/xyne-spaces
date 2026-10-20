/** "PDF · Name" under a file's title. */
export function fileCardSubtitle(typeLabel: string, senderName: string): string {
  return senderName ? `${typeLabel} · ${senderName}` : typeLabel;
}
