# Providers

Providers wrap the app with context and configuration.

**Location**: `src/providers/`

## Available Providers

| Provider | Purpose |
|----------|---------|
| `AuthProvider` | Authentication state, user session |
| `ZeroProvider` | Zero sync client configuration |
| `AnalyticsProvider` | Analytics tracking |
| `EditProvider` | Edit mode state |
| `ShortcutsProvider` | Keyboard shortcuts |
| `InitialStateLoader` | Initial data loading |

## Usage

Providers are composed in `App.tsx`. Order matters for dependencies.

## Creating a Provider

| Task | Location |
|------|----------|
| Create provider | `src/providers/{Name}Provider.tsx` |
| Reference pattern | Look at `AuthProvider`, `ZeroProvider` |

## Do's

- Keep providers focused on single concern
- Use existing providers before creating new ones
- Document provider dependencies

## Don'ts

- Don't put business logic in providers
- Don't create deeply nested provider chains
- Don't duplicate provider functionality
