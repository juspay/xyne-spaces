import { type RouteQuery, type appsChannelCommands } from '@xyne/shared';
import { CommandAccessibility, CommandType } from '@/database/repositories/appCommandRepository';
import { appCommandRepository, internal } from '../dashboard.helpers';

/** GET /apps/channel/:channelId/commands: commands or shortcuts available in a channel (shortcuts carry appName). */
export async function listChannelCommands(input: {
  params: { channelId: string };
  query: RouteQuery<typeof appsChannelCommands>;
}) {
  const { commandType, commandAccessibility } = input.query;
  const filter: { commandType: CommandType; commandAccessibility?: CommandAccessibility } = { commandType: commandType as CommandType };
  if (commandAccessibility && Object.values(CommandAccessibility).includes(commandAccessibility as CommandAccessibility)) {
    filter.commandAccessibility = commandAccessibility as CommandAccessibility;
  }
  try {
    // Shortcuts need appName for the picker UI; commands don't
    return commandType === CommandType.SHORTCUT
      ? await appCommandRepository.findByChannelIdWithAppName(input.params.channelId, filter)
      : await appCommandRepository.findByChannelId(input.params.channelId, filter);
  } catch (error) {
    throw internal(error, '[COMMANDS] getChannelCommands error:');
  }
}