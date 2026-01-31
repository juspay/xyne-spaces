# Technical Context: Xyne Automation Framework

## Technology Stack
- **Testing Framework**: Playwright with TypeScript
- **Language**: TypeScript/JavaScript
- **Package Manager**: npm
- **Build System**: TypeScript compiler (tsc)
- **Configuration**: YAML-based configuration management

## Development Setup
- **Node.js**: Required for running the framework
- **Playwright**: Cross-browser automation library
- **TypeScript**: Type-safe JavaScript development
- **Environment Variables**: `.env` file for configuration
- **Config Management**: YAML files in `config/` directory

## Technical Architecture
```
src/
├── framework/
│   ├── core/           # Core framework components
│   ├── pages/          # Page Object Model classes
│   ├── utils/          # Utility functions and helpers
│   └── types/          # TypeScript type definitions
tests/
├── functional/         # Feature-level test suites
├── smoke/             # Quick validation tests
└── examples/          # Example test implementations
```

## Key Dependencies
- **@playwright/test**: Core testing framework
- **TypeScript**: Type system and compilation
- **YAML**: Configuration file parsing
- **Slack Integration**: Test result notifications
- **TOTP**: Two-factor authentication support

## Testing Patterns
- **Page Object Model**: Encapsulation of page interactions
- **Shared Browser Context**: Session sharing across tests
- **Sequential Test Execution**: Stateful test scenarios
- **Enhanced Reporting**: Screenshots and detailed logs
- **API Monitoring**: Network request/response tracking

## Configuration Management
- Environment-specific YAML configs
- Runtime configuration via ConfigManager
- Dependency injection for test fixtures
- Global setup and teardown hooks

## Current Limitations
- Tests are tightly coupled to specific CSS selectors
- Limited reusability of UI interaction logic
- Complex locator expressions scattered across test files
- No standardized component interaction patterns
