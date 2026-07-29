import type { FlowJson } from '@/bots/json-ui/types';
import {logger} from '@/utils/logger';

/**
 * Pattern for FlowJson in message content with bot identifier
 * Format: flowjson|botname@{...flowJson}
 */
const FLOWJSON_PATTERN = /flowjson\|([^@]+)@(\{.*\})/gs;

/**
 * Utility functions for manipulating FlowJson in message content
 */
export class FlowJsonUtils {
  /**
   * Check if message content contains FlowJson
   */
  static hasFlowJson(content: string): boolean {
    return FLOWJSON_PATTERN.test(content);
  }

  /**
   * Check if message content contains FlowJson from a specific bot
   */
  static hasFlowJsonFromBot(content: string, botName: string): boolean {
    const pattern = new RegExp(`flowjson\\|${this.escapeRegex(botName)}@\\{.*\\}`, 's');
    return pattern.test(content);
  }

  /**
   * Extract all FlowJson entries from message content
   */
  static extractAllFlowJson(content: string): Array<{ botName: string; flowJson: FlowJson }> {
    const matches = Array.from(content.matchAll(FLOWJSON_PATTERN));
    const results: Array<{ botName: string; flowJson: FlowJson }> = [];

    for (const match of matches) {
      const botName = match[1];
      const flowJsonString = match[2];

      try {
        const flowJson = JSON.parse(flowJsonString) as FlowJson;
        results.push({ botName, flowJson });
      } catch (error) {
        logger.error(`Failed to parse FlowJson from bot ${botName}:`, error);
      }
    }

    return results;
  }

  /**
   * Extract FlowJson from a specific bot
   */
  static extractFlowJsonFromBot(content: string, botName: string): FlowJson | null {
    const pattern = new RegExp(`flowjson\\|${this.escapeRegex(botName)}@(\\{.*\\})`, 's');
    const match = content.match(pattern);
    
    if (!match || !match[1]) {
      return null;
    }

    try {
      return JSON.parse(match[1]) as FlowJson;
    } catch (error) {
      logger.error(`Failed to parse FlowJson from bot ${botName}:`, error);
      return null;
    }
  }

  /**
   * Remove all FlowJson entries from message content
   */
  static removeAllFlowJson(content: string): string {
    return content.replace(FLOWJSON_PATTERN, '').trim();
  }

  /**
   * Remove FlowJson from a specific bot
   */
  static removeFlowJsonFromBot(content: string, botName: string): string {
    const pattern = new RegExp(`flowjson\\|${this.escapeRegex(botName)}@\\{.*\\}`, 'gs');
    return content.replace(pattern, '').trim();
  }

  /**
   * Append or update FlowJson from a specific bot
   * If FlowJson from this bot already exists, it will be replaced
   */
  static updateFlowJsonFromBot(content: string, botName: string, flowJson: FlowJson): string {
    // Remove existing FlowJson from this bot
    const contentWithoutBotFlowJson = this.removeFlowJsonFromBot(content, botName);
    
    // Append new FlowJson
    const flowJsonString = JSON.stringify(flowJson);
    const flowJsonEntry = `flowjson|${botName}@${flowJsonString}`;
    
    return contentWithoutBotFlowJson 
      ? `${contentWithoutBotFlowJson}\n${flowJsonEntry}` 
      : flowJsonEntry;
  }

  /**
   * Get the base content without any FlowJson entries
   */
  static getBaseContent(content: string): string {
    return this.removeAllFlowJson(content);
  }

  /**
   * Create message content with FlowJson from a specific bot
   */
  static createContentWithFlowJson(baseContent: string, botName: string, flowJson: FlowJson): string {
    const flowJsonString = JSON.stringify(flowJson);
    const flowJsonEntry = `flowjson|${botName}@${flowJsonString}`;
    
    return baseContent 
      ? `${baseContent}\n${flowJsonEntry}` 
      : flowJsonEntry;
  }

  /**
   * Get all bot names that have added FlowJson to the content
   */
  static getBotNamesWithFlowJson(content: string): string[] {
    const matches = Array.from(content.matchAll(FLOWJSON_PATTERN));
    return matches.map(match => match[1]);
  }

  /**
   * Validate FlowJson format in message content
   */
  static validateFlowJsonInContent(content: string): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    const matches = Array.from(content.matchAll(FLOWJSON_PATTERN));

    for (const match of matches) {
      const botName = match[1];
      const flowJsonString = match[2];

      try {
        const flowJson = JSON.parse(flowJsonString) as FlowJson;
        
        // Basic FlowJson structure validation
        if (!flowJson.version) {
          errors.push(`FlowJson from ${botName}: Missing version`);
        }
        if (!flowJson.metadata) {
          errors.push(`FlowJson from ${botName}: Missing metadata`);
        }
        if (!flowJson.root) {
          errors.push(`FlowJson from ${botName}: Missing root component`);
        }
      } catch (error) {
        errors.push(`FlowJson from ${botName}: Invalid JSON format`);
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Count FlowJson entries in content
   */
  static countFlowJsonEntries(content: string): number {
    const matches = Array.from(content.matchAll(FLOWJSON_PATTERN));
    return matches.length;
  }

  /**
   * Escape special regex characters
   */
  private static escapeRegex(string: string): string {
    return string.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&');
  }

  /**
   * Parse message content and separate base content from FlowJson entries
   */
  static parseMessageContent(content: string): {
    baseContent: string;
    flowJsonEntries: Array<{ botName: string; flowJson: FlowJson }>;
  } {
    return {
      baseContent: this.getBaseContent(content),
      flowJsonEntries: this.extractAllFlowJson(content)
    };
  }
}