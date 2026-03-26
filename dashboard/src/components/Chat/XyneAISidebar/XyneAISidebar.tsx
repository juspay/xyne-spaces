import { ReactElement, useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Upload } from 'lucide-react';
import { useDragAndDropAreaRef } from '../../../hooks/useDragAndDropAreaRef';
import { apiInstance } from '../../../services/clients/apiClient';
import { useChannel } from '../../../hooks/useChannels';
import { useXyneAIStream } from '../../../hooks/useXyneAIStream';
import { BASE_URL } from '../../../services/clients/apiClient';
import {
  xyneAIStorage,
  type ConversationHistory as ConversationHistoryType,
} from '../../../utils/xyneAIStorage';
import type { Message, SummarizerCitation, MessageAttachment, UserTag } from './utils/XyneAITypes';
import { buildCitationUrl } from './utils/citationUrlBuilder';
import { XyneAISuggestions } from './components/XyneAISuggestions';
import { XyneAIInputBox, type Attachment } from './components/XyneAIInputBox';
import { MessageItem } from './components/MessageItem';
import { ConversationHistory } from './components/ConversationHistory';
import { XyneAIHeader } from './components/XyneAIHeader';
import { UserActivityPanel } from './components/UserActivityPanel';
import type { UserActivity } from '../../../hooks/useUserActivity';
import { usePlatform } from '../../../hooks/usePlatform';
import {
  xyneAIActor,
  type ThreadInfo,
  type CanvasInfo,
  type XyneAIContext,
  type SelectionInfo,
  flattenCanvasContexts,
} from '../../../machines/xyneAIMachine';
import type { ResearchContext } from '../../../hooks/useResearchAgent';
import { xyneAIStreamManager } from '../../../services/XyneAI';

interface XyneAIConfigResponse {
  webSearchAccessible: boolean;
}

interface XyneAISidebarProps {
  channelId: string | null;
  threadInfo?: ThreadInfo | null;
  startFreshChat?: boolean;
  canvasInfo?: CanvasInfo | null;
}

const XyneAISidebar = ({
  channelId,
  threadInfo,
  canvasInfo,
  startFreshChat = false,
}: XyneAISidebarProps): ReactElement => {
  const [inputValue, setInputValue] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [visibleCharsMap, setVisibleCharsMap] = useState<Record<string, number>>({});
  const [conversationId, setConversationId] = useState<string>('');
  const [currentTraceId, setCurrentTraceId] = useState<string | undefined>();
  const [showHistorySidebar, setShowHistorySidebar] = useState(false);
  const [showUserActivityPanel, setShowUserActivityPanel] = useState(false);
  const [conversations, setConversations] = useState<ConversationHistoryType[]>([]);
  const [feedbackMap, setFeedbackMap] = useState<Record<string, 'LIKE' | 'DISLIKE' | null>>({});
  const [isLoadingConversation, setIsLoadingConversation] = useState(true);
  const [selectedChannelIds, setSelectedChannelIds] = useState<string[]>([]);
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);
  const [createCanvasEnabled, setCreateCanvasEnabled] = useState(false);
  const [selectedResearchContext, setSelectedResearchContext] = useState<ResearchContext | null>(
    null,
  );
  const [activeThreadInfo, setActiveThreadInfo] = useState<ThreadInfo | null>(threadInfo ?? null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [selectedActivities, setSelectedActivities] = useState<UserActivity[]>([]);
  const [browserContext, setBrowserContext] = useState<{
    type: 'browser';
    text: string;
    url: string;
    domain: string;
    title: string;
    timestamp: number;
  } | null>(null);
  const [activeSelectionInfos, setActiveSelectionInfos] = useState<SelectionInfo[]>([]);
  // Track the original channel where the current conversation was started
  // This prevents duplicate history entries when user switches channels during a query
  const [conversationChannelId, setConversationChannelId] = useState<string | null>(null);
  const [currentUserTags, setCurrentUserTags] = useState<Record<string, UserTag>>({});
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  // Use drag and drop hook with the existing pattern
  const {
    dragAndDropAreaRef,
    inputRef: xyneAIInputRef,
    isDragging,
  } = useDragAndDropAreaRef(channelId ?? undefined);
  const { isMobile } = usePlatform();
  // If startFreshChat is true on mount, mark as loaded immediately to prevent loading old data
  const hasLoadedInitialConversationRef = useRef(startFreshChat);

  // Update activeThreadInfo when threadInfo prop changes
  useEffect(() => {
    setActiveThreadInfo(threadInfo ?? null);
  }, [threadInfo]);

  // Track processed selection keys to avoid duplicates
  const processedSelectionKeysRef = useRef<Set<string>>(new Set());

  // Sync processedSelectionKeysRef with activeSelectionInfos to handle removals
  useEffect(() => {
    // Build the current set of active selection keys
    const activeKeys = new Set(activeSelectionInfos.map(s => `${s.canvasViewAccessId}-${s.text}`));
    // Remove keys from processedSelectionKeysRef that are no longer active
    // This allows re-adding the same selection if user removed it and selects again
    processedSelectionKeysRef.current = activeKeys;
  }, [activeSelectionInfos]);

  // Subscribe to xyneAIActor to receive canvasContexts
  useEffect(() => {
    // Function to process canvas contexts and extract selections
    const processCanvasContexts = (context: XyneAIContext): void => {
      // Flatten canvas contexts to get all selections
      const allSelections = flattenCanvasContexts(context.canvasContexts);

      if (allSelections.length > 0) {
        // Find new selections that haven't been processed
        const newSelections: SelectionInfo[] = [];

        for (const selection of allSelections) {
          const selectionKey = `${selection.canvasViewAccessId}-${selection.text}`;

          if (!processedSelectionKeysRef.current.has(selectionKey)) {
            processedSelectionKeysRef.current.add(selectionKey);
            newSelections.push(selection);
          }
        }

        // Add new selections to existing ones
        if (newSelections.length > 0) {
          setActiveSelectionInfos(prev => [...prev, ...newSelections]);
        }
      }
    };

    // Check current state immediately (for cases where sidebar opens after the event)
    const currentSnapshot = xyneAIActor.getSnapshot();
    if (currentSnapshot) {
      processCanvasContexts(currentSnapshot.context);
    }

    // Subscribe to future changes
    const subscription = xyneAIActor.subscribe(snapshot => {
      processCanvasContexts(snapshot.context);
    });

    return () => {
      subscription.unsubscribe();
      // Clear processed selection keys on unmount to prevent memory leak
      processedSelectionKeysRef.current.clear();
    };
  }, []);

  // Notify stream manager when sidebar opens/closes
  useEffect(() => {
    // Sidebar is open when this component mounts
    xyneAIStreamManager.setSidebarOpen(true);

    // Check for pending completion notifications
    if (channelId) {
      const threadId = activeThreadInfo?.conversationId
        ? `${channelId}_${activeThreadInfo.conversationId}`
        : channelId;

      if (xyneAIStreamManager.hasPendingCompletion(threadId)) {
        xyneAIStreamManager.clearPendingCompletion(threadId);
      }
    }

    return () => {
      // Sidebar is closing when this component unmounts
      xyneAIStreamManager.setSidebarOpen(false);
    };
  }, [channelId, activeThreadInfo?.conversationId]);

  const channel = useChannel(channelId || '');

  const channelName = (channel?.['name'] as string) || '';

  const channelDescription = (channel?.['description'] as string) || '';

  const scopeType = (channel?.['scopeType'] as string) || '';

  // Fetch web search configuration from backend
  const { data: configData } = useQuery<XyneAIConfigResponse>({
    queryKey: ['xyne-ai-config'],
    queryFn: async (): Promise<XyneAIConfigResponse> => {
      const response = await apiInstance.get<XyneAIConfigResponse>('/xyne-ai/config');
      return response.data;
    },
  });

  const webSearchAccessible = configData?.webSearchAccessible ?? false;

  // Auto-enable web search when browser context is provided (and user has access)
  // Web search stays enabled for the session to allow follow-up questions
  useEffect(() => {
    if (browserContext && webSearchAccessible && !webSearchEnabled) {
      console.log('[XyneAISidebar] Auto-enabling web search for browser context');
      setWebSearchEnabled(true);
    }
  }, [browserContext, webSearchAccessible, webSearchEnabled]);

  // Suggestion queries - different based on context
  const suggestionQueries = channelId
    ? ['Summarize this channel', 'Notes shared last week', 'SR trend today']
    : ['How can I help you?', 'Ask me anything', 'General assistance'];

  // Use the streaming hook with selected channel IDs, research context, and active thread info
  const { submitQuery, abortCurrentRequest } = useXyneAIStream({
    channelIds: selectedChannelIds,
    conversationId,
    threadConversationId: activeThreadInfo?.conversationId,
    attachmentIds: activeThreadInfo?.attachmentIds,
    canvasViewAccessId: canvasInfo?.viewAccessId ?? null,
    setMessages,
    setConversationId,
    setCurrentTraceId,
    webSearchEnabled: webSearchAccessible ? webSearchEnabled : false,
    researchContext: selectedResearchContext,
    createCanvasEnabled,
    channelId: channelId || undefined, // Pass channelId for thread ID construction
  });

  // Start fresh chat when startFreshChat flag is set
  // This is triggered when XyneAI is invoked from "Ask AI" button
  useEffect(() => {
    if (startFreshChat) {
      // Reset to fresh state (keeps threadInfo but clears messages/conversation)
      setMessages([]);
      setConversationId('');
      setCurrentTraceId(undefined);
      setInputValue('');
      setAttachments([]);
      setSelectedActivities([]);
      setVisibleCharsMap({});
      setShowHistorySidebar(false);
      setShowUserActivityPanel(false);

      hasLoadedInitialConversationRef.current = true;

      // Abort any existing streams for this thread
      abortCurrentRequest();

      // Reset the flag in the machine after handling it
      xyneAIActor.send({
        type: 'OPEN',
        ...(channelId && { channelId }),
        ...(threadInfo && { threadInfo }),
        startFreshChat: false,
      });
    }
  }, [startFreshChat, channelId, threadInfo, abortCurrentRequest]);

  // Scroll to bottom function
  const scrollToBottom = useCallback((): void => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  // Load most recent conversation on mount
  // Thread context: load thread-specific conversation (channel-specific)
  // Global context: load most recent conversation across all channels
  useEffect(() => {
    if (hasLoadedInitialConversationRef.current) {
      setIsLoadingConversation(false);
      return;
    }

    // For startFreshChat, skip loading and start fresh immediately
    if (startFreshChat) {
      hasLoadedInitialConversationRef.current = true;
      setIsLoadingConversation(false);
      return;
    }

    const loadMostRecentConversation = async (): Promise<void> => {
      try {
        setIsLoadingConversation(true);

        // Get thread conversation ID if in thread context
        const threadConversationId = activeThreadInfo?.conversationId;

        // Check if there's an active stream - if so, sync with it instead of loading from storage
        let activeStream;
        if (threadConversationId && channelId) {
          // Thread context: check for thread-specific active stream
          const threadId = `${channelId}_${threadConversationId}`;
          activeStream = xyneAIStreamManager.getActiveStream(threadId);
        } else {
          // Global context: check for any active global stream (across all channels)
          activeStream = xyneAIStreamManager.getActiveGlobalStream();
        }

        if (activeStream) {
          // Stream is active, sync messages from stream state
          setMessages(activeStream.messages);
          if (activeStream.sessionId) {
            setConversationId(activeStream.sessionId);
          }
          // Set the original channel ID from the stream's threadId
          // threadId format is "channelId" or "channelId_threadConversationId"
          const originalChannelId = activeStream.threadId.split('_')[0];
          setConversationChannelId(originalChannelId || null);
          setIsLoadingConversation(false);
          hasLoadedInitialConversationRef.current = true;
          return;
        }

        let mostRecent;
        if (threadConversationId && channelId) {
          // Thread context: load thread-specific conversation
          mostRecent = await xyneAIStorage.loadLatestConversation(channelId, threadConversationId);
        } else {
          // Global context: load most recent conversation across all channels
          mostRecent = await xyneAIStorage.loadLatestGlobalConversation();
        }

        hasLoadedInitialConversationRef.current = true;

        if (!mostRecent) {
          setIsLoadingConversation(false);
          return;
        }

        // Set the original channel ID from the loaded conversation
        setConversationChannelId(mostRecent.channelId);

        // Clear streaming state and mark aborted messages
        const messagesWithoutStreaming = mostRecent.messages.map(msg => {
          // Check if this was a bot message that was streaming but got aborted
          if (
            msg.type === 'bot' &&
            msg.isStreaming &&
            (!msg.content || msg.content.trim().length === 0) &&
            (!msg.toolOutputs || msg.toolOutputs.length === 0)
          ) {
            return {
              ...msg,
              isStreaming: false,
              isAborted: true,
              content: 'Answer was aborted. Please try asking your question again.',
            };
          }
          return {
            ...msg,
            isStreaming: false,
          };
        });
        setMessages(messagesWithoutStreaming);
        setConversationId(mostRecent.sessionId);

        // Restore feedback from stored messages
        const restoredFeedbackMap: Record<string, 'LIKE' | 'DISLIKE' | null> = {};
        mostRecent.messages.forEach(msg => {
          if (msg.feedback === 1) {
            restoredFeedbackMap[msg.id] = 'LIKE';
          } else if (msg.feedback === 2) {
            restoredFeedbackMap[msg.id] = 'DISLIKE';
          } else {
            restoredFeedbackMap[msg.id] = null;
          }
        });
        setFeedbackMap(restoredFeedbackMap);

        // Scroll to bottom after loading
        setTimeout(() => {
          scrollToBottom();
        }, 100);
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error('[XyneAISidebar] Failed to load most recent conversation:', error);
      } finally {
        setIsLoadingConversation(false);
      }
    };

    void loadMostRecentConversation();
  }, [channelId, activeThreadInfo?.conversationId, scrollToBottom, startFreshChat]);

  // Load conversations list when history sidebar is opened
  // History is global across all channels, not channel-specific
  useEffect(() => {
    if (!showHistorySidebar) return;

    const loadConversations = async (): Promise<void> => {
      try {
        const allConversations = await xyneAIStorage.getAllConversations();
        // Sort by lastUpdated descending to ensure consistent order
        const sortedConversations = allConversations.sort(
          (a, b) => b.lastUpdated.getTime() - a.lastUpdated.getTime(),
        );
        setConversations(sortedConversations);
      } catch (error) {
        console.error('[XyneAISidebar] Failed to load conversations:', error);
      }
    };

    void loadConversations();
  }, [showHistorySidebar]);

  // Save conversation history to IndexedDB whenever messages change
  useEffect(() => {
    const saveHistory = async (): Promise<void> => {
      // Don't save empty conversations or conversations without a session ID
      // Use conversationChannelId (original channel) to prevent duplicates when switching channels
      const saveChannelId = conversationChannelId || channelId;
      if (messages.length === 0 || !conversationId || !saveChannelId) {
        return;
      }

      // Don't save if there are any streaming messages
      // The stream manager handles persistence of active streams separately
      // This prevents saving incomplete/streaming state that would show as "aborted" on reload
      const hasStreamingMessages = messages.some(m => m.isStreaming);
      if (hasStreamingMessages) {
        return;
      }

      try {
        const threadConversationId = activeThreadInfo?.conversationId;
        await xyneAIStorage.saveConversation(
          saveChannelId,
          conversationId,
          messages,
          threadConversationId,
        );
      } catch (error) {
        console.error('[XyneAISidebar] Failed to save conversation history:', error);
      }
    };

    void saveHistory();
  }, [
    messages,
    channelId,
    conversationChannelId,
    conversationId,
    activeThreadInfo?.conversationId,
  ]);

  // Character reveal animation for streaming messages
  useEffect(() => {
    const streamingMessages = messages.filter(m => {
      if (!m.isStreaming) return false;

      // For Genius (or undefined agentType), check streamingContent
      if ((!m.agentType || m.agentType === 'genius') && m.streamingContent) return true;

      // For Summarizer, check summarizerOutput.summary
      if (m.agentType === 'summarizer' && m.summarizerOutput?.summary) return true;

      return false;
    });

    if (streamingMessages.length === 0) return;

    const timer = setTimeout(() => {
      setVisibleCharsMap(prev => {
        const updated = { ...prev };
        for (const msg of streamingMessages) {
          // Get the text content to reveal
          const content =
            msg.agentType === 'summarizer'
              ? msg.summarizerOutput?.summary || ''
              : msg.streamingContent || '';

          const currentVisible = prev[msg.id] || 0;
          if (currentVisible < content.length) {
            const charsToReveal = Math.min(5, content.length - currentVisible);
            updated[msg.id] = currentVisible + charsToReveal;
          }
        }
        return updated;
      });
    }, 10);

    return () => {
      clearTimeout(timer);
    };
  }, [messages, visibleCharsMap]);

  const handleSuggestionClick = (query: string): void => {
    setInputValue(query);
  };

  const handleLoadConversation = (conversation: ConversationHistoryType): void => {
    try {
      // Clear streaming state and mark aborted messages
      const messagesWithoutStreaming = conversation.messages.map(msg => {
        // Check if this was a bot message that was streaming but got aborted
        if (
          msg.type === 'bot' &&
          msg.isStreaming &&
          (!msg.content || msg.content.trim().length === 0) &&
          (!msg.toolOutputs || msg.toolOutputs.length === 0)
        ) {
          return {
            ...msg,
            isStreaming: false,
            isAborted: true,
            content: 'Answer was aborted. Please try asking your question again.',
          };
        }
        return {
          ...msg,
          isStreaming: false,
        };
      });
      setMessages(messagesWithoutStreaming);
      setConversationId(conversation.sessionId);
      // Set the original channel ID from the loaded conversation
      setConversationChannelId(conversation.channelId);
      setShowHistorySidebar(false);

      // Restore feedback from stored messages
      const restoredFeedbackMap: Record<string, 'LIKE' | 'DISLIKE' | null> = {};
      conversation.messages.forEach(msg => {
        if (msg.feedback === 1) {
          restoredFeedbackMap[msg.id] = 'LIKE';
        } else if (msg.feedback === 2) {
          restoredFeedbackMap[msg.id] = 'DISLIKE';
        } else {
          restoredFeedbackMap[msg.id] = null;
        }
      });
      setFeedbackMap(restoredFeedbackMap);

      // Scroll to bottom after loading conversation
      setTimeout(() => {
        scrollToBottom();
      }, 100);
    } catch (error) {
      console.error('[XyneAISidebar] Failed to load conversation:', error);
    }
  };

  const handleToggleStar = async (conversation: ConversationHistoryType): Promise<void> => {
    try {
      await xyneAIStorage.toggleStar(
        conversation.channelId,
        conversation.sessionId,
        conversation.threadConversationId,
      );
      // Reload all conversations to update UI (history is global)
      const allConversations = await xyneAIStorage.getAllConversations();
      const sortedConversations = allConversations.sort(
        (a, b) => b.lastUpdated.getTime() - a.lastUpdated.getTime(),
      );
      setConversations(sortedConversations);
    } catch (error) {
      console.error('[XyneAISidebar] Failed to toggle star:', error);
    }
  };

  const handleDeleteConversation = async (conversation: ConversationHistoryType): Promise<void> => {
    try {
      await xyneAIStorage.deleteConversation(
        conversation.channelId,
        conversation.sessionId,
        conversation.threadConversationId,
      );
      // Reload all conversations (history is global)
      const allConversations = await xyneAIStorage.getAllConversations();
      const sortedConversations = allConversations.sort(
        (a, b) => b.lastUpdated.getTime() - a.lastUpdated.getTime(),
      );
      setConversations(sortedConversations);
      // If deleted conversation was active, clear messages
      if (conversation.sessionId === conversationId) {
        setMessages([]);
        setConversationId('');
      }
    } catch (error) {
      console.error('[XyneAISidebar] Failed to delete conversation:', error);
    }
  };

  const handleRenameConversation = async (
    conversation: ConversationHistoryType,
    newName: string,
  ): Promise<void> => {
    try {
      await xyneAIStorage.renameConversation(
        conversation.channelId,
        conversation.sessionId,
        newName,
        conversation.threadConversationId,
      );

      // Reload all conversations (history is global)
      const allConversations = await xyneAIStorage.getAllConversations();
      const sortedConversations = allConversations.sort(
        (a, b) => b.lastUpdated.getTime() - a.lastUpdated.getTime(),
      );
      setConversations(sortedConversations);
    } catch (error) {
      console.error('[XyneAISidebar] Failed to rename conversation:', error);
    }
  };

  const handleNewChat = (): void => {
    // Reset to fresh state
    setMessages([]);
    setConversationId('');
    setConversationChannelId(null); // Reset so new conversation uses current channel
    setCurrentTraceId(undefined);
    setInputValue('');
    setAttachments([]);
    setSelectedActivities([]);
    setActiveSelectionInfos([]);
    setVisibleCharsMap({});
    setShowHistorySidebar(false);
    setShowUserActivityPanel(false);

    // Clear processed selection keys to prevent memory leak
    processedSelectionKeysRef.current.clear();

    // Don't abort - let streams continue in background
    // When user submits a new query, the stream manager will handle aborting
    // any existing stream for the same thread (see XyneAIStreamManager.startStream)
  };

  const handleAddActivities = useCallback((activities: UserActivity[]): void => {
    if (activities.length === 0) return;
    setSelectedActivities(prev => {
      const existingIds = new Set(prev.map(a => a.id));
      const newActivities = activities.filter(a => !existingIds.has(a.id));
      const combined = [...prev, ...newActivities];
      return combined.sort(
        (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
      );
    });

    setShowUserActivityPanel(false);
  }, []);

  const handleFeedback = useCallback(
    async (messageId: string, feedbackType: 'LIKE' | 'DISLIKE'): Promise<void> => {
      // Toggle feedback - if already selected, deselect it
      const currentFeedback = feedbackMap[messageId];
      const newFeedback = currentFeedback === feedbackType ? null : feedbackType;

      // Update UI immediately
      setFeedbackMap(prev => ({
        ...prev,
        [messageId]: newFeedback,
      }));

      // Update the message with feedback value (1 for LIKE, 2 for DISLIKE)
      setMessages(prevMessages =>
        prevMessages.map(msg => {
          if (msg.id === messageId) {
            const { feedback: _removedFeedback, ...msgWithoutFeedback } = msg;
            if (newFeedback === 'LIKE') {
              return { ...msgWithoutFeedback, feedback: 1 };
            } else if (newFeedback === 'DISLIKE') {
              return { ...msgWithoutFeedback, feedback: 2 };
            }
            return msgWithoutFeedback;
          }
          return msg;
        }),
      );

      // Only make API call if setting feedback (not when removing)
      if (newFeedback && currentTraceId) {
        try {
          // eslint-disable-next-line local-rules/no-fetch-use-axios
          await fetch(`${BASE_URL}/xyne-ai/feedback`, {
            method: 'POST',
            headers: {
              // eslint-disable-next-line @typescript-eslint/naming-convention
              'Content-Type': 'application/json',
            },
            credentials: 'include',
            body: JSON.stringify({
              traceId: currentTraceId,
              value: newFeedback,
            }),
          });
        } catch (error) {
          console.error('[XyneAISidebar] Failed to submit feedback:', error);
          // Revert UI state on error
          setFeedbackMap(prev => ({
            ...prev,
            [messageId]: currentFeedback ?? null,
          }));
          // Revert message feedback
          setMessages(prevMessages =>
            prevMessages.map(msg => {
              if (msg.id === messageId) {
                const { feedback: _removedFeedback, ...msgWithoutFeedback } = msg;
                if (currentFeedback === 'LIKE') {
                  return { ...msgWithoutFeedback, feedback: 1 };
                } else if (currentFeedback === 'DISLIKE') {
                  return { ...msgWithoutFeedback, feedback: 2 };
                }
                return msgWithoutFeedback;
              }
              return msg;
            }),
          );
        }
      }
    },
    [feedbackMap, currentTraceId],
  );

  const handleCitationClick = useCallback(
    (
      messageNumber: number,
      conversationIdMapping: Record<string, string>,
      messageIdMapping: Record<string, string>,
      channelIdMapping?: Record<string, string>,
    ): void => {
      const convId = conversationIdMapping[String(messageNumber)];
      const msgId = messageIdMapping[String(messageNumber)];
      // Use channelId from mapping if available, otherwise fallback to current channelId
      const citationChannelId = channelIdMapping?.[String(messageNumber)] || channelId;

      if (!convId || !citationChannelId) return;

      // Navigate - XyneAI will stay open via xstate machine
      if (msgId) {
        void navigate(
          `/chat/dir/${citationChannelId}/${convId}#origin=${convId}&messageId=${msgId}`,
        );
      } else {
        void navigate(`/chat/dir/${citationChannelId}/${convId}`);
      }

      // Close XyneAI modal on mobile after navigation
      if (isMobile) {
        xyneAIActor.send({ type: 'CLOSE' });
      }
    },
    [channelId, navigate],
  );

  // Handle Summarizer citation clicks
  const handleSummarizerCitationClick = useCallback(
    (citation: SummarizerCitation): void => {
      // Build URL from citation metadata
      const url = buildCitationUrl(citation);

      if (!url) {
        console.warn('[XyneAI] Cannot build URL for citation:', citation);
        return;
      }

      // Use explicit isExternal flag to determine routing behavior
      if (citation.isExternal) {
        // Open external citations (web search results) in new tab
        window.open(url, '_blank', 'noopener,noreferrer');
      } else {
        // Navigate to internal entity citations
        void navigate(url);
      }

      // Close sidebar on mobile after navigation
      if (isMobile) {
        xyneAIActor.send({ type: 'CLOSE' });
      }
    },
    [navigate, isMobile],
  );

  const formatActivitiesAsText = (activities: UserActivity[]): string => {
    if (activities.length === 0) return '';

    const activityLines = activities
      .reverse()
      .map(
        (activity, index) =>
          `${index + 1}. [${activity.eventName}] (${activity.eventCategory})
          Metadata: ${activity.contextMetadata ? JSON.stringify(activity.contextMetadata) : 'N/A'}
          RelatedInformation: ${activity.relatedData ? JSON.stringify(activity.relatedData) : 'N/A'}
          Timestamp: ${activity.timestamp ?? 'N/A'}\n`,
      )
      .join('\n');

    return `\nUser journey across app:\n${activityLines}`;
  };

  const handleSubmit = useCallback(async (): Promise<void> => {
    // Allow submission if there's input, activities, OR selection contexts
    if (!inputValue.trim() && selectedActivities.length === 0 && activeSelectionInfos.length === 0)
      return;

    // Store the display content (what the user typed, without hidden context)
    const displayContent = inputValue.trim();

    // Build the full query with all context for the AI
    let query = inputValue;

    if (selectedActivities.length > 0) {
      query = query + formatActivitiesAsText(selectedActivities);
    }

    // Add browser context if present (hidden from display but sent to AI)
    if (browserContext) {
      const contextText = `\n\n[Browser Context]\nSelected Text: "${browserContext.text}"\nFrom: ${browserContext.title} (${browserContext.url})\nDomain: ${browserContext.domain}`;
      query = query + contextText;
    }

    // Note: Selection text is NOT appended to query here - it's handled internally in useXyneAIStream
    // The user message will show original query + selectionContexts as visual cards

    const currentAttachments = attachments;

    // Convert attachments to MessageAttachment format for display
    const messageAttachments: MessageAttachment[] = currentAttachments.map(att => ({
      filename: att.filename,
      mimeType: att.mimeType,
      data: att.data,
    }));

    // Build selection contexts for UI display and internal formatting
    const selectionContexts =
      activeSelectionInfos.length > 0
        ? activeSelectionInfos.map(selection => ({
            canvasViewAccessId: selection.canvasViewAccessId,
            selectedText: selection.text,
            preview: selection.preview,
            ...(selection.canvasTitle && { canvasTitle: selection.canvasTitle }),
          }))
        : undefined;

    setInputValue('');
    setAttachments([]);
    setSelectedActivities([]);
    setBrowserContext(null); // Clear browser context after submit
    // Note: Don't clear selection infos - they persist for follow-up questions

    // Set the channel ID for this conversation if not already set
    // This ensures the conversation is saved to the correct channel even if user switches channels
    if (!conversationChannelId && channelId) {
      setConversationChannelId(channelId);
    }

    // Scroll immediately after clearing input, before query is submitted
    setTimeout(() => {
      scrollToBottom();
    }, 50);

    // Include userTags in the user message for display
    const userTagsForMessage =
      Object.keys(currentUserTags).length > 0 ? currentUserTags : undefined;

    await submitQuery(
      query,
      messageAttachments,
      selectionContexts,
      displayContent,
      userTagsForMessage,
    );
  }, [
    inputValue,
    attachments,
    selectedActivities,
    activeSelectionInfos,
    browserContext,
    currentUserTags,
    submitQuery,
    scrollToBottom,
    conversationChannelId,
    channelId,
  ]);

  return (
    <div
      ref={dragAndDropAreaRef}
      className={`w-full ${isMobile ? 'h-[95vh] pb-4' : 'h-full rounded-xl'} bg-background flex flex-col min-h-0 relative`}
    >
      {/* Drag and Drop Overlay */}
      {isDragging && (
        <div className='absolute inset-0 z-50 bg-background/95 backdrop-blur-sm rounded-xl flex flex-col items-center justify-center border-2 border-dashed border-primary/50'>
          <div className='flex flex-col items-center gap-3'>
            <div className='p-4 rounded-full bg-primary/10'>
              <Upload className='w-8 h-8 text-primary' />
            </div>
            <div className='text-center'>
              <p className='text-lg font-medium text-foreground'>Drop files to attach</p>
              <p className='text-sm text-muted-foreground'>
                Images, PDF, text, office documents, or data files
              </p>
            </div>
          </div>
        </div>
      )}
      {/* Header */}
      {showHistorySidebar ? (
        <ConversationHistory
          conversations={conversations}
          conversationId={conversationId}
          onBack={() => setShowHistorySidebar(false)}
          onLoadConversation={handleLoadConversation}
          onToggleStar={handleToggleStar}
          onDeleteConversation={handleDeleteConversation}
          onRenameConversation={handleRenameConversation}
        />
      ) : showUserActivityPanel ? (
        <UserActivityPanel
          isOpen={showUserActivityPanel}
          onClose={() => setShowUserActivityPanel(false)}
          onAddToChat={handleAddActivities}
        />
      ) : (
        <>
          {/* Header - Fixed at Top */}
          <XyneAIHeader
            onNewChat={handleNewChat}
            onShowHistory={() => setShowHistorySidebar(true)}
            onShowUserActivity={() => setShowUserActivityPanel(true)}
            isMobile={isMobile}
          />

          {/* Content - Scrollable Area */}
          <div className='flex-1 overflow-y-auto overflow-x-hidden min-h-0'>
            {isLoadingConversation ? (
              // Shimmer loading state
              <div className='px-4 py-4'>
                <div className='space-y-4'>
                  {/* User message shimmer */}
                  <div className='flex justify-end'>
                    <div className='w-3/4 h-12 bg-muted rounded-xl animate-pulse' />
                  </div>
                  {/* Bot message shimmer */}
                  <div className='flex justify-start'>
                    <div className='w-full space-y-2'>
                      <div className='h-4 bg-muted rounded animate-pulse' />
                      <div className='h-4 bg-muted rounded animate-pulse w-5/6' />
                      <div className='h-4 bg-muted rounded animate-pulse w-4/6' />
                    </div>
                  </div>
                </div>
              </div>
            ) : messages.length === 0 ? (
              <XyneAISuggestions
                queries={suggestionQueries}
                onSuggestionClick={handleSuggestionClick}
              />
            ) : (
              <div className='px-4 py-4'>
                <div className='space-y-4 max-w-full'>
                  {messages.map(message => (
                    <MessageItem
                      key={message.id}
                      message={message}
                      visibleChars={visibleCharsMap[message.id] || 0}
                      onFeedback={(id, type) => void handleFeedback(id, type)}
                      onCitationClick={handleCitationClick}
                      onSummarizerCitationClick={handleSummarizerCitationClick}
                      feedbackValue={feedbackMap[message.id] || null}
                    />
                  ))}
                  <div ref={messagesEndRef} />
                </div>
              </div>
            )}
          </div>

          {/* Input Box - Fixed at Bottom */}
          <XyneAIInputBox
            ref={xyneAIInputRef}
            channelId={channelId}
            channelName={channelName}
            channelDescription={channelDescription}
            scopeType={scopeType}
            showChannelTag={true}
            threadInfo={activeThreadInfo}
            canvasInfo={canvasInfo}
            selectionInfos={activeSelectionInfos}
            inputValue={inputValue}
            onInputChange={setInputValue}
            onSubmit={() => void handleSubmit()}
            onSelectedChannelsChange={setSelectedChannelIds}
            onResearchContextChange={setSelectedResearchContext}
            onThreadInfoChange={setActiveThreadInfo}
            onSelectionInfosChange={setActiveSelectionInfos}
            onAttachmentsChange={setAttachments}
            onBrowserContextChange={setBrowserContext}
            selectedActivities={selectedActivities}
            onActivitiesChange={setSelectedActivities}
            isStreaming={messages.some(m => m.isStreaming)}
            onAbort={abortCurrentRequest}
            webSearchEnabled={webSearchEnabled}
            webSearchAccessible={webSearchAccessible}
            onWebSearchToggle={() => setWebSearchEnabled(!webSearchEnabled)}
            createCanvasEnabled={createCanvasEnabled}
            onCreateCanvasToggle={() => setCreateCanvasEnabled(!createCanvasEnabled)}
            onUserTagsChange={setCurrentUserTags}
          />
        </>
      )}
    </div>
  );
};

export default XyneAISidebar;
