import { logger } from '@/utils/logger';
import { botRegistry } from '@/bots/core/bot-registry';

export interface BotCommand {
  botName: string;
  parameters: Record<string, string>;
  rawCommand: string;
}

export interface ParsedBotCommand {
  botName: string;
  validatedInput: any;
  inputFlowJson: string;
  rawCommand: string;
}

export class BotCommandParser {
  private static readonly BOT_COMMAND_REGEX = /\/([a-zA-Z-]+)\s+(.*)/;
  private static readonly PARAM_REGEX = /--(\w+)\s+(?:"([^"]*)"|'([^']*)'|([^\s]+))/g;

  static parseMessage(content: string): BotCommand | null {
    try {
      // Strip HTML tags first, then trim
      const strippedContent = content.replace(/<[^>]*>/g, '').trim();
      logger.info('🔍 [BOT-PARSER] parseMessage called with:', content, '-> stripped:', strippedContent);

      if (!strippedContent.startsWith('/')) {
        logger.info('❌ [BOT-PARSER] Content does not start with /, returning null');
        return null;
      }

      const match = strippedContent.match(this.BOT_COMMAND_REGEX);
      if (!match) {
        logger.info('❌ [BOT-PARSER] Regex match failed, returning null');
        return null;
      }

      const botName = match[1];
      const paramString = match[2];
      logger.info('✅ [BOT-PARSER] Parsed bot name:', botName, 'params:', paramString);

      // Parse parameters as strings only
      const parameters: Record<string, string> = {};
      let paramMatch;

      while ((paramMatch = this.PARAM_REGEX.exec(paramString)) !== null) {
        const key = paramMatch[1];
        // Get value from quoted or unquoted capture groups
        const value = paramMatch[2] || paramMatch[3] || paramMatch[4];
        parameters[key] = value;
      }

      const result = {
        botName,
        parameters,
        rawCommand: strippedContent  // Use stripped content for consistency
      };
      logger.info('✅ [BOT-PARSER] Final parsed result:', result);
      return result;
    } catch (error) {
      logger.info('❌ [BOT-PARSER] Error parsing bot command:', error);
      logger.error('Failed to parse bot command:', error);
      return null;
    }
  }

  static async parseAndValidate(content: string): Promise<ParsedBotCommand | { error: string; errorFlowJson?: string }> {
    try {
      logger.info('🔍 [BOT-PARSER] parseAndValidate called with:', content);

      // Parse the command
      const command = this.parseMessage(content);
      if (!command) {
        logger.info('❌ [BOT-PARSER] parseMessage returned null');
        return { error: 'Invalid bot command format' };
      }
      logger.info('✅ [BOT-PARSER] Command parsed successfully:', command);

      // Get bot from registry
      const botEntry = botRegistry.getBot(command.botName);
      if (!botEntry) {
        logger.info('❌ [BOT-PARSER] Bot not found in registry:', command.botName);
        logger.info('📋 [BOT-PARSER] Available bots:', botRegistry.getAllBots().map(b => b.metadata.name));
        return { error: `Bot '${command.botName}' not found` };
      }
      logger.info('✅ [BOT-PARSER] Bot found in registry:', command.botName);

      // Create bot instance and validate input using bot's validateInputSchema method
      try {
        logger.info('🔧 [BOT-PARSER] Creating bot instance...');
        const botInstance = new botEntry.botClass();
        logger.info('✅ [BOT-PARSER] Bot instance created, validating input...');
        const validationResult = botInstance.validateInputSchema(command.parameters);

        if (validationResult.success) {
          logger.info('✅ [BOT-PARSER] Input validation successful');
          return {
            botName: command.botName,
            validatedInput: validationResult.validatedInput,
            inputFlowJson: validationResult.flowJson,
            rawCommand: command.rawCommand
          };
        } else {
          logger.info('❌ [BOT-PARSER] Input validation failed:', validationResult.flowJson);
          return {
            error: 'Input validation failed',
            errorFlowJson: validationResult.flowJson
          };
        }
      } catch (validationError: any) {
        logger.info('❌ [BOT-PARSER] Bot validation error:', validationError);
        logger.error('Bot validation error:', validationError);
        return { error: `Bot validation failed: ${validationError.message || 'Unknown error'}` };
      }
    } catch (error) {
      logger.info('❌ [BOT-PARSER] Failed to parse and validate bot command:', error);
      logger.error('Failed to parse and validate bot command:', error);
      return { error: 'Failed to process bot command' };
    }
  }

  static isBotCommand(content: string): boolean {
    // Strip HTML tags first, then trim
    const strippedContent = content.replace(/<[^>]*>/g, '').trim();
    const isBot = strippedContent.startsWith('/');
    logger.info('🔍 [BOT-PARSER] isBotCommand called with:', content, '-> stripped:', strippedContent, '-> result:', isBot);
    return isBot;
  }

  static extractBotName(content: string): string | null {
    logger.info('🔍 [BOT-PARSER] extractBotName called with:', content);
    const command = this.parseMessage(content);
    const botName = command?.botName || null;
    logger.info('✅ [BOT-PARSER] extractBotName result:', botName);
    return botName;
  }
}