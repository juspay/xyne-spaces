// Export all bot framework components (auto-discovery entry point)
import './core/index.js';
import  './implementations/index.js';

// Bot framework initialization
import { botRegistry } from './core/bot-registry.js';
import { serviceRegistry } from './core/services.js';
import { conversationManager } from './core/conversation.js';
import {logger} from '@/utils/logger';

/**
 * Initialize the bot framework
 */
export function initializeBotFramework(): void {
  logger.debug('[BotFramework] Initializing bot framework...');
  
  // Framework is ready - registries are initialized
  logger.debug('[BotFramework] Bot framework initialized successfully', {
    registeredBots: botRegistry.getAllBots().length,
    registeredServices: serviceRegistry.getAllServices().length
  });
}

/**
 * Shutdown the bot framework
 */
export async function shutdownBotFramework(): Promise<void> {
  logger.debug('[BotFramework] Shutting down bot framework...');
  
  try {
    // Clear conversation storage
    await conversationManager.cleanup();
    
    // Clear service registry (will cleanup services)
    await serviceRegistry.clear();
    
    // Clear bot registry
    botRegistry.clear();
    
    logger.debug('[BotFramework] Bot framework shutdown completed');
  } catch (error) {
    logger.error('[BotFramework] Error during shutdown', error);
    throw error;
  }
}

/**
 * Get framework status
 */
export function getBotFrameworkStatus(): {
  bots: {
    total: number;
    categories: string[];
    capabilities: string[];
  };
  services: {
    total: number;
    names: string[];
  };
  conversations: Promise<{
    total: number;
    byBot: Record<string, number>;
  }>;
} {
  const botStats = botRegistry.getStats();
  const serviceStats = serviceRegistry.getStats();
  const conversationStats = conversationManager.getStats();
  
  return {
    bots: {
      total: botStats.totalBots,
      categories: botRegistry.getCategories(),
      capabilities: botRegistry.getCapabilities()
    },
    services: {
      total: serviceStats.totalServices,
      names: serviceStats.serviceNames
    },
    conversations: conversationStats.then(stats => ({
      total: stats.totalConversations,
      byBot: stats.conversationsByBot
    }))
  };
}

/**
 * Auto-discover and register bots from implementations directory
 */
export async function discoverBots(): Promise<void> {
  logger.debug('[BotFramework] Starting bot auto-discovery...');
  
  try {
    // In a real implementation, you would scan the implementations directory
    // For now, we'll just log that discovery is ready
    logger.debug('[BotFramework] Bot auto-discovery completed', {
      implementationsPath: './implementations/',
      note: 'Add bot implementations to be auto-discovered'
    });
  } catch (error) {
    logger.error('[BotFramework] Bot auto-discovery failed', error);
    throw error;
  }
}

// Auto-initialize when module is imported
initializeBotFramework();