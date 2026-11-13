/**
 * AgentToolRegistry — registry for WorkflowTool instances.
 *
 * Stores tools by name. Used by AgentStep to resolve tool names from
 * workflow config into concrete tool implementations.
 */

import type { WorkflowTool } from './tool-types.js';

export class AgentToolRegistry {
  private readonly tools = new Map<string, WorkflowTool>();

  /** Register a tool. Throws if a tool with the same name is already registered. */
  register(tool: WorkflowTool): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool "${tool.name}" is already registered`);
    }
    this.tools.set(tool.name, tool);
  }

  /** Get a tool by name. Returns undefined if not found. */
  get(name: string): WorkflowTool | undefined {
    return this.tools.get(name);
  }

  /** Get all registered tools. */
  getAll(): WorkflowTool[] {
    return [...this.tools.values()];
  }

  /** Resolve a list of tool names to WorkflowTool instances. Throws if any name is missing. */
  resolve(names: readonly string[]): WorkflowTool[] {
    return names.map((name) => {
      const tool = this.tools.get(name);
      if (!tool) {
        throw new Error(`Tool "${name}" not found in registry`);
      }
      return tool;
    });
  }

  /** Get all registered tool names. */
  getNames(): string[] {
    return [...this.tools.keys()];
  }

  /** Check if a tool is registered. */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /** Number of registered tools. */
  get size(): number {
    return this.tools.size;
  }
}
