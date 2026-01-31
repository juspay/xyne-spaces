import { z } from 'zod';

/**
 * Individual todo item schema
 */
export const TodoItemSchema = z.object({
  id: z.string()
    .min(1, 'Todo ID cannot be empty')
    .describe('Unique identifier for the todo item'),
  
  content: z.string()
    .min(1, 'Todo content cannot be empty')
    .describe('Description of what needs to be done'),
  
  status: z.enum(['pending', 'in_progress', 'completed'])
    .describe('Current status of the todo item')
});

/**
 * Input schema for TodoWrite tool
 */
export const TodoWriteInputSchema = z.object({
  todos: z.array(TodoItemSchema)
    .min(1, 'At least one todo item is required')
    .describe('Array of todo items to update')
});

/**
 * Output schema for TodoWrite tool
 */
export const TodoWriteOutputSchema = z.object({
  success: z.boolean()
    .describe('Whether the todo update operation succeeded'),
  
  todos: z.array(TodoItemSchema)
    .describe('Updated array of todo items'),
  
  message: z.string()
    .describe('Success or failure message')
});

/**
 * LLM output schema for TodoWrite tool - simple message only
 */
export const TodoWriteLLMOutputSchema = z.object({
  message: z.string()
    .describe('Simple status message: "Todos updated successfully" or error details')
});

/**
 * TypeScript types derived from schemas
 */
export type TodoItem = z.infer<typeof TodoItemSchema>;
export type TodoWriteInput = z.infer<typeof TodoWriteInputSchema>;
export type TodoWriteOutput = z.infer<typeof TodoWriteOutputSchema>;
export type TodoWriteLLMOutput = z.infer<typeof TodoWriteLLMOutputSchema>;