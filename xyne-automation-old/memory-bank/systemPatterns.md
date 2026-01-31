# System Patterns: Xyne Automation Architecture

## Current Architecture Patterns

### Page Object Model (POM)
- **Location**: `src/framework/pages/`
- **Pattern**: Each page has a corresponding class that encapsulates page-specific logic
- **Examples**: `LoginPage`, `AgentModulePage`, `GoogleOAuthLoginPage`
- **Benefits**: Centralized page logic, maintainable selectors

### Utility Pattern
- **Location**: `src/framework/utils/`
- **Pattern**: Shared functionality extracted into utility classes
- **Examples**: `ApiMonitor`, `SlackNotifier`, `TotpGenerator`, `LlmEvaluator`
- **Benefits**: Code reuse, separation of concerns

### Configuration Management
- **Location**: `src/framework/core/config-manager.ts`
- **Pattern**: Centralized configuration loading from YAML files
- **Benefits**: Environment-specific settings, runtime configuration

### Global Setup/Teardown
- **Location**: `src/framework/core/global-setup.ts`, `global-teardown.ts`
- **Pattern**: Framework-level initialization and cleanup
- **Benefits**: Consistent test environment, resource management

## Proposed Component Architecture

### Two-Tier Component System
```
src/framework/components/
├── base/                    # Generic UI components
│   ├── button.component.ts
│   ├── textfield.component.ts
│   ├── tab.component.ts
│   ├── checkbox.component.ts
│   └── dropdown.component.ts
└── composed/               # Application-specific components
    ├── chat.component.ts
    ├── login.component.ts
    ├── navigation.component.ts
    └── search.component.ts
```

### Base Component Pattern
- **Purpose**: Reusable UI element abstractions
- **Responsibilities**: 
  - Encapsulate common element interactions (click, type, verify)
  - Provide consistent API across all UI elements
  - Handle element state management and waiting strategies

### Composed Component Pattern
- **Purpose**: Business logic and feature-specific interactions
- **Responsibilities**:
  - Combine multiple base components
  - Implement feature-specific workflows
  - Provide domain-specific methods and validations

## Design Principles

### 1. Single Responsibility
Each component handles one specific UI element or feature area

### 2. Composition over Inheritance
Build complex components by composing simpler ones

### 3. Parameterized Actions
Components accept parameters to handle different scenarios

### 4. Consistent API
All components follow the same method naming and interaction patterns

### 5. Locator Encapsulation
CSS selectors are hidden within components, not exposed to tests

## Integration Patterns

### Test Integration
```typescript
// Before (current)
await page.locator('button:has-text("Ask")').click();

// After (component-based)
await chatComponent.askButton.click();
```

### Parameter-Driven Testing
```typescript
// Generic component usage
const submitButton = new Button(page.locator('#submit'));
await submitButton.clickAndWait();

// Composed component usage
await chatComponent.sendMessage("Hello", { waitForResponse: true });
```

## Migration Strategy
1. Create base components first
2. Build composed components using base components
3. Gradually refactor existing tests
4. Maintain backward compatibility during transition
