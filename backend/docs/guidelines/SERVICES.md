# Backend Services Guide

Services contain the core business logic. Located in `src/services/`.

---

## Service Categories

### User & Auth
| Service | Purpose |
|---------|---------|
| `userService.ts` | User CRUD, find by Google ID/email, profile management, presence status |
| `userManagementService.ts` | User administration, role management |
| `userSessionService.ts` | Session management, session tracking |
| `userStatusService.ts` | Online/offline/away status management |
| `jwtService.ts` | JWT token generation and validation with configurable expiry |
| `apiKeyService.ts` | API key generation, validation, and management |
| `aclService.ts` | Access control lists, permission checking by resource/action |
| `aclAuditService.ts` | ACL audit logging for compliance |
| `userAssignmentStateService.ts` | Track user assignment states |
| `userCountService.ts` | User statistics and counts |

### Tickets
| Service | Purpose |
|---------|---------|
| `ticketService.ts` | Core ticket operations, stage updates, PR status sync |
| `ticketAssignmentService.ts` | Ticket assignment logic, workload balancing |
| `ticketDuplicateService.ts` | AI-powered duplicate ticket detection |
| `ticketNudgeService.ts` | Ticket reminder nudges and notifications |
| `tickets/descriptionCleaner/` | Clean and normalize ticket descriptions |

### Communication
| Service | Purpose |
|---------|---------|
| `conversationService.ts` | Conversation CRUD, message creation, participant management, mention extraction |
| `conversationSummarizationService.ts` | AI-powered conversation summarization |
| `messageClassifierService.ts` | Classify messages by type/intent |
| `messageCountService.ts` | Message statistics and counting |
| `typingService.ts` | Real-time typing indicators |
| `unreadService.ts` | Track unread messages per user |
| `websocketService.ts` | Socket.IO WebSocket server, room management, real-time events |

### Calls & Media
| Service | Purpose |
|---------|---------|
| `liveKitService.ts` | LiveKit video/audio calls, room creation, token generation (singleton) |
| `callCountService.ts` | Call statistics and duration tracking |
| `callDocumentService.ts` | Documents shared during calls |
| `callSideEffectService.ts` | Post-call actions (notifications, updates) |
| `transcriptService.ts` | Call transcription, AI summaries, GCS storage |
| `meetLinkService.ts` | Generate meeting links |

### Storage & Files
| Service | Purpose |
|---------|---------|
| `gcsService.ts` | Google Cloud Storage operations, upload/download/delete |
| `gcsServiceFactory.ts` | Factory for creating GCS service instances per bucket |
| `gcsPollingService.ts` | Poll GCS for file changes (transcriptions) |
| `fileUploadService.ts` | Handle file uploads with validation |
| `fileValidationService.ts` | Validate file types, sizes, content |
| `attachmentUploadService.ts` | Message attachment uploads |
| `attachmentRetrievalService.ts` | Retrieve attachments with signed URLs |
| `externalAttachmentService.ts` | Handle external platform attachments |

### Search & Query
| Service | Purpose |
|---------|---------|
| `search/searchService.ts` | Full-text and semantic search |
| `search/SearchQueryBuilder.ts` | Build search queries |
| `search/QueryValidationService.ts` | Validate search queries |
| `queryService/queryService.ts` | Generic query execution |
| `queryService/genericQueryBuilder.ts` | Dynamic query construction |
| `queryService/genericFieldRegistry.ts` | Field definitions for queries |
| `vespaSearch/` | Vespa vector search operations |
| `vespaTransformers.ts` | Transform data for Vespa indexing |

### Notifications
| Service | Purpose |
|---------|---------|
| `notificationService.ts` | Core notification logic, multi-channel delivery, user preferences |
| `fcmService.ts` | Firebase Cloud Messaging for Android, access token management |
| `apnsService.ts` | Apple Push Notification Service for iOS |
| `emailService.ts` | Email notifications, email-to-conversation sync |
| `slackService.ts` | Slack message sending, DM by email |

### Git & Code
| Service | Purpose |
|---------|---------|
| `bitbucketService.ts` | Bitbucket API operations, PR fetching, comments |
| `bitbucketWebhookService.ts` | Process Bitbucket webhooks |
| `multiBitbucketService.ts` | Multi-repository Bitbucket operations |
| `pullRequestDbService.ts` | PR database operations |
| `pullRequestValidationService.ts` | Validate PR data |
| `multiPullRequestService.ts` | Multi-PR operations |
| `prTicketStatusSyncService.ts` | Sync PR status with ticket status |
| `commitAnalysisService.ts` | Analyze commits, detect changes, release analysis |
| `jenkinsService.ts` | Jenkins CI integration, trigger builds, fetch stages |

### AI & Agents
| Service | Purpose |
|---------|---------|
| `agentService.ts` | Agent orchestration, DB-to-framework bridge, caching (singleton) |
| `aiContextService.ts` | Manage AI context and conversation history |
| `researchAgentService.ts` | Research agent for information gathering |
| `agents/` | Agent-specific services |
| `bots/` | Bot services |

### Activity & Analytics
| Service | Purpose |
|---------|---------|
| `activity/activityService.ts` | Core activity tracking |
| `activity/activityClassificationService.ts` | ML-based activity classification |
| `activity/activityClassificationWorkerService.ts` | Background classification |
| `eventService.ts` | Store workflow events for step responses |
| `workspaceEventService.ts` | Workspace-level event tracking |

### Personalization
| Service | Purpose |
|---------|---------|
| `personalization/PersonalizationSignalService.ts` | Process personalization signals |
| `personalization/MessageSignalService.ts` | Extract signals from messages |
| `productInsightsService.ts` | Product usage insights |
| `productInsightsPipeline.ts` | Insights processing pipeline |
| `productInsightsClustering/` | Cluster insights for patterns |

### Documents & Canvas
| Service | Purpose |
|---------|---------|
| `docsService.ts` | Quarto docs publishing, GCS storage, channel scoping |
| `canvasService.ts` | BlockNote canvas/whiteboard, knowledge learnings |
| `canvasAuthService.ts` | Canvas access authentication |
| `linkPreviewService.ts` | Fetch URL metadata (Open Graph, Twitter Cards) |
| `formService.ts` | Form creation and field management |

### Infrastructure
| Service | Purpose |
|---------|---------|
| `redisService.ts` | Redis operations, pub/sub, caching, session events |
| `lockService.ts` | Distributed locking for workflow executions |
| `encryptionService.ts` | AES-256-CBC encryption/decryption for sensitive data |
| `configSyncService.ts` | Configuration synchronization |
| `zeroRateLimiter.ts` | Rate limiting for Zero sync |
| `superpositionClient.ts` | Feature flags via OpenFeature SDK (singleton) |

### External Integrations
| Service | Purpose |
|---------|---------|
| `zohoService.ts` | Zoho Desk API, send replies with sourceId |
| `oauthStateServiceV2.ts` | OAuth state management |
| `pkceServiceV2.ts` | PKCE authentication flow |

### Release Management
| Service | Purpose |
|---------|---------|
| `release/applicationBackfillService.ts` | Data backfilling |
| `release/core/` | Core release logic, change detection, diff parsing |
| `release/xyne/` | Xyne-specific release workflows |

---

## Singleton Services

Some services use singleton pattern for shared state or expensive initialization:

| Service | Access |
|---------|--------|
| `LiveKitService` | `LiveKitService.getInstance()` |
| `AgentService` | `AgentService.getInstance()` |
| `ACLService` | `ACLService.getInstance()` |
| `superpositionClient` | Import directly (pre-initialized) |
| `redisService` | Import directly (pre-initialized) |
| `websocketService` | Import directly (pre-initialized) |

---

## Service Subdirectories

### `activity/`
Activity tracking and classification.
- `activityService.ts` - Core activity operations
- `activityClassificationService.ts` - ML-based classification
- `activityClassificationWorkerService.ts` - Background classification

### `search/`
Search functionality.
- `searchService.ts` - Main search operations
- `SearchQueryBuilder.ts` - Query construction
- `QueryValidationService.ts` - Query validation

### `queryService/`
Generic query building.
- `queryService.ts` - Query execution
- `genericQueryBuilder.ts` - Dynamic query construction
- `genericFieldRegistry.ts` - Field definitions

### `personalization/`
User personalization.
- `PersonalizationSignalService.ts` - Signal processing
- `MessageSignalService.ts` - Message-based signals

### `release/`
Release management.
- `applicationBackfillService.ts` - Data backfilling
- `core/` - Core release logic
- `xyne/` - Xyne-specific release logic


### Rules
- Services are stateless
- Throw `AppError` for expected errors
- Log significant operations
- Call repositories for data access
- May call other services for complex operations
