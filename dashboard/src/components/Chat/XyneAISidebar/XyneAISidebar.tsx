import { ReactElement, useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useChannel } from '../../../hooks/useChannels';
import { useSelf } from '../../../hooks/useUsers';
import { useXyneAIStream } from '../../../hooks/useXyneAIStream';
import { BASE_URL } from '../../../services/clients/apiClient';
import {
  xyneAIStorage,
  type ConversationHistory as ConversationHistoryType,
} from '../../../utils/xyneAIStorage';
import type { Message, SummarizerCitation, MessageAttachment } from './utils/XyneAITypes';
import { buildCitationUrl } from './utils/citationUrlBuilder';
import { XyneAISuggestions } from './components/XyneAISuggestions';
import { XyneAIInputBox, type Attachment } from './components/XyneAIInputBox';
import { MessageItem } from './components/MessageItem';
import { ConversationHistory } from './components/ConversationHistory';
import { XyneAIHeader } from './components/XyneAIHeader';
import { UserActivityPanel } from './components/UserActivityPanel';
import type { UserActivity } from '../../../hooks/useUserActivity';
import { usePlatform } from '../../../hooks/usePlatform';
import { xyneAIActor, type ThreadInfo } from '../../../machines/xyneAIMachine';
import type { ResearchContext } from '../../../hooks/useResearchAgent';

interface XyneAISidebarProps {
  channelId: string | null;
  threadInfo?: ThreadInfo | null;
}

const XyneAISidebar = ({ channelId, threadInfo }: XyneAISidebarProps): ReactElement => {
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
  const currentUser = useSelf();
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);
  const [webSearchAccessible, setWebSearchAccessible] = useState(false);
  const [selectedResearchContext, setSelectedResearchContext] = useState<ResearchContext | null>(
    null,
  );
  const [activeThreadInfo, setActiveThreadInfo] = useState<ThreadInfo | null>(threadInfo ?? null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [selectedActivities, setSelectedActivities] = useState<UserActivity[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { isMobile } = usePlatform();

  // Update activeThreadInfo when threadInfo prop changes
  useEffect(() => {
    setActiveThreadInfo(threadInfo ?? null);
  }, [threadInfo]);

  const channel = useChannel(channelId || '');

  const channelName = (channel?.['name'] as string) || '';

  const channelDescription = (channel?.['description'] as string) || '';

  const scopeType = (channel?.['scopeType'] as string) || '';

  // Check if user has access to web search from metadata
  useEffect(() => {
    if (currentUser?.metadata) {
      const metadata = currentUser.metadata as { web_search_enabled?: boolean };
      const hasAccess = metadata.web_search_enabled === true;
      setWebSearchAccessible(hasAccess);
      // Reset web search to off if user loses access
      if (!hasAccess) {
        setWebSearchEnabled(false);
      }
    }
  }, [currentUser?.metadata]);

  // Suggestion queries - different based on context
  const suggestionQueries = channelId
    ? ['Summarize this channel', 'Notes shared last week', 'SR trend today']
    : ['How can I help you?', 'Ask me anything', 'General assistance'];

  // Use the streaming hook with selected channel IDs, research context, and active thread info
  const { submitQuery, abortCurrentRequest } = useXyneAIStream({
    channelIds: selectedChannelIds,
    conversationId,
    threadConversationId: activeThreadInfo?.conversationId,
    setMessages,
    setConversationId,
    setCurrentTraceId,
    webSearchEnabled: webSearchAccessible ? webSearchEnabled : false,
    researchContext: selectedResearchContext,
  });

  // Scroll to bottom function
  const scrollToBottom = useCallback((): void => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  // Load most recent conversation on mount (globally, not per channel)
  useEffect(() => {
    // Only load conversations if we have a channelId
    if (!channelId) return;

    const loadMostRecentConversation = async (): Promise<void> => {
      try {
        setIsLoadingConversation(true);
        // Get all conversations across all channels
        const allConversations = await xyneAIStorage.getAllConversations();
        if (allConversations.length === 0) {
          setIsLoadingConversation(false);
          return;
        }

        // Sort by lastUpdated and get the most recent one
        const mostRecent = allConversations.sort(
          (a, b) => b.lastUpdated.getTime() - a.lastUpdated.getTime(),
        )[0];

        // Load the most recent conversation
        if (mostRecent) {
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
        }
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error('[XyneAISidebar] Failed to load most recent conversation:', error);
      } finally {
        setIsLoadingConversation(false);
      }
    };

    void loadMostRecentConversation();
  }, [scrollToBottom]);

  // Load conversations list when history sidebar is opened
  useEffect(() => {
    if (!showHistorySidebar || !channelId) return;

    const loadConversations = async (): Promise<void> => {
      try {
        const allConversations = await xyneAIStorage.getConversationsForChannel(channelId);
        setConversations(allConversations);
      } catch (error) {
        console.error('[XyneAISidebar] Failed to load conversations:', error);
      }
    };

    void loadConversations();
  }, [showHistorySidebar]);

  // Save conversation history to IndexedDB whenever messages change
  useEffect(() => {
    const saveHistory = async (): Promise<void> => {
      // Don't save empty conversations, conversations without a session ID, or without a channelId
      if (messages.length === 0 || !conversationId || !channelId) {
        console.log(
          '[XyneAISidebar] Skipping save - messages:',
          messages.length,
          'conversationId:',
          conversationId,
        );
        return;
      }

      try {
        console.log(
          '[XyneAISidebar] Saving conversation with conversationId:',
          conversationId,
          'messages:',
          messages.length,
        );
        await xyneAIStorage.saveConversation(channelId, conversationId, messages);
        console.log('[XyneAISidebar] Conversation saved successfully');
      } catch (error) {
        console.error('[XyneAISidebar] Failed to save conversation history:', error);
      }
    };

    void saveHistory();
  }, [messages, channelId, conversationId]);

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
    if (!channelId) return; // Can't toggle star without channelId
    try {
      await xyneAIStorage.toggleStar(channelId, conversation.sessionId);
      // Reload conversations to update UI
      const allConversations = await xyneAIStorage.getConversationsForChannel(channelId);
      setConversations(allConversations);
    } catch (error) {
      console.error('[XyneAISidebar] Failed to toggle star:', error);
    }
  };

  const handleDeleteConversation = async (conversation: ConversationHistoryType): Promise<void> => {
    if (!channelId) return; // Can't delete conversation without channelId
    try {
      await xyneAIStorage.deleteConversation(channelId, conversation.sessionId);
      // Reload conversations
      const allConversations = await xyneAIStorage.getConversationsForChannel(channelId);
      setConversations(allConversations);
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
    if (!channelId) return; // Can't rename conversation without channelId
    try {
      await xyneAIStorage.renameConversation(
        conversation.channelId,
        conversation.sessionId,
        newName,
      );

      // Reload conversations
      const allConversations = await xyneAIStorage.getConversationsForChannel(channelId);
      setConversations(allConversations);
    } catch (error) {
      console.error('[XyneAISidebar] Failed to rename conversation:', error);
    }
  };

  const handleNewChat = (): void => {
    // Reset to fresh state
    setMessages([]);
    setConversationId('');
    setCurrentTraceId(undefined);
    setInputValue('');
    setAttachments([]);
    setSelectedActivities([]);
    setVisibleCharsMap({});
    setShowHistorySidebar(false);
    setShowUserActivityPanel(false);

    // Abort any ongoing requests
    abortCurrentRequest();
  };

  const handleAddActivities = useCallback((activities: UserActivity[]): void => {
    if (activities.length === 0) return;
    setSelectedActivities(prev => {
      const existingIds = new Set(prev.map(a => a.id));
      const newActivities = activities.filter(a => !existingIds.has(a.id));
      return [...prev, ...newActivities];
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
      .map(
        (activity, index) =>
          `${index + 1}. [${activity.eventName}] (${activity.eventCategory})\n   URL: ${activity.url}\n   Metadata: ${activity.contextMetadata ? JSON.stringify(activity.contextMetadata) : 'N/A'}\n  Timestamp: ${activity.timestamp ?? 'N/A'}\n Platform: ${activity.platform ?? 'N/A'}`,
      )
      .join('\n\n');

    return `\n\nUser journey across app:\n\n${activityLines}`;
  };

  const handleSubmit = useCallback(async (): Promise<void> => {
    if (!inputValue.trim() && selectedActivities.length === 0) return;
    let query = inputValue;
    if (selectedActivities.length > 0) {
      query = query + formatActivitiesAsText(selectedActivities);
    }

    const currentAttachments = attachments;

    // Convert attachments to MessageAttachment format for display
    const messageAttachments: MessageAttachment[] = currentAttachments.map(att => ({
      filename: att.filename,
      mimeType: att.mimeType,
      data: att.data,
    }));

    setInputValue('');
    setAttachments([]);
    setSelectedActivities([]);

    // Scroll immediately after clearing input, before query is submitted
    setTimeout(() => {
      scrollToBottom();
    }, 50);

    await submitQuery(query, messageAttachments);
  }, [inputValue, attachments, selectedActivities, submitQuery, scrollToBottom]);

  return (
    <div
      className={`w-full ${isMobile ? 'h-[95vh] pb-4' : 'h-full rounded-xl'} bg-white flex flex-col min-h-0`}
    >
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
                    <div className='w-3/4 h-12 bg-gray-200 rounded-xl animate-pulse' />
                  </div>
                  {/* Bot message shimmer */}
                  <div className='flex justify-start'>
                    <div className='w-full space-y-2'>
                      <div className='h-4 bg-gray-200 rounded animate-pulse' />
                      <div className='h-4 bg-gray-200 rounded animate-pulse w-5/6' />
                      <div className='h-4 bg-gray-200 rounded animate-pulse w-4/6' />
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
            channelId={channelId}
            channelName={channelName}
            channelDescription={channelDescription}
            scopeType={scopeType}
            showChannelTag={true}
            threadInfo={activeThreadInfo}
            inputValue={inputValue}
            onInputChange={setInputValue}
            onSubmit={() => void handleSubmit()}
            onSelectedChannelsChange={setSelectedChannelIds}
            onResearchContextChange={setSelectedResearchContext}
            onThreadInfoChange={setActiveThreadInfo}
            onAttachmentsChange={setAttachments}
            selectedActivities={selectedActivities}
            onActivitiesChange={setSelectedActivities}
            isStreaming={messages.some(m => m.isStreaming)}
            onAbort={abortCurrentRequest}
            webSearchEnabled={webSearchEnabled}
            webSearchAccessible={webSearchAccessible}
            onWebSearchToggle={() => setWebSearchEnabled(!webSearchEnabled)}
          />
        </>
      )}
    </div>
  );
};

export default XyneAISidebar;
