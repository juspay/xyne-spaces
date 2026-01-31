/**
 * Type definitions for step renderer components
 * These interfaces define the expected data structures for each tool type
 */

export interface LLMCallData {
  response: string;
  model?: string;
  prompt?: string;
  temperature?: number;
  maxTokens?: number;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
}

export interface ToolBashData {
  input: {
    command: string;
    description?: string;
    timeout?: number;
  };
  output: {
    stdout?: string;
    stderr?: string;
    exitCode?: number;
    error?: string;
  };
  duration?: number;
}

export interface ToolReadData {
  input: {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    file_path: string;
    offset?: number;
    limit?: number;
  };
  output: {
    content?: string;
    error?: string;
    suggestions?: string[];
  };
}

export interface ToolWriteData {
  input: {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    file_path: string;
    content: string;
  };
  output: {
    success?: boolean;
    error?: string;
    bytesWritten?: number;
  };
}

export interface ToolEditData {
  input: {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    file_path: string;
    // eslint-disable-next-line @typescript-eslint/naming-convention
    old_string: string;
    // eslint-disable-next-line @typescript-eslint/naming-convention
    new_string: string;
    // eslint-disable-next-line @typescript-eslint/naming-convention
    replace_all?: boolean;
  };
  output: {
    success?: boolean;
    error?: string;
    changesApplied?: number;
  };
}

export interface ToolGlobData {
  input: {
    pattern: string;
    path?: string;
  };
  output: {
    files?: string[];
    error?: string;
    count?: number;
  };
}

export interface ToolGrepData {
  input: {
    pattern: string;
    path?: string;
    glob?: string;
    type?: string;
    // eslint-disable-next-line @typescript-eslint/naming-convention
    output_mode?: 'content' | 'files_with_matches' | 'count';
    // eslint-disable-next-line @typescript-eslint/naming-convention
    '-i'?: boolean;
    // eslint-disable-next-line @typescript-eslint/naming-convention
    '-n'?: boolean;
    // eslint-disable-next-line @typescript-eslint/naming-convention
    '-A'?: number;
    // eslint-disable-next-line @typescript-eslint/naming-convention
    '-B'?: number;
    // eslint-disable-next-line @typescript-eslint/naming-convention
    '-C'?: number;
  };
  output: {
    matches?: string[];
    files?: string[];
    count?: number;
    error?: string;
  };
}

export interface ToolLsData {
  input: {
    path?: string;
    flags?: string[];
  };
  output: {
    entries?: Array<{
      name: string;
      type: 'file' | 'directory' | 'symlink';
      size?: number;
      modified?: string;
      permissions?: string;
    }>;
    error?: string;
  };
}

export interface ToolTodoWriteData {
  input: {
    todos: Array<{
      content: string;
      status: 'pending' | 'in_progress' | 'completed';
      activeForm: string;
    }>;
  };
  output: {
    success?: boolean;
    error?: string;
    todosUpdated?: number;
  };
}

export interface ToolMultiEditData {
  input: {
    edits: Array<{
      // eslint-disable-next-line @typescript-eslint/naming-convention
      file_path: string;
      // eslint-disable-next-line @typescript-eslint/naming-convention
      old_string: string;
      // eslint-disable-next-line @typescript-eslint/naming-convention
      new_string: string;
      // eslint-disable-next-line @typescript-eslint/naming-convention
      replace_all?: boolean;
    }>;
  };
  output: {
    results?: Array<{
      // eslint-disable-next-line @typescript-eslint/naming-convention
      file_path: string;
      success: boolean;
      error?: string;
      changesApplied?: number;
    }>;
    totalSuccess?: number;
    totalErrors?: number;
  };
}

// Base interface for all step renderer props
export interface BaseStepRendererProps<T> {
  data: T;
  isExpanded?: boolean;
}
