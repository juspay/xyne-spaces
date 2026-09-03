export function withTicketChannelScope<Args extends object>(
  args: Args,
  channelId?: string,
): Args & { channelId?: string } {
  return channelId ? { ...args, channelId } : args;
}
