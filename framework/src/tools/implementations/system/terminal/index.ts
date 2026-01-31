export { TerminalTool } from './terminal-tool.js';
export type { 
  TerminalToolInput, 
  TerminalToolOutput,
  SecurityValidation,
  SupportedPlatform,
  SupportedShell
} from './schemas.js';
export { 
  validateCommand, 
  sanitizeCommand
} from './security.js';
export {
  CommandExecutor,
  detectPlatform
} from './command-executor.js';