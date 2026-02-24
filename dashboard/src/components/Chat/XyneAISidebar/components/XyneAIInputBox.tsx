import type { ReactElement } from 'react';
import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { ArrowUp, X, Plus, FileText, Lock, Globe, Code2, Package, Search } from 'lucide-react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { toast } from 'sonner';
import { ChannelScopeType } from '@xyne/shared';
import { StopIcon } from './StopIcon';
import { useAllVisibleChannels, searchChannels } from '../../../../hooks/useChannels';
import type { Channel } from '../../../../machines/stateMachine';
import { ChannelMentionExtension, channelMentionPluginKey } from '../../../ui/TipTapExtensions';
import { MentionSelector } from '../../../ui/Selectors';
import type { MentionResult } from '../../../ui/Selectors/Selectors.types';
import { usePlatform } from '../../../../hooks/usePlatform';
import { useResearchOptions, type ResearchContext } from '../../../../hooks/useResearchAgent';
import type { ThreadInfo } from '../../../../machines/xyneAIMachine';
import { useNavigate } from 'react-router-dom';
import { xyneAIActor } from '../../../../machines/xyneAIMachine';

// Hash icon component
const HashIcon = ({ className = '' }: { className?: string }): ReactElement => (
  <img src='/svgs/icons/hash.svg' alt='#' className={className} width={16} height={16} />
);

import type { UserActivity } from '../../../../hooks/useUserActivity';

interface XyneAIInputBoxProps {
  channelId?: string | null;
  channelName?: string;
  channelDescription?: string;
  scopeType?: string;
  showChannelTag?: boolean;
  threadInfo?: ThreadInfo | null | undefined;
  inputValue: string;
  onInputChange: (value: string) => void;
  onSubmit: () => void;
  onSelectedChannelsChange?: (channelIds: string[]) => void;
  onResearchContextChange?: (context: ResearchContext | null) => void;
  onThreadInfoChange?: (threadInfo: ThreadInfo | null) => void;
  onAttachmentsChange?: (attachments: Attachment[]) => void;
  selectedActivities?: UserActivity[];
  onActivitiesChange?: (activities: UserActivity[]) => void;
  isStreaming?: boolean;
  onAbort?: () => void;
  webSearchEnabled?: boolean;
  webSearchAccessible?: boolean;
  onWebSearchToggle?: () => void;
}

interface SelectedChannel {
  id: string;
  name: string;
  isPrivate: boolean;
}

export interface Attachment {
  id: string;
  name: string;
  size: number;
  type: string;
  file: File;
  data: string; // base64 encoded data
  mimeType: string;
  filename: string;
}

export const XyneAIInputBox = ({
  channelId,
  channelName,
  scopeType,
  threadInfo,
  inputValue,
  onInputChange,
  onSubmit,
  onSelectedChannelsChange,
  onResearchContextChange,
  onThreadInfoChange,
  onAttachmentsChange,
  selectedActivities = [],
  onActivitiesChange,
  isStreaming = false,
  onAbort,
  webSearchEnabled = false,
  webSearchAccessible = false,
  onWebSearchToggle,
}: XyneAIInputBoxProps): ReactElement => {
  const dropdownRef = useRef<HTMLDivElement>(null);
  const researchDropdownRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const researchSearchInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const hasInitializedDefaultChannel = useRef(false);
  const { isMobile } = usePlatform();
  const navigate = useNavigate();

  // Get all visible channels and filter out DMs
  const allChannels = useAllVisibleChannels();
  const nonDMChannels = useMemo(() => {
    return allChannels.filter(
      channel =>
        channel.scopeType !== ChannelScopeType.DM &&
        channel.scopeType !== ChannelScopeType.GROUP_DM,
    );
  }, [allChannels]);

  // Get research agent products and repositories (lazy-loaded)
  const {
    products,
    repositories,
    isLoading: isResearchLoading,
    triggerFetch: triggerResearchFetch,
    hasFetched: hasResearchFetched,
  } = useResearchOptions();

  // Initialize with current channel as default pill (if exists and not DM)
  const [selectedChannels, setSelectedChannels] = useState<SelectedChannel[]>(() => {
    // Don't add default pill for DMs or if no channelId
    if (!channelId || !channelName || scopeType === 'DM' || scopeType === 'GROUP_DM') {
      return [];
    }

    // Try to find the channel to get correct isPrivate value
    const currentChannel = allChannels.find(ch => ch.id === channelId);

    return [
      {
        id: channelId,
        name: channelName,
        isPrivate: currentChannel ? String(currentChannel.visibility) === 'PRIVATE' : false,
      },
    ];
  });

  const [selectedAttachments, setSelectedAttachments] = useState<Attachment[]>([]);
  const [showChannelDropdown, setShowChannelDropdown] = useState(false);
  const [channelSearchQuery, setChannelSearchQuery] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [dropdownTriggeredBy, setDropdownTriggeredBy] = useState<'button' | 'text'>('button');

  // Research Agent state
  const [selectedResearch, setSelectedResearch] = useState<ResearchContext | null>(null);
  const [showResearchDropdown, setShowResearchDropdown] = useState(false);
  const [researchSearchQuery, setResearchSearchQuery] = useState('');
  const [researchHighlightedIndex, setResearchHighlightedIndex] = useState(0);
  const [researchTab, setResearchTab] = useState<'products' | 'repositories'>('products');

  // Thread info state - track if user has removed it
  const [activeThreadInfo, setActiveThreadInfo] = useState<ThreadInfo | null>(threadInfo ?? null);

  // Update activeThreadInfo when threadInfo prop changes
  useEffect(() => {
    setActiveThreadInfo(threadInfo ?? null);
  }, [threadInfo]);

  // Handle removing thread info
  const handleRemoveThreadInfo = (e: React.MouseEvent): void => {
    e.stopPropagation(); // Prevent triggering the pill click
    setActiveThreadInfo(null);
    onThreadInfoChange?.(null);
  };

  // Handle clicking thread pill to navigate
  const handleThreadPillClick = (): void => {
    if (!activeThreadInfo || !channelId) return;

    // Navigate to the thread
    void navigate(`/chat/dir/${channelId}/${activeThreadInfo.conversationId}`);

    // Close XyneAI modal on mobile after navigation
    if (isMobile) {
      xyneAIActor.send({ type: 'CLOSE' });
    }
  };

  // Filter channels based on search query (exclude DMs)
  const filteredChannels = useMemo(() => {
    if (!channelSearchQuery.trim()) {
      return nonDMChannels.slice(0, 10);
    }
    return searchChannels(nonDMChannels, channelSearchQuery, 10);
  }, [nonDMChannels, channelSearchQuery]);

  // TipTap editor setup
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        paragraph: {
          HTMLAttributes: {
            class: 'm-0 leading-6',
          },
        },
      }),
      Placeholder.configure({
        placeholder: 'Ask Xyne AI',
      }),
      ChannelMentionExtension,
    ],
    content: '',
    onUpdate: ({ editor }) => {
      const text = editor.getText();
      onInputChange(text);
    },
    editorProps: {
      attributes: {
        class: 'tiptap chat-input-editor prose prose-sm focus:outline-none',
        style: 'min-height: 20px; max-height: 140px; overflow-y: auto;',
      },
      handleKeyDown: (view, event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
          const channelMentionState = channelMentionPluginKey.getState(view.state);

          // If channel mention menu is open, let it handle the Enter key
          if (channelMentionState?.isOpen && channelMentionState.items.length > 0) {
            return false;
          }

          // Prevent submission if already streaming or input is empty
          const text = view.state.doc.textContent.trim();
          if (isStreaming || !text) {
            event.preventDefault();
            return true;
          }

          // Otherwise, submit the message
          event.preventDefault();
          onSubmit();
          return true;
        }

        return false;
      },
    },
  });

  // Update the default channel's isPrivate status when channel data loads (only once)
  useEffect(() => {
    if (
      !hasInitializedDefaultChannel.current &&
      channelId &&
      channelName &&
      allChannels.length > 0
    ) {
      const currentChannel = allChannels.find(ch => ch.id === channelId);
      if (currentChannel && selectedChannels.length > 0 && selectedChannels[0]?.id === channelId) {
        setSelectedChannels(prev => {
          if (prev.length === 0 || prev[0]?.id !== channelId) return prev;
          return [
            {
              ...prev[0],
              isPrivate: String(currentChannel.visibility) === 'PRIVATE',
            },
            ...prev.slice(1),
          ];
        });
        hasInitializedDefaultChannel.current = true;
      }
    }
  }, [channelId, channelName, allChannels, selectedChannels]);

  // Notify parent component when selected channels change
  useEffect(() => {
    const channelIds = selectedChannels.map(ch => ch.id);
    onSelectedChannelsChange?.(channelIds);
  }, [selectedChannels, onSelectedChannelsChange]);

  // Notify parent component when attachments change
  useEffect(() => {
    onAttachmentsChange?.(selectedAttachments);
  }, [selectedAttachments, onAttachmentsChange]);

  // Sync inputValue changes from parent to editor
  useEffect(() => {
    if (editor && !editor.isFocused) {
      const currentText = editor.getText();
      if (currentText !== inputValue) {
        editor.commands.setContent(inputValue);
      }
    }
  }, [inputValue, editor]);

  // Clear editor content and attachments when inputValue is empty (after submit)
  useEffect(() => {
    if (inputValue === '' && editor) {
      editor.commands.setContent('');
      // Also clear attachments when input is cleared
      setSelectedAttachments([]);
    }
  }, [inputValue, editor]);

  // Convert channels to MentionResult format for MentionSelector (exclude DMs)
  const channelMentionItems: MentionResult[] = useMemo(() => {
    return nonDMChannels.map(channel => ({
      id: channel.id,
      name: channel.name,
      type: 'channel' as const,
      isPrivate: String(channel.visibility) === 'PRIVATE',
      ...(channel.description && { description: channel.description }),
    }));
  }, [nonDMChannels]);

  // Handle channel mention search
  const handleChannelMentionSearch = useCallback((query: string) => {
    setChannelSearchQuery(query);
  }, []);

  // Handle channel mention selection from TipTap selector
  const handleChannelMentionSelect = useCallback(
    (mention: MentionResult) => {
      if (mention.type !== 'channel') return;

      // Check if channel is already selected
      if (selectedChannels.some(ch => ch.id === mention.id)) {
        toast.info('This channel is already added to context', { duration: 2000 });
        return;
      }

      // Check if maximum limit of 5 channels is reached
      if (selectedChannels.length >= 5) {
        toast.error('Maximum 5 channels can be selected', { duration: 2000 });
        return;
      }

      // Add channel to selected channels pills
      const newChannel: SelectedChannel = {
        id: mention.id,
        name: mention.name,
        isPrivate: mention.isPrivate ?? false,
      };
      setSelectedChannels([...selectedChannels, newChannel]);
    },
    [selectedChannels],
  );

  // Handle removing a selected channel pill
  const handleRemoveChannel = (channelIdToRemove: string): void => {
    setSelectedChannels(selectedChannels.filter(ch => ch.id !== channelIdToRemove));
  };

  // Handle attachment button click
  const handleAttachmentClick = (): void => {
    fileInputRef.current?.click();
  };

  // File size limits
  const MAX_INDIVIDUAL_FILE_SIZE = 100 * 1024 * 1024; // 100MB in bytes
  const MAX_TOTAL_SIZE = 200 * 1024 * 1024; // 200MB in bytes

  // Allowed file types
  const allowedFileTypes = [
    // Images
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp',
    // Documents
    'application/pdf',
    'text/plain',
    'text/csv',
    'text/markdown',
    // Office
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
    'application/msword', // .doc
    'application/vnd.ms-excel', // .xls
    // Data
    'application/json',
    'application/xml',
  ];

  // Validate base64 string
  const isValidBase64 = (str: string): boolean => {
    if (!str || str.length === 0) return false;
    // Base64 regex: only allows valid base64 characters (A-Z, a-z, 0-9, +, /, =)
    const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;
    if (!base64Regex.test(str)) return false;
    // Check if length is valid (must be multiple of 4)
    if (str.length % 4 !== 0) return false;
    return true;
  };

  // Handle file selection
  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    // Filter files to only include allowed types
    const validFiles = Array.from(files).filter(file => {
      return allowedFileTypes.includes(file.type);
    });

    if (validFiles.length === 0) {
      toast.error(
        'Please select valid file types (images, PDF, text, office documents, or data files).',
        { duration: 3000 },
      );
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      return;
    }

    // Check individual file size
    const oversizedFiles = validFiles.filter(file => file.size > MAX_INDIVIDUAL_FILE_SIZE);
    if (oversizedFiles.length > 0) {
      const fileNames = oversizedFiles.map(f => f.name).join(', ');
      toast.error(`File(s) too large: ${fileNames}. Maximum file size is 100MB.`, {
        duration: 4000,
      });
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      return;
    }

    // Calculate total size of existing attachments
    const existingTotalSize = selectedAttachments.reduce((sum, att) => sum + att.size, 0);

    // Calculate total size of new files
    const newFilesSize = validFiles.reduce((sum, file) => sum + file.size, 0);

    // Check if total size would exceed limit
    if (existingTotalSize + newFilesSize > MAX_TOTAL_SIZE) {
      const totalMB = Math.round((existingTotalSize + newFilesSize) / (1024 * 1024));
      toast.error(
        `Total attachment size (${totalMB}MB) exceeds the 200MB limit. Please remove some attachments.`,
        { duration: 4000 },
      );
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      return;
    }

    // Convert files to base64
    const filePromises = validFiles.map(
      file =>
        new Promise<Attachment>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = (): void => {
            const result = reader.result as string;

            // Extract and validate base64 data using regex
            const base64Match = result.match(/^data:([^;]+);base64,(.+)$/);
            if (!base64Match) {
              reject(
                new Error(`Invalid file format - not a valid data URL for file: ${file.name}`),
              );
              return;
            }

            const [, detectedMimeType, base64Data] = base64Match;

            // Ensure base64 data is not empty
            if (!base64Data) {
              reject(new Error(`Empty file data for file: ${file.name}`));
              return;
            }

            // Validate that detected MIME type matches file.type
            if (detectedMimeType !== file.type) {
              console.warn(
                `[XyneAI] MIME type mismatch for ${file.name}: file.type=${file.type}, detected=${detectedMimeType}`,
              );
            }

            // Validate base64 format
            if (!isValidBase64(base64Data)) {
              reject(new Error(`Invalid base64 data for file: ${file.name}`));
              return;
            }

            resolve({
              id: `${file.name}-${Date.now()}-${Math.random()}`,
              name: file.name,
              size: file.size,
              type: file.type,
              file,
              data: base64Data,
              mimeType: file.type,
              filename: file.name,
            });
          };
          reader.onerror = reject;
          reader.readAsDataURL(file);
        }),
    );

    try {
      const newAttachments = await Promise.all(filePromises);
      setSelectedAttachments([...selectedAttachments, ...newAttachments]);

      // Show success message if multiple files were added
      if (newAttachments.length > 1) {
        toast.success(`${newAttachments.length} files attached successfully`, { duration: 2000 });
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Error reading files. Please try again.';
      toast.error(errorMessage, { duration: 3000 });
    }

    // Reset the file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Handle removing an attachment
  const handleRemoveAttachment = (attachmentId: string): void => {
    setSelectedAttachments(selectedAttachments.filter(att => att.id !== attachmentId));
  };

  // Handle "/" button click
  const handleSlashButtonClick = (): void => {
    setShowChannelDropdown(true);
    setChannelSearchQuery('');
    setHighlightedIndex(0);
    setDropdownTriggeredBy('button');
    // Focus on the search input when dropdown opens
    setTimeout(() => {
      searchInputRef.current?.focus();
    }, 0);
  };

  // Handle search input in dropdown
  const handleDropdownSearchChange = (value: string): void => {
    setChannelSearchQuery(value);
    setHighlightedIndex(0);
  };

  // Handle selecting channel from dropdown (via button or search)
  const handleDropdownChannelSelect = (channel: Channel): void => {
    // Check if channel is already selected
    if (selectedChannels.some(ch => ch.id === channel.id)) {
      toast.info('This channel is already added to context', { duration: 2000 });
      setShowChannelDropdown(false);
      setChannelSearchQuery('');
      return;
    }

    // Check if maximum limit of 5 channels is reached
    if (selectedChannels.length >= 5) {
      toast.error('Maximum 5 channels can be selected', { duration: 2000 });
      setShowChannelDropdown(false);
      setChannelSearchQuery('');
      return;
    }

    // Add channel to selected channels pills
    const newChannel: SelectedChannel = {
      id: channel.id,
      name: channel.name,
      isPrivate: String(channel.visibility) === 'PRIVATE',
    };
    setSelectedChannels([...selectedChannels, newChannel]);

    setShowChannelDropdown(false);
    setChannelSearchQuery('');
  };

  // Handle keyboard navigation in dropdown search
  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlightedIndex(prev => (prev < filteredChannels.length - 1 ? prev + 1 : prev));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlightedIndex(prev => (prev > 0 ? prev - 1 : 0));
        break;
      case 'Enter':
        e.preventDefault();
        if (filteredChannels[highlightedIndex]) {
          handleDropdownChannelSelect(filteredChannels[highlightedIndex]);
        }
        break;
      case 'Escape':
        e.preventDefault();
        setShowChannelDropdown(false);
        setChannelSearchQuery('');
        break;
      default:
        break;
    }
  };

  // Scroll highlighted item into view
  useEffect(() => {
    if (showChannelDropdown && dropdownRef.current) {
      const highlightedElement = dropdownRef.current.querySelector(
        `[data-index="${highlightedIndex}"]`,
      );
      if (highlightedElement) {
        highlightedElement.scrollIntoView({
          block: 'nearest',
        });
      }
    }
  }, [highlightedIndex, showChannelDropdown]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent): void => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowChannelDropdown(false);
        setChannelSearchQuery('');
      }
      if (
        researchDropdownRef.current &&
        !researchDropdownRef.current.contains(event.target as Node)
      ) {
        setShowResearchDropdown(false);
        setResearchSearchQuery('');
      }
    };

    if (showChannelDropdown || showResearchDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
      return (): void => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
    return undefined;
  }, [showChannelDropdown, showResearchDropdown]);

  // Notify parent when research context changes
  useEffect(() => {
    onResearchContextChange?.(selectedResearch);
  }, [selectedResearch, onResearchContextChange]);

  // Filter research items based on search query
  const filteredResearchItems = useMemo(() => {
    const items = researchTab === 'products' ? products : repositories;
    if (!researchSearchQuery.trim()) {
      return items.slice(0, 10);
    }
    const query = researchSearchQuery.toLowerCase();
    return items.filter(item => item.name.toLowerCase().includes(query)).slice(0, 10);
  }, [products, repositories, researchTab, researchSearchQuery]);

  // Handle research button click
  const handleResearchButtonClick = (): void => {
    if (!hasResearchFetched) {
      triggerResearchFetch();
    }
    setShowResearchDropdown(true);
    setResearchSearchQuery('');
    setResearchHighlightedIndex(0);
    setTimeout(() => {
      researchSearchInputRef.current?.focus();
    }, 0);
  };

  // Handle research item selection
  const handleResearchSelect = (
    item: { id: string; name: string },
    type: 'product' | 'repository',
  ): void => {
    setSelectedResearch({
      type,
      name: item.name,
    });
    setShowResearchDropdown(false);
    setResearchSearchQuery('');
  };

  // Handle removing research pill
  const handleRemoveResearch = (): void => {
    setSelectedResearch(null);
  };

  // Handle research search keyboard navigation
  const handleResearchSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setResearchHighlightedIndex(prev =>
          prev < filteredResearchItems.length - 1 ? prev + 1 : prev,
        );
        break;
      case 'ArrowUp':
        e.preventDefault();
        setResearchHighlightedIndex(prev => (prev > 0 ? prev - 1 : 0));
        break;
      case 'Enter':
        e.preventDefault();
        if (filteredResearchItems[researchHighlightedIndex]) {
          handleResearchSelect(
            filteredResearchItems[researchHighlightedIndex],
            researchTab === 'products' ? 'product' : 'repository',
          );
        }
        break;
      case 'Escape':
        e.preventDefault();
        setShowResearchDropdown(false);
        setResearchSearchQuery('');
        break;
      default:
        break;
    }
  };

  return (
    <div className={`px-4 ${isMobile ? '' : 'mb-4'} relative`}>
      {/* MentionSelector for "#" trigger in editor */}
      <MentionSelector
        editor={editor}
        mentionItems={channelMentionItems}
        triggerChar='#'
        {...(handleChannelMentionSearch && { onMentionSearch: handleChannelMentionSearch })}
        {...(handleChannelMentionSelect && { onMentionSelect: handleChannelMentionSelect })}
      />

      <div
        className={`bg-card border border-input focus-within:border-ring ${isMobile ? 'rounded-[26px]' : 'rounded-2xl'} py-2 px-2 flex flex-col gap-3 transition-colors relative`}
      >
        {/* Selector Buttons and Pills Row */}
        <div
          className='flex items-center gap-2 overflow-x-auto flex-nowrap min-w-0 pb-2'
          style={{
            scrollbarWidth: 'thin',
            scrollbarColor: '#D1D5DB transparent',
          }}
        >
          {/* "/" Button to open channel selector */}
          <button
            type='button'
            onClick={handleSlashButtonClick}
            className={`flex h-7 py-1 px-2 justify-center items-center gap-2 ${isMobile ? 'rounded-full' : 'rounded-lg'} border border-[#E4E6E7] hover:bg-[#E8EAED] transition-all duration-200 ease-in-out flex-shrink-0`}
            aria-label='Select channels'
            title='Select channels'
            data-track-category='XyneAI'
            data-track-name='OPEN_CHANNEL_SELECTOR'
          >
            <span className='text-gray-600 font-semibold text-sm'>#</span>
          </button>

          {/* Research Agent Button - only show if no research is selected */}
          {!selectedResearch && (
            <button
              type='button'
              onClick={handleResearchButtonClick}
              disabled={isResearchLoading}
              className={`flex h-7 py-1 px-2 justify-center items-center ${isMobile ? 'rounded-full' : 'rounded-lg'} border border-[#E4E6E7] hover:bg-[#E8EAED] transition-all duration-200 ease-in-out flex-shrink-0 ${isResearchLoading ? 'opacity-50 cursor-not-allowed' : ''}`}
              aria-label='Select product or repository for research'
              title='Deep Research'
              data-track-category='XyneAI'
              data-track-name='OPEN_RESEARCH_SELECTOR'
            >
              <Search className='w-4 h-4 text-gray-600' />
            </button>
          )}

          {/* Thread Context Pill */}
          {activeThreadInfo && (
            <div
              className={`flex h-7 py-1 ${isMobile ? 'px-1' : 'px-2'} justify-center items-center ${isMobile ? 'gap-[4px]' : 'gap-2'} rounded-lg border border-[#E4E6E7] flex-shrink-0`}
            >
              <button
                type='button'
                onClick={handleThreadPillClick}
                className='flex items-center gap-1 cursor-pointer hover:bg-gray-50 transition-colors bg-transparent border-0 p-0'
                aria-label={`Navigate to thread from ${activeThreadInfo.senderName}`}
              >
                <span className="text-[#181B1D] font-['Inter'] text-sm font-[450] whitespace-nowrap max-w-[200px] truncate">
                  {activeThreadInfo.senderName} • {activeThreadInfo.previewText}
                </span>
              </button>
              <button
                type='button'
                onClick={handleRemoveThreadInfo}
                className='hover:bg-gray-200 rounded p-0.5 transition-colors flex-shrink-0'
                aria-label='Remove thread context'
              >
                <X className='w-3 h-3' />
              </button>
            </div>
          )}

          {/* Channel Pills */}
          {selectedChannels.map(channel => (
            <div
              key={channel.id}
              className={`flex h-7 py-1 ${isMobile ? 'px-1' : 'px-2'} justify-center items-center ${isMobile ? 'gap-[4px]' : 'gap-2'} rounded-lg border border-[#E4E6E7] flex-shrink-0`}
            >
              <div className='flex items-center gap-1'>
                <div className='flex-shrink-0'>
                  {channel.isPrivate ? (
                    <Lock className='h-3.5 w-3.5 text-gray-600' />
                  ) : (
                    <HashIcon />
                  )}
                </div>
                <span className="text-[#181B1D] font-['Inter'] text-sm font-[450] whitespace-nowrap">
                  {channel.name}
                </span>
              </div>
              {/* Show X button for all channels */}
              <button
                onClick={() => handleRemoveChannel(channel.id)}
                className='hover:bg-blue-200 rounded p-0.5 transition-colors flex-shrink-0'
                aria-label={`Remove ${channel.name}`}
                data-track-category='XyneAI'
                data-track-name='REMOVE_CHANNEL'
                data-track-metadata={JSON.stringify({ channelId: channel.id })}
              >
                <X className='w-3 h-3' />
              </button>
            </div>
          ))}

          {/* Research Context Pill */}
          {selectedResearch && (
            <div
              className={`flex h-7 py-1 ${isMobile ? 'px-1' : 'px-2'} justify-center items-center ${isMobile ? 'gap-[4px]' : 'gap-2'} rounded-lg border border-[#E4E6E7] flex-shrink-0`}
            >
              <div className='flex items-center gap-1'>
                <div className='flex-shrink-0'>
                  {selectedResearch.type === 'product' ? (
                    <Package className='w-3.5 h-3.5 text-gray-600' />
                  ) : (
                    <Code2 className='w-3.5 h-3.5 text-gray-600' />
                  )}
                </div>
                <span className="text-[#181B1D] font-['Inter'] text-sm font-[450] whitespace-nowrap">
                  {selectedResearch.name}
                </span>
              </div>
              <button
                onClick={handleRemoveResearch}
                className='hover:bg-gray-200 rounded p-0.5 transition-colors flex-shrink-0'
                aria-label={`Remove ${selectedResearch.name}`}
                data-track-category='XyneAI'
                data-track-name='REMOVE_RESEARCH'
              >
                <X className='w-3 h-3' />
              </button>
            </div>
          )}

          {/* Attachment Pills */}
          {selectedAttachments.map(attachment => (
            <div
              key={attachment.id}
              className='flex h-7 py-1 px-2 justify-center items-center gap-2 rounded-lg border border-[#E4E6E7] bg-[#F2F2F3] flex-shrink-0'
            >
              <div className='flex items-center gap-1'>
                <div className='flex-shrink-0'>
                  <FileText className='w-3.5 h-3.5 text-gray-600' />
                </div>
                <span className="text-[#181B1D] font-['Inter'] text-sm font-[450] whitespace-nowrap max-w-[120px] truncate">
                  {attachment.name}
                </span>
              </div>
              <button
                onClick={() => handleRemoveAttachment(attachment.id)}
                className='hover:bg-blue-200 rounded p-0.5 transition-colors flex-shrink-0'
                aria-label={`Remove ${attachment.name}`}
                data-track-category='XyneAI'
                data-track-name='REMOVE_ATTACHMENT'
                data-track-metadata={JSON.stringify({ attachmentId: attachment.id })}
              >
                <X className='w-3 h-3' />
              </button>
            </div>
          ))}

          {/* Activity Pills */}
          {selectedActivities.length > 0 && (
            <div className='flex h-7 py-1 px-2 justify-center items-center gap-2 rounded-lg border border-[#E4E6E7] bg-blue-50 flex-shrink-0'>
              <div className='flex items-center gap-1'>
                <span className="text-[#181B1D] font-['Inter'] text-sm font-[450] whitespace-nowrap">
                  {selectedActivities.length}{' '}
                  {selectedActivities.length === 1 ? 'activity' : 'activities'}
                </span>
              </div>
              <button
                onClick={() => onActivitiesChange?.([])}
                className='hover:bg-blue-200 rounded p-0.5 transition-colors flex-shrink-0'
                aria-label='Remove all activities'
              >
                <X className='w-3 h-3' />
              </button>
            </div>
          )}
        </div>

        {/* Input Area - Text only */}
        <div className='relative'>
          <EditorContent
            editor={editor}
            className="bg-transparent outline-none text-foreground p-2 placeholder:text-muted-foreground text-sm font-['Inter']"
          />
        </div>

        {/* Bottom buttons - Attachment, Web Search Toggle and Submit */}
        <div className='flex items-center justify-between gap-2 px-2'>
          <div className='flex items-center gap-2'>
            {/* Hidden file input */}
            <input
              ref={fileInputRef}
              type='file'
              multiple
              accept='image/png,image/jpeg,image/gif,image/webp,application/pdf,text/plain,text/csv,text/markdown,.docx,.xlsx,.doc,.xls,application/json,application/xml'
              onChange={e => void handleFileChange(e)}
              className='hidden'
              aria-label='Upload files'
            />
            {/* Attachment button */}
            <button
              type='button'
              onClick={handleAttachmentClick}
              className='p-1.5 -ml-1.5 rounded-lg hover:bg-gray-100 transition-colors'
              aria-label='Attach files'
              title='Attach files'
              data-track-category='XyneAI'
              data-track-name='ATTACH_FILES'
            >
              <Plus className='w-4 h-4 text-gray-600' />
            </button>

            {/* Divider line */}
            {onWebSearchToggle && <div className='h-4 w-px bg-gray-300' />}

            {/* Web Search Toggle Button */}
            {onWebSearchToggle && (
              <button
                type='button'
                onClick={() => {
                  if (webSearchAccessible) {
                    onWebSearchToggle();
                  }
                }}
                disabled={!webSearchAccessible}
                className={`p-1.5 rounded-lg transition-colors ${
                  webSearchEnabled
                    ? 'bg-[#E6F4EA] text-[#1E8E3E] hover:bg-[#D8EBE2]'
                    : 'hover:bg-gray-100 text-gray-600'
                } ${!webSearchAccessible ? 'opacity-50 cursor-not-allowed' : ''}`}
                aria-label={
                  webSearchAccessible
                    ? webSearchEnabled
                      ? 'Disable web search'
                      : 'Enable web search'
                    : 'Web search not available'
                }
                title={
                  webSearchAccessible
                    ? webSearchEnabled
                      ? 'Web search enabled'
                      : 'Enable web search'
                    : "You don't have access to web search."
                }
                data-track-category='XyneAI'
                data-track-name='TOGGLE_WEB_SEARCH'
                data-track-metadata={JSON.stringify({ enabled: webSearchEnabled })}
              >
                <Globe className='w-4 h-4' />
              </button>
            )}
          </div>

          {/* Submit/Stop button */}
          <button
            onClick={isStreaming ? onAbort : onSubmit}
            disabled={!isStreaming && !inputValue.trim()}
            className={`absolute ${isMobile ? 'bottom-[5px] mr-1 mb-1' : 'bottom-2'} right-2 p-2 rounded-full transition-colors ${
              isStreaming
                ? 'bg-[#FF4F4F] text-white hover:bg-[#E64545]'
                : inputValue.trim()
                  ? 'bg-[#FF4F4F] text-white hover:bg-[#E64545]'
                  : 'bg-gray-200 text-gray-400 cursor-not-allowed'
            }`}
            data-track-category='XyneAI'
            data-track-name={isStreaming ? 'ABORT_MESSAGE' : 'SUBMIT_MESSAGE'}
          >
            {isStreaming ? <StopIcon className='w-2.5 h-2.5' /> : <ArrowUp className='w-4 h-4' />}
          </button>
        </div>
      </div>

      {/* Channel Dropdown when triggered by button click */}
      {showChannelDropdown && dropdownTriggeredBy === 'button' && (
        <div
          ref={dropdownRef}
          className='absolute bottom-full left-4 right-4 mb-2 bg-white border border-gray-200 rounded-lg shadow-lg z-50 overflow-hidden'
        >
          {/* Search Input */}
          <div className='p-2 border-b border-gray-200 bg-gray-50'>
            <input
              ref={searchInputRef}
              type='text'
              value={channelSearchQuery}
              onChange={e => handleDropdownSearchChange(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder='Search...'
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent font-['Inter']"
              data-track-category='XyneAI'
              data-track-name='CHANNEL_SEARCH_INPUT'
            />
          </div>

          {/* Channel List */}
          <div className='max-h-64 overflow-y-auto'>
            {filteredChannels.length > 0 ? (
              <div className='py-1'>
                {filteredChannels.map((channel, index) => (
                  <button
                    key={channel.id}
                    data-index={index}
                    onClick={() => handleDropdownChannelSelect(channel)}
                    className={`w-full text-left px-3 py-2 hover:bg-gray-100 transition-colors flex items-center gap-2 ${
                      index === highlightedIndex ? 'bg-gray-100' : ''
                    }`}
                    data-track-category='XyneAI'
                    data-track-name='SELECT_CHANNEL'
                    data-track-metadata={JSON.stringify({ channelId: channel.id })}
                  >
                    <div className='flex-shrink-0'>
                      {String(channel.visibility) === 'PRIVATE' ? (
                        <Lock className='h-3.5 w-3.5 text-gray-600' />
                      ) : (
                        <HashIcon />
                      )}
                    </div>
                    <div className='flex-1 min-w-0'>
                      <div className="text-sm font-medium text-gray-900 font-['Inter'] truncate">
                        {channel.name}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className='px-3 py-6 text-center text-sm text-gray-500'>No channels found</div>
            )}
          </div>
        </div>
      )}

      {/* Research Agent Dropdown */}
      {showResearchDropdown && (
        <div
          ref={researchDropdownRef}
          className='absolute bottom-full left-4 right-4 mb-2 bg-white border border-gray-200 rounded-lg shadow-lg z-50 overflow-hidden'
        >
          {/* Tabs */}
          <div className='flex border-b border-gray-200'>
            <button
              type='button'
              onClick={() => {
                setResearchTab('products');
                setResearchHighlightedIndex(0);
              }}
              className={`flex-1 px-4 py-2 text-sm font-medium transition-colors flex items-center justify-center gap-2 ${
                researchTab === 'products'
                  ? 'text-gray-900 border-b-2 border-gray-900 bg-gray-50'
                  : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
              }`}
              data-track-category='XyneAI'
              data-track-name='SELECT_PRODUCTS_TAB'
            >
              <Package className='w-4 h-4' />
              Products
            </button>
            <button
              type='button'
              onClick={() => {
                setResearchTab('repositories');
                setResearchHighlightedIndex(0);
              }}
              className={`flex-1 px-4 py-2 text-sm font-medium transition-colors flex items-center justify-center gap-2 ${
                researchTab === 'repositories'
                  ? 'text-gray-900 border-b-2 border-gray-900 bg-gray-50'
                  : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
              }`}
              data-track-category='XyneAI'
              data-track-name='SELECT_REPOSITORIES_TAB'
            >
              <Code2 className='w-4 h-4' />
              Repositories
            </button>
          </div>

          {/* Search Input */}
          <div className='p-2 border-b border-gray-200 bg-gray-50'>
            <input
              ref={researchSearchInputRef}
              type='text'
              value={researchSearchQuery}
              onChange={e => {
                setResearchSearchQuery(e.target.value);
                setResearchHighlightedIndex(0);
              }}
              onKeyDown={handleResearchSearchKeyDown}
              placeholder={`Search ${researchTab}...`}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-gray-400 focus:border-transparent font-['Inter']"
              data-track-category='XyneAI'
              data-track-name='RESEARCH_SEARCH_INPUT'
            />
          </div>

          {/* Items List */}
          <div className='max-h-64 overflow-y-auto'>
            {isResearchLoading ? (
              <div className='px-3 py-6 text-center text-sm text-gray-500'>Loading...</div>
            ) : filteredResearchItems.length > 0 ? (
              <div className='py-1'>
                {filteredResearchItems.map((item, index) => (
                  <button
                    key={item.id}
                    data-index={index}
                    tabIndex={index === researchHighlightedIndex ? 0 : -1}
                    onFocus={() => setResearchHighlightedIndex(index)}
                    onClick={() =>
                      handleResearchSelect(
                        item,
                        researchTab === 'products' ? 'product' : 'repository',
                      )
                    }
                    className={`w-full text-left px-3 py-2 hover:bg-gray-100 transition-colors flex items-center gap-2 ${
                      index === researchHighlightedIndex ? 'bg-gray-100' : ''
                    }`}
                    data-track-category='XyneAI'
                    data-track-name='SELECT_RESEARCH_ITEM'
                    data-track-metadata={JSON.stringify({ itemId: item.id, type: researchTab })}
                  >
                    <div className='flex-shrink-0'>
                      {researchTab === 'products' ? (
                        <Package className='w-4 h-4 text-gray-600' />
                      ) : (
                        <Code2 className='w-4 h-4 text-gray-600' />
                      )}
                    </div>
                    <div className='flex-1 min-w-0'>
                      <div className="text-sm font-medium text-gray-900 font-['Inter'] truncate">
                        {item.name}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className='px-3 py-6 text-center text-sm text-gray-500'>
                No {researchTab} found
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
