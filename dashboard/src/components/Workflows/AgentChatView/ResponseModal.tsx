import React from 'react';
import MarkdownPreview from '@uiw/react-markdown-preview';
import { X, FileText } from 'lucide-react';
import { AgentInfo } from './AgentChatView.utils';
import { AgentAvatar } from './AgentAvatar';
import { ReviewerFeedback, parseReviewerFeedback } from './ReviewerFeedback';

interface ResponseModalProps {
  isOpen: boolean;
  onClose: () => void;
  content: string;
  agentInfo: AgentInfo;
  stepName: string;
  timestamp: string | undefined;
}

export const ResponseModal: React.FC<ResponseModalProps> = ({
  isOpen,
  onClose,
  content,
  agentInfo,
  stepName,
  timestamp,
}) => {
  if (!isOpen) return null;

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') {
      onClose();
    }
  };

  return (
    <div
      className='fixed inset-0 z-50 flex items-end md:items-center justify-center'
      onClick={onClose}
      onKeyDown={handleKeyDown}
      role='button'
      tabIndex={0}
      data-track-category='Workflows'
      data-track-name='CloseResponseModalBackdrop'
    >
      <div className='absolute inset-0 bg-black/50 backdrop-blur-sm' />

      <div
        className='relative w-full max-w-2xl max-h-[92vh] md:max-h-[85vh] bg-white rounded-t-2xl md:rounded-2xl shadow-xl overflow-hidden flex flex-col animate-in slide-in-from-bottom md:fade-in md:zoom-in-95 duration-200'
        onClick={e => e.stopPropagation()}
        role='presentation'
        data-track-category='Workflows'
        data-track-name='ResponseModalContent'
      >
        <div className='flex items-center gap-3 px-4 py-3 border-b border-gray-100 bg-gray-50/50'>
          <AgentAvatar agentInfo={agentInfo} />
          <div className='flex-1 min-w-0'>
            <div className='flex items-center gap-2'>
              <span
                id='response-modal-title'
                className={`text-sm font-semibold ${agentInfo.labelColor}`}
              >
                {agentInfo.name}
              </span>
              <span className='text-[10px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded font-mono truncate'>
                {stepName}
              </span>
            </div>
            {timestamp && <span className='text-[10px] text-gray-400'>{timestamp}</span>}
          </div>
          <button
            onClick={onClose}
            className='p-2 rounded-lg hover:bg-gray-100 text-gray-500 transition-colors'
            data-track-category='Workflows'
            data-track-name='CloseResponseModal'
          >
            <X size={18} />
          </button>
        </div>

        <div className='flex-1 overflow-y-auto px-4 py-4'>
          {(() => {
            const parsedIssues = parseReviewerFeedback(content);
            if (parsedIssues) {
              return (
                <div className='text-foreground'>
                  <ReviewerFeedback issues={parsedIssues} disableTruncation />
                </div>
              );
            }
            return (
              <div className='[&_pre]:overflow-x-auto [&_pre]:!bg-gray-50 [&_.wmde-markdown]:bg-transparent prose prose-sm max-w-none'>
                <MarkdownPreview
                  source={content}
                  style={{
                    backgroundColor: 'transparent',
                    color: '#374151',
                    maxWidth: '100%',
                    fontSize: '14px',
                    lineHeight: '1.7',
                  }}
                  wrapperElement={{ 'data-color-mode': 'light' }}
                />
              </div>
            );
          })()}
        </div>

        <div className='flex items-center justify-center gap-2 px-4 py-3 border-t border-gray-100 bg-gray-50/50'>
          <FileText size={14} className='text-gray-400' />
          <span className='text-xs text-gray-500'>{content.split('\n').length} lines</span>
        </div>

        <div className='md:hidden w-[100px] h-1 bg-gray-300 rounded-full mx-auto mb-2' />
      </div>
    </div>
  );
};

export default ResponseModal;
