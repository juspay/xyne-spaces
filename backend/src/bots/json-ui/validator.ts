import { FlowJsonSchema, ComponentSchema, type FlowJson, type Component } from './types';
import { logger } from '@/utils/logger';

/**
 * Validate a complete FlowJson structure
 */
export function validateFlowJson(data: unknown): { success: true; data: FlowJson } | { success: false; errors: string[] } {
  try {
    const result = FlowJsonSchema.safeParse(data);
    
    if (result.success) {
      return { success: true, data: result.data };
    }
    
    const errors = result.error.errors.map((err: any) => 
      `${err.path.join('.')}: ${err.message}`
    );
    
    return { success: false, errors };
  } catch (error) {
    logger.error('FlowJson validation error:', error);
    return { 
      success: false, 
      errors: [`Validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`] 
    };
  }
}

/**
 * Validate a single component
 */
export function validateComponent(data: unknown): { success: true; data: Component } | { success: false; errors: string[] } {
  try {
    const result = ComponentSchema.safeParse(data);
    
    if (result.success) {
      return { success: true, data: result.data };
    }
    
    const errors = result.error.errors.map((err: any) => 
      `${err.path.join('.')}: ${err.message}`
    );
    
    return { success: false, errors };
  } catch (error) {
    logger.error('Component validation error:', error);
    return { 
      success: false, 
      errors: [`Component validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`] 
    };
  }
}



/**
 * Create a simple FlowJson with validation
 */
export function createFlowJson(
  botName: string,
  root: Component,
  executionId?: string,
  tokens?: number
): { success: true; data: FlowJson } | { success: false; errors: string[] } {
  const flowJson = {
    version: '1.0',
    metadata: {
      botName,
      timestamp: new Date().toISOString(),
      ...(executionId && { executionId }),
      ...(tokens && { tokens }),
    },
    root,
  };

  return validateFlowJson(flowJson);
}