# Nexus AI - Agentic Framework

A modular, extensible agentic AI framework built in TypeScript for building intelligent AI agents with tool integration capabilities.

## Features

- **Modular Architecture**: Built with TypeScript for type safety and extensibility
- **LLM Integration**: Support for multiple language models via LiteLLM (OpenAI, Anthropic, Google, etc.)
- **Tool System**: Extensible tool framework for agent capabilities with runtime validation
- **MCP Support**: Model Context Protocol integration for seamless tool communication
- **Agent Framework**: Complete agent management and execution system with workflow support

## Installation

```bash
# Install dependencies - requires Node.js 18+ with ES modules support
npm install
```

## Build

```bash
# Compile TypeScript to JavaScript in dist/ directory
npm run build
```

## Usage

```bash
# Run the CLI agent - make sure to build first
ai-agent
```

## Development

```bash
# Run Jest test suite with TypeScript support
npm test

# Type checking without compilation - useful for CI/CD
npm run typecheck

# ESLint code quality checks
npm run lint
npm run fix

# Prettier code formatting
npm run format
```

## Dependencies

- **TypeScript 5.8+**: Core language with latest features and strict type checking
- **Node.js (ES modules)**: Runtime environment with native ES module support
- **LiteLLM**: Unified interface for multiple LLM providers (OpenAI, Anthropic, Google, etc.)
- **Zod**: Runtime type validation and schema generation for tool inputs/outputs
- **MCP SDK**: Model Context Protocol implementation for standardized tool communication
- **UUID**: Unique identifier generation for agents and workflows
- **Tiktoken**: Token counting for LLM context management

## Project Structure

```
src/
├── agents/     # Agent implementations and lifecycle management
├── llm/        # Language model integration and providers
├── mcp/        # Model Context Protocol client/server implementation
├── tools/      # Tool definitions and execution framework
├── types/      # TypeScript type definitions and interfaces
├── utils/      # Shared utility functions and helpers
└── workflows/  # Workflow execution engine and orchestration
```

## License

ISC