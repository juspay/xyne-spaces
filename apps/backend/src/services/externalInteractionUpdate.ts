export interface ExternalInteractionEmailSnapshot {
  subject: string;
  body: string;
  from: string;
  externalThreadId: string;
  externalMessageId: string;
  type: string;
  sentByUserId: string | null;
  rating: number | null;
  clientVersionName: string | null;
  clientVersionCode: string | null;
}

export function hasExternalInteractionEmailChanged(
  current: ExternalInteractionEmailSnapshot,
  next: ExternalInteractionEmailSnapshot,
): boolean {
  return (
    current.subject !== next.subject ||
    current.body !== next.body ||
    current.from !== next.from ||
    current.externalThreadId !== next.externalThreadId ||
    current.externalMessageId !== next.externalMessageId ||
    current.type !== next.type ||
    current.sentByUserId !== next.sentByUserId ||
    current.rating !== next.rating ||
    current.clientVersionName !== next.clientVersionName ||
    current.clientVersionCode !== next.clientVersionCode
  );
}

export function hasExternalInteractionTicketChanged(
  current: {
    title: string;
    description: string;
  } | null,
  next: {
    title: string;
    description: string;
  },
): boolean {
  if (!current) return false;
  return current.title !== next.title || current.description !== next.description;
}
