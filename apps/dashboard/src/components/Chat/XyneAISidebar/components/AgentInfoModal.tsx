import { ReactElement, useEffect } from 'react';
import { X, Wrench, Sparkles, Bot } from 'lucide-react';
import type { AccessibleClawAgent } from '../../../../services/clawAgentListService';

interface AgentInfoModalProps {
  isOpen: boolean;
  onClose: () => void;
  agent: AccessibleClawAgent | null;
}

/**
 * Safely extract display name from a tool/skill item.
 * Handles both string values and nested object structures.
 */
function getDisplayName(item: unknown): string {
  if (typeof item === 'string') return item;
  if (item && typeof item === 'object') {
    const obj = item as Record<string, unknown>;
    // Try common name fields
    if (typeof obj['name'] === 'string') return obj['name'];
    if (typeof obj['label'] === 'string') return obj['label'];
    if (typeof obj['slug'] === 'string') return obj['slug'];
    // Nested tool/skill object (e.g., AgentTool.tool.name)
    if (obj['tool'] && typeof obj['tool'] === 'object') {
      const toolObj = obj['tool'] as Record<string, unknown>;
      if (typeof toolObj['name'] === 'string') return toolObj['name'];
    }
    if (obj['skill'] && typeof obj['skill'] === 'object') {
      const skillObj = obj['skill'] as Record<string, unknown>;
      if (typeof skillObj['name'] === 'string') return skillObj['name'];
      if (typeof skillObj['label'] === 'string') return skillObj['label'];
    }
    // Fallback to id fields
    if (typeof obj['toolId'] === 'string') return obj['toolId'];
    if (typeof obj['skillId'] === 'string') return obj['skillId'];
    if (typeof obj['id'] === 'string') return obj['id'];
  }
  return String(item);
}

export const AgentInfoModal = ({
  isOpen,
  onClose,
  agent,
}: AgentInfoModalProps): ReactElement | null => {
  // Handle ESC key to close modal
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen || !agent) return null;

  // Extract tool names, handling both string[] and object[] formats
  const toolNames =
    agent.tools?.map(getDisplayName).filter(name => name && name.trim().length > 0) ?? [];

  // Extract skill names, handling both string[] and object[] formats
  const skillNames =
    agent.skills?.map(getDisplayName).filter(name => name && name.trim().length > 0) ?? [];

  return (
    <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/50'>
      <div className='bg-popover rounded-lg shadow-xl w-full max-w-md mx-4 max-h-[80vh] flex flex-col'>
        {/* Header */}
        <div className='flex items-center justify-between p-4 border-b border-border'>
          <div className='flex items-center gap-3'>
            {/* Agent color indicator */}
            <div
              className='w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-semibold'
              style={{ backgroundColor: agent.color || '#6366f1' }}
            >
              {agent.name
                .split(' ')
                .map(w => w[0])
                .join('')
                .slice(0, 2)
                .toUpperCase()}
            </div>
            <h2 className='text-lg font-semibold text-foreground'>{agent.name}</h2>
          </div>
          <button
            onClick={onClose}
            className='p-2 rounded-lg hover:bg-accent transition-colors'
            data-track-category='XyneAI'
            data-track-name='CloseAgentInfoModal'
          >
            <X size={16} className='text-current' />
          </button>
        </div>

        {/* Content */}
        <div className='p-4 overflow-y-auto flex-1 space-y-4'>
          {/* Description */}
          {agent.description && (
            <div>
              <span className='block text-sm font-medium text-foreground mb-2'>About</span>
              <p className='text-sm text-muted-foreground leading-relaxed'>{agent.description}</p>
            </div>
          )}

          {/* Tools */}
          {toolNames.length > 0 && (
            <div>
              <span className='flex items-center gap-2 text-sm font-medium text-foreground mb-2'>
                <Wrench size={14} />
                Tools ({toolNames.length})
              </span>
              <div className='flex flex-wrap gap-2'>
                {toolNames.map((tool, index) => (
                  <span
                    key={index}
                    className='px-2.5 py-1 text-xs font-medium rounded-full bg-muted text-muted-foreground border border-border'
                  >
                    {tool}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Skills */}
          {skillNames.length > 0 && (
            <div>
              <span className='flex items-center gap-2 text-sm font-medium text-foreground mb-2'>
                <Sparkles size={14} />
                Skills ({skillNames.length})
              </span>
              <div className='flex flex-wrap gap-2'>
                {skillNames.map((skill, index) => (
                  <span
                    key={index}
                    className='px-2.5 py-1 text-xs font-medium rounded-full bg-primary/10 text-primary border border-primary/20'
                  >
                    {skill}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Subagents */}
          {agent.subagents && agent.subagents.length > 0 && (
            <div>
              <span className='flex items-center gap-2 text-sm font-medium text-foreground mb-2'>
                <Bot size={14} />
                Subagents ({agent.subagents.length})
              </span>
              <div className='flex flex-wrap gap-2'>
                {agent.subagents.map((subagent, index) => (
                  <span
                    key={index}
                    className='px-2.5 py-1 text-xs font-medium rounded-full bg-accent text-accent-foreground border border-border'
                  >
                    {subagent}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Empty state if no description, tools, skills, or subagents */}
          {!agent.description &&
            toolNames.length === 0 &&
            skillNames.length === 0 &&
            (!agent.subagents || agent.subagents.length === 0) && (
              <div className='text-center py-8'>
                <p className='text-sm text-muted-foreground'>
                  No additional information available for this agent.
                </p>
              </div>
            )}
        </div>
      </div>
    </div>
  );
};
