import { TodoWriteTool } from '../todo-write-tool.js';
import type { TodoWriteInput, TodoWriteOutput, TodoItem } from '../schemas.js';

describe('TodoWriteTool', () => {
  let todoWriteTool: TodoWriteTool;

  beforeEach(() => {
    todoWriteTool = new TodoWriteTool();
  });

  describe('Basic functionality', () => {
    it('should successfully update a simple todo list', async () => {
      const input: TodoWriteInput = {
        todos: [
          {
            id: '1',
            content: 'Complete first task',
            status: 'completed'
          },
          {
            id: '2', 
            content: 'Work on second task',
            status: 'in_progress'
          },
          {
            id: '3',
            content: 'Start third task',
            status: 'pending'
          }
        ]
      };

      const result = await todoWriteTool.execute(input);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBeDefined();
        const data = result.data as TodoWriteOutput;
        expect(data.success).toBe(true);
        expect(data.message).toBe('Todos updated successfully');
        expect(data.todos).toHaveLength(3);
        
        // Check sorting: in_progress first, then pending, then completed
        expect(data.todos[0]?.status).toBe('in_progress');
        expect(data.todos[1]?.status).toBe('pending');
        expect(data.todos[2]?.status).toBe('completed');
      }
    });

    it('should handle single todo item', async () => {
      const input: TodoWriteInput = {
        todos: [
          {
            id: 'solo',
            content: 'Single task',
            status: 'pending'
          }
        ]
      };

      const result = await todoWriteTool.execute(input);

      expect(result.success).toBe(true);
      if (result.success) {
        const data = result.data as TodoWriteOutput;
        expect(data.todos).toHaveLength(1);
        expect(data.todos[0]?.id).toBe('solo');
      }
    });
  });

  describe('Validation rules', () => {
    it('should reject duplicate todo IDs', async () => {
      const input: TodoWriteInput = {
        todos: [
          {
            id: 'duplicate',
            content: 'First task',
            status: 'pending'
          },
          {
            id: 'duplicate', // Same ID
            content: 'Second task', 
            status: 'in_progress'
          }
        ]
      };

      const result = await todoWriteTool.execute(input);

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Duplicate todo IDs found');
    });

    it('should reject multiple in_progress todos', async () => {
      const input: TodoWriteInput = {
        todos: [
          {
            id: '1',
            content: 'First in progress task',
            status: 'in_progress'
          },
          {
            id: '2',
            content: 'Second in progress task',
            status: 'in_progress' // Violates "exactly one in_progress" rule
          }
        ]
      };

      const result = await todoWriteTool.execute(input);

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Only one todo can be in progress at a time');
    });

    it('should allow zero in_progress todos', async () => {
      const input: TodoWriteInput = {
        todos: [
          {
            id: '1',
            content: 'Pending task',
            status: 'pending'
          },
          {
            id: '2',
            content: 'Completed task',
            status: 'completed'
          }
        ]
      };

      const result = await todoWriteTool.execute(input);

      expect(result.success).toBe(true);
    });

    it('should reject empty todo list', async () => {
      const input: TodoWriteInput = {
        todos: []
      };

      const result = await todoWriteTool.execute(input);

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('At least one todo item is required');
    });

    it('should reject empty todo content', async () => {
      const input: TodoWriteInput = {
        todos: [
          {
            id: '1',
            content: '', // Empty content
            status: 'pending'
          }
        ]
      };

      const result = await todoWriteTool.execute(input);

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Todo content cannot be empty');
    });

    it('should reject empty todo ID', async () => {
      const input: TodoWriteInput = {
        todos: [
          {
            id: '', // Empty ID
            content: 'Valid content',
            status: 'pending'
          }
        ]
      };

      const result = await todoWriteTool.execute(input);

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Todo ID cannot be empty');
    });

    it('should reject invalid status', async () => {
      const input = {
        todos: [
          {
            id: '1',
            content: 'Valid content',
            status: 'invalid_status' // Invalid status
          }
        ]
      };

      const result = await todoWriteTool.execute(input as TodoWriteInput);

      expect(result.success).toBe(false);
    });
  });

  describe('Todo sorting', () => {
    it('should sort todos by status priority', async () => {
      const input: TodoWriteInput = {
        todos: [
          {
            id: 'c',
            content: 'Completed task',
            status: 'completed'
          },
          {
            id: 'b',
            content: 'Pending task',
            status: 'pending'
          },
          {
            id: 'a',
            content: 'In progress task',
            status: 'in_progress'
          }
        ]
      };

      const result = await todoWriteTool.execute(input);

      expect(result.success).toBe(true);
      if (result.success) {
        const data = result.data as TodoWriteOutput;
        
        // Should be sorted: in_progress, pending, completed
        expect(data.todos[0]?.status).toBe('in_progress');
        expect(data.todos[0]?.id).toBe('a');
        expect(data.todos[1]?.status).toBe('pending');
        expect(data.todos[1]?.id).toBe('b');
        expect(data.todos[2]?.status).toBe('completed');
        expect(data.todos[2]?.id).toBe('c');
      }
    });

    it('should sort by ID within same status', async () => {
      const input: TodoWriteInput = {
        todos: [
          {
            id: 'task-3',
            content: 'Third pending task',
            status: 'pending'
          },
          {
            id: 'task-1',
            content: 'First pending task',
            status: 'pending'
          },
          {
            id: 'task-2',
            content: 'Second pending task',
            status: 'pending'
          }
        ]
      };

      const result = await todoWriteTool.execute(input);

      expect(result.success).toBe(true);
      if (result.success) {
        const data = result.data as TodoWriteOutput;
        
        // Should be sorted by ID within same status
        expect(data.todos[0]?.id).toBe('task-1');
        expect(data.todos[1]?.id).toBe('task-2');
        expect(data.todos[2]?.id).toBe('task-3');
      }
    });
  });

  describe('LLM output', () => {
    it('should return simple success message for successful update', async () => {
      const input: TodoWriteInput = {
        todos: [
          {
            id: '1',
            content: 'Test task',
            status: 'pending'
          }
        ]
      };

      const result = await todoWriteTool.execute(input);
      const llmOutput = todoWriteTool.getLLMOutput(result);

      expect(llmOutput.message).toBe('Todos updated successfully');
    });

    it('should return error message for failed update', async () => {
      const input: TodoWriteInput = {
        todos: [
          {
            id: 'dup',
            content: 'First',
            status: 'pending'
          },
          {
            id: 'dup', // Duplicate ID
            content: 'Second',
            status: 'pending'
          }
        ]
      };

      const result = await todoWriteTool.execute(input);
      const llmOutput = todoWriteTool.getLLMOutput(result);

      expect(llmOutput.message).toContain('Duplicate todo IDs found');
    });
  });

  describe('Edge cases', () => {
    it('should handle todos with special characters in content', async () => {
      const input: TodoWriteInput = {
        todos: [
          {
            id: '1',
            content: 'Task with "quotes" and symbols: @#$%^&*()',
            status: 'pending'
          }
        ]
      };

      const result = await todoWriteTool.execute(input);

      expect(result.success).toBe(true);
      if (result.success) {
        const data = result.data as TodoWriteOutput;
        expect(data.todos[0]?.content).toBe('Task with "quotes" and symbols: @#$%^&*()');
      }
    });

    it('should handle todos with very long content', async () => {
      const longContent = 'A'.repeat(1000);
      const input: TodoWriteInput = {
        todos: [
          {
            id: '1',
            content: longContent,
            status: 'pending'
          }
        ]
      };

      const result = await todoWriteTool.execute(input);

      expect(result.success).toBe(true);
      if (result.success) {
        const data = result.data as TodoWriteOutput;
        expect(data.todos[0]?.content).toBe(longContent);
      }
    });

    it('should handle many todos', async () => {
      const manyTodos: TodoItem[] = [];
      for (let i = 1; i <= 100; i++) {
        manyTodos.push({
          id: `task-${i}`,
          content: `Task number ${i}`,
          status: i === 50 ? 'in_progress' : (i > 50 ? 'completed' : 'pending')
        });
      }

      const input: TodoWriteInput = { todos: manyTodos };
      const result = await todoWriteTool.execute(input);

      expect(result.success).toBe(true);
      if (result.success) {
        const data = result.data as TodoWriteOutput;
        expect(data.todos).toHaveLength(100);
        
        // Should still have exactly one in_progress
        const inProgressTodos = data.todos.filter(t => t.status === 'in_progress');
        expect(inProgressTodos).toHaveLength(1);
      }
    });
  });
});