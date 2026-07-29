import type { ToolExecutionContext, ToolExecutionResult } from '../../core/types/tool.js';
import { BaseTool } from '../../core/base-tool.js';
import { Tool } from '../../core/decorators.js';
import { logger } from '../../../utils/logger.js';
import { 
  TodoWriteInputSchema, 
  TodoWriteOutputSchema,
  TodoWriteLLMOutputSchema,
  type TodoWriteInput,
  type TodoWriteOutput,
  type TodoWriteLLMOutput,
  type TodoItem
} from './schemas.js';

/**
 * TodoWrite tool for managing and tracking task lists
 * Provides structured todo list management for development workflows
 */
@Tool({
  name: 'todo-write',
  description: 'Create and manage structured task lists for tracking progress in development workflows. Helps organize complex tasks and provide visibility into work progress.',
  inputSchema: TodoWriteInputSchema,
  outputSchema: TodoWriteOutputSchema,
  llmOutputSchema: TodoWriteLLMOutputSchema,
  version: '1.0.0',
  tags: ['productivity', 'task-management', 'workflow'],
  category: 'system'
})
export class TodoWriteTool extends BaseTool<TodoWriteInput, TodoWriteOutput, TodoWriteLLMOutput> {
  protected readonly inputSchema = TodoWriteInputSchema;
  protected readonly outputSchema = TodoWriteOutputSchema;
  protected readonly toolName = 'todo-write';

  /**
   * Extract minimal content for LLM - simple success/failure message
   */
  public getLLMOutput(result: ToolExecutionResult<TodoWriteOutput>): TodoWriteLLMOutput {
    if (!result.success) {
      return {
        message: result.error?.message || 'Todo update failed'
      };
    }

    if (!result.data) {
      return {
        message: 'Todo update failed: No data returned'
      };
    }

    return {
      message: result.data.message
    };
  }

  /**
   * Execute todo list update with validation
   */
  protected executeInternal(
    input: TodoWriteInput,
    context: ToolExecutionContext
  ): Promise<TodoWriteOutput> {
    
    logger.debug('Starting todo write operation', {
      todoCount: input.todos.length,
      executionId: context.executionId
    });

    try {
      // Validate todo list constraints
      this.validateTodoConstraints(input.todos);
      
      // Process and update todos
      const processedTodos = this.processTodos(input.todos);
      
      logger.info('Todo list updated successfully', {
        totalTodos: processedTodos.length,
        pending: processedTodos.filter(t => t.status === 'pending').length,
        inProgress: processedTodos.filter(t => t.status === 'in_progress').length,
        completed: processedTodos.filter(t => t.status === 'completed').length,
        executionId: context.executionId
      });

      return Promise.resolve({
        success: true,
        todos: processedTodos,
        message: 'Todos updated successfully'
      });

    } catch (error) {
      logger.error('Todo write operation failed', error as Error, {
        todoCount: input.todos.length,
        executionId: context.executionId
      });

      throw error;
    }
  }

  /**
   * Validate todo list follows business rules
   */
  private validateTodoConstraints(todos: TodoItem[]): void {
    // Check for duplicate IDs
    const ids = todos.map(todo => todo.id);
    const uniqueIds = new Set(ids);
    if (ids.length !== uniqueIds.size) {
      throw new Error('Duplicate todo IDs found. Each todo must have a unique ID.');
    }

    // Validate exactly one in_progress task (following specification)
    const inProgressTodos = todos.filter(todo => todo.status === 'in_progress');
    if (inProgressTodos.length > 1) {
      throw new Error('Only one todo can be in progress at a time. Found multiple in_progress todos.');
    }

    // Validate status transitions are logical
    this.validateStatusTransitions(todos);
  }

  /**
   * Validate that status transitions make sense
   */
  private validateStatusTransitions(todos: TodoItem[]): void {
    // For now, we don't have previous state to compare against
    // But we can validate that the current state makes sense
    const statuses = todos.map(todo => todo.status);
    const hasCompleted = statuses.includes('completed');
    const hasInProgress = statuses.includes('in_progress');
    const hasPending = statuses.includes('pending');

    // If there are completed tasks but no in_progress or pending, warn but don't fail
    if (hasCompleted && !hasInProgress && !hasPending) {
      logger.warn('All todos are completed. Consider adding new tasks or archiving completed ones.');
    }
  }

  /**
   * Process todos and return clean list
   */
  private processTodos(todos: TodoItem[]): TodoItem[] {
    // Sort todos for consistent ordering: in_progress first, then pending, then completed
    return todos.sort((a, b) => {
      const statusOrder = { 
        // eslint-disable-next-line @typescript-eslint/naming-convention
        'in_progress': 0, 
        'pending': 1, 
        'completed': 2 
      };
      const aOrder = statusOrder[a.status];
      const bOrder = statusOrder[b.status];
      
      if (aOrder !== bOrder) {
        return aOrder - bOrder;
      }
      
      // Within same status, sort by ID for consistency
      return a.id.localeCompare(b.id);
    });
  }
}