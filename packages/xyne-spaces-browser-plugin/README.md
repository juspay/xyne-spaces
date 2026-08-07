# Xyne Spaces Browser Plugin

Chrome browser extension for quick access to Xyne Spaces using the `@xyne/spaces-sdk`.

## Features

- **Universal Search** - Search messages, tickets, files, and channels from your browser
- **Channel List** - View your channels with unread indicators
- **My Tickets** - Quick access to tickets assigned to you
- **Quick Messaging** - Start threads and reply without leaving your current tab
- **Context Menu** - Right-click to search selected text in Xyne Spaces

## Installation

### Development

```bash
# Install dependencies
pnpm install

# Build the extension
pnpm build

# Watch mode for development
pnpm dev
```

### Load in Chrome

1. Open `chrome://extensions/`
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select the `dist/` directory

## Configuration

1. Click the extension icon
2. Go to Settings
3. Paste your Xyne Spaces API token
4. (Optional) Set a custom base URL if using a self-hosted instance

### Getting Your Token

1. Open Xyne Spaces web app
2. Go to Settings > API Tokens
3. Create a new token with required scopes
4. Copy and paste into the extension settings

## Usage

### Search

Click the extension icon and type in the search bar. Results include:
- Messages
- Tickets
- Files
- Channels
- Users

### Quick Actions

- **New Thread** - Start a conversation in any channel
- **My Tickets** - View and update your assigned tickets
- **Channels** - Browse and navigate to channels
- **Settings** - Configure token and preferences

### Context Menu

Right-click any selected text on a webpage to:
- Search Xyne Spaces for the selection
- Create a ticket from the selection (coming soon)

## Architecture

```
src/
├── background/           # Service worker for context menus
├── popup/               # Main extension popup UI
│   ├── components/      # React components
│   └── App.tsx          # Root component
├── content/             # Content scripts (future)
├── lib/                 # SDK client and utilities
└── hooks/               # React hooks for SDK operations
```

## Tech Stack

- **React 18** - UI framework
- **TypeScript** - Type safety
- **Vite** - Build tool with Chrome extension support
- **TailwindCSS** - Styling
- **@xyne/spaces-sdk** - Xyne Spaces API client

## SDK Integration

The extension uses `@xyne/spaces-sdk` for all API operations:

```typescript
import { createClient } from '@xyne/spaces-sdk';

const sdk = createClient({
  token: await getStoredToken(),
  baseUrl: 'https://spaces.xyne.app',
});

// Get current user
const me = await sdk.users.me();

// Search workspace
const results = await sdk.search.query({ q: 'deployment', type: 'message' });

// List channels
const channels = await sdk.channels.list();

// Start a thread
const { conversationId } = await sdk.conversations.create({
  channelId: 'channel-123',
  content: 'Hello from the browser extension!',
});
```

## Development

### Scripts

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start development build with watch mode |
| `pnpm build` | Production build |
| `pnpm typecheck` | Run TypeScript type checking |
| `pnpm lint` | Run ESLint |

### Project Structure

| File | Purpose |
|------|---------|
| `manifest.json` | Chrome extension manifest (v3) |
| `vite.config.ts` | Vite build configuration |
| `src/lib/sdk-client.ts` | SDK client singleton |
| `src/lib/auth.ts` | Token management |
| `src/lib/storage.ts` | chrome.storage wrapper |

## Security

- Tokens are stored in `chrome.storage.local`
- Only connects to configured Xyne Spaces instance
- No third-party data sharing

## License

MIT
