# Hooks

Custom React hooks for reusable logic.

**Location**: `src/hooks/`

## Key Hooks

### Core

| Hook | Purpose |
|------|---------|
| `useZero` | Access Zero client |
| `useAuth` | Authentication state |
| `useQuery` | Zero query wrapper |
| `useCachedQuery` | Cached Zero queries (preferred) |
| `usePermissions` | Permission checks |
| `useTheme` | Theme switching |
| `usePlatform` | Platform detection |

### Data

| Hook | Purpose |
|------|---------|
| `useChannels` | Channel operations |
| `useTickets` | Ticket operations |
| `useUsers` | User data |
| `useCalls` | Call functionality |
| `useWorkflows` | Workflow operations |
| `useUserGroup` | User group data |
| `useUserBookmarks` | User bookmarks |
| `useCustomEmojis` | Custom emoji data |

### UI & Interaction

| Hook | Purpose |
|------|---------|
| `useClickOutside` | Click outside detection |
| `useDebouncedValue` | Debouncing |
| `useDragAndDrop` | Drag and drop |
| `useResizablePanel` | Resizable panels |
| `useChatVirtualiser` | Chat virtualization |
| `useIntersectionObserver` | Intersection observer |
| `useMeasure` | Element measurement |
| `useWindowWidth` | Window width tracking |
| `useSwipeBack` | Swipe back gesture |

### Features

| Hook | Purpose |
|------|---------|
| `useCallActions` | Call actions |
| `useCallConfirmation` | Call confirmation |
| `useTypingIndicator` | Typing indicators |
| `useReaction` | Message reactions |
| `usePin` | Pin operations |
| `useDraft` | Draft messages |
| `useMentionSearch` | Mention search |
| `useSearchFilter` | Search filtering |

### Subscriptions & Tracking

| Hook | Purpose |
|------|---------|
| `useChannelSubscription` | Channel subscription |
| `useWorkflowSubscription` | Workflow subscription |
| `useWorkspaceSubscription` | Workspace subscription |
| `useUnreadCount` | Unread message count |
| `useUnreadThreadsCount` | Unread threads count |
| `useUnreadActivitiesCount` | Unread activities count |
| `useMissedCallCount` | Missed call count |
| `useActivityTracker` | Activity tracking |

### AI & Generation

| Hook | Purpose |
|------|---------|
| `useXyneAIStream` | AI streaming responses |
| `useResearchAgent` | Research agent |
| `useTitleGenerator` | Title generation |
| `useGeneratePRD` | PRD generation |
| `useGenerateDetailedSummary` | Summary generation |
| `useDuplicateTicketCheck` | Duplicate detection |

## Creating a Hook

| Task | Location |
|------|----------|
| Create hook | `src/hooks/use{Name}.ts` |
| Reference pattern | Look at existing hooks |

## Do's 

- Prefix with `use`
- Keep hooks focused on single concern
- Return stable references (useMemo, useCallback)
- Use existing hooks before creating new

## Don'ts 

- Don't put UI logic in hooks
- Don't create hooks with too many responsibilities
- Don't duplicate existing hook functionality
