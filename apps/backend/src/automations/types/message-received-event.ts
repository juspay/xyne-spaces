export const MESSAGE_RECEIVED_EVENT = 'MESSAGE_RECEIVED';

export const MessageLocation = {
  NEW_CONVERSATION: 'New conversation',
  THREAD_REPLY: 'Thread reply',
  ANY: 'Any message',
} as const;

export type MessageLocation = (typeof MessageLocation)[keyof typeof MessageLocation];
export type MessageEventLocation = Exclude<MessageLocation, typeof MessageLocation.ANY>;

export function messageLocationMatches(
  configuredLocation: unknown,
  eventLocation: MessageEventLocation | undefined,
): boolean {
  const configured = Object.values(MessageLocation).includes(configuredLocation as MessageLocation)
    ? (configuredLocation as MessageLocation)
    : MessageLocation.NEW_CONVERSATION;
  const event = eventLocation ?? MessageLocation.NEW_CONVERSATION;
  return configured === MessageLocation.ANY || configured === event;
}
