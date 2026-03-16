import React, { useState, useCallback, useEffect } from 'react';
import { X, Plus, Layout, Globe, GitBranch, Table2, MonitorPlay, AlertCircle } from 'lucide-react';

export type TabType =
  | 'graph'
  | 'preview'
  | 'table'
  | 'debug'
  | 'vscode'
  | 'custom'
  | 'git-diff'
  | 'live-preview'
  | 'live-edits'
  | 'rca-details'
  | 'workflow'
  | 'thread-summary'
  | 'context';

export interface WorkflowTab {
  id: string;
  title: string;
  type: TabType;
  icon?: React.ReactNode;
  closable?: boolean;
  content?: React.ReactNode;
  disabled?: boolean;
  disabledTooltip?: string;
}

interface WorkflowTabPanelProps {
  tabs: WorkflowTab[];
  activeTabId: string;
  onTabChange: (tabId: string) => void;
  onTabClose?: (tabId: string) => void;
  onTabAdd?: () => void;
  children?: React.ReactNode;
  className?: string;
}

const getTabIcon = (type: TabType, customIcon?: React.ReactNode): React.ReactNode => {
  if (customIcon) return customIcon;
  switch (type) {
    case 'graph':
      return <GitBranch size={12} />;
    case 'preview':
      return <Globe size={12} />;
    case 'table':
      return <Table2 size={12} />;
    case 'vscode':
      return <MonitorPlay size={12} />;
    case 'rca-details':
      return <AlertCircle size={12} className='text-red-500' />;
    default:
      return <Layout size={12} />;
  }
};

export const WorkflowTabPanel: React.FC<WorkflowTabPanelProps> = ({
  tabs,
  activeTabId,
  onTabChange,
  onTabClose,
  onTabAdd,
  children,
  className = '',
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [draggedTabId, setDraggedTabId] = useState<string | null>(null);

  const handleDragStart = useCallback((tabId: string) => {
    setIsDragging(true);
    setDraggedTabId(tabId);
  }, []);

  const handleDragEnd = useCallback(() => {
    setIsDragging(false);
    setDraggedTabId(null);
  }, []);

  const handleKeyDown = useCallback(
    (tabId: string, event: React.KeyboardEvent) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onTabChange(tabId);
      }
    },
    [onTabChange],
  );

  return (
    <div className={`h-full flex flex-col bg-background ${className}`}>
      {/* Tab Bar - Clean style */}
      <div className='flex-shrink-0 bg-muted border-b border-border'>
        <div className='flex items-center h-9'>
          {/* Tab List */}
          <div
            className='flex-1 flex items-center overflow-x-auto'
            style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
          >
            {tabs.map(tab => (
              <div
                key={tab.id}
                role='tab'
                aria-selected={activeTabId === tab.id}
                aria-disabled={tab.disabled}
                tabIndex={tab.disabled ? -1 : 0}
                onClick={() => !tab.disabled && onTabChange(tab.id)}
                onKeyDown={e => !tab.disabled && handleKeyDown(tab.id, e)}
                onDragStart={() => !tab.disabled && handleDragStart(tab.id)}
                onDragEnd={handleDragEnd}
                draggable={!tab.disabled}
                title={tab.disabled ? tab.disabledTooltip : undefined}
                className={`group relative flex items-center gap-1.5 px-3 h-9 min-w-[100px] max-w-[160px] border-r border-border/50 transition-all duration-150 ${
                  tab.disabled
                    ? 'cursor-not-allowed opacity-50 bg-transparent text-muted-foreground'
                    : activeTabId === tab.id
                      ? 'cursor-pointer bg-background text-foreground'
                      : 'cursor-pointer bg-transparent text-muted-foreground hover:bg-background/50 hover:text-foreground'
                } ${isDragging && draggedTabId === tab.id ? 'opacity-50' : ''}`}
                data-track-category='Workflows'
                data-track-name='SelectTab'
                data-track-metadata={JSON.stringify({ tabId: tab.id })}
              >
                <span
                  className={`flex-shrink-0 ${
                    tab.disabled
                      ? 'text-muted'
                      : activeTabId === tab.id
                        ? 'text-blue-500'
                        : 'text-muted-foreground'
                  }`}
                >
                  {getTabIcon(tab.type, tab.icon)}
                </span>
                <span className='flex-1 text-xs font-medium truncate'>{tab.title}</span>
                {tab.closable !== false && tabs.length > 1 && onTabClose && !tab.disabled && (
                  <button
                    onClick={e => {
                      e.stopPropagation();
                      onTabClose(tab.id);
                    }}
                    className='flex-shrink-0 p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-border transition-all'
                    aria-label={`Close ${tab.title}`}
                    data-track-category='Workflows'
                    data-track-name='CloseWorkflowTab'
                    data-track-metadata={JSON.stringify({ tabId: tab.id, tabType: tab.type })}
                  >
                    <X size={10} className='text-muted-foreground' />
                  </button>
                )}
                {/* Active indicator line */}
                {activeTabId === tab.id && !tab.disabled && (
                  <div className='absolute bottom-0 left-0 right-0 h-0.5 bg-blue-500' />
                )}
              </div>
            ))}
          </div>

          {/* Add Tab Button */}
          {onTabAdd && (
            <button
              onClick={onTabAdd}
              className='flex-shrink-0 flex items-center justify-center w-9 h-9 text-muted-foreground hover:text-muted-foreground hover:bg-background/50 transition-colors border-l border-border/50'
              title='New tab'
              aria-label='Add new tab'
              data-track-category='Workflows'
              data-track-name='AddWorkflowTab'
            >
              <Plus size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Tab Content */}
      <div className='flex-1 overflow-hidden'>
        {tabs.map(tab => (
          <div
            key={tab.id}
            style={{ display: tab.id === activeTabId ? 'block' : 'none' }}
            className='h-full'
          >
            {tab.content}
          </div>
        ))}
        {/* Fallback to children if no tab content */}
        {tabs.every(tab => !tab.content) && children && <div className='h-full'>{children}</div>}
      </div>
    </div>
  );
};

// Hook for managing workflow tabs
interface UseWorkflowTabsReturn {
  tabs: WorkflowTab[];
  activeTabId: string;
  setActiveTabId: React.Dispatch<React.SetStateAction<string>>;
  addTab: (tab: Omit<WorkflowTab, 'id'> & { id?: string }) => string;
  closeTab: (tabId: string) => void;
  updateTab: (tabId: string, updates: Partial<WorkflowTab>) => void;
  setTabs: React.Dispatch<React.SetStateAction<WorkflowTab[]>>;
}

export const useWorkflowTabs = (
  initialTabs: WorkflowTab[] = [],
  initialActiveTabId?: string,
): UseWorkflowTabsReturn => {
  const [tabs, setTabs] = useState<WorkflowTab[]>(initialTabs);
  const [activeTabId, setActiveTabId] = useState(initialActiveTabId || initialTabs[0]?.id || '');

  // Sync activeTabId when initialActiveTabId changes (e.g., from persisted state)
  useEffect(() => {
    if (initialActiveTabId && initialActiveTabId !== activeTabId) {
      setActiveTabId(initialActiveTabId);
    }
  }, [initialActiveTabId]); // Only depend on initialActiveTabId, not activeTabId to avoid loops

  const addTab = useCallback((tab: Omit<WorkflowTab, 'id'> & { id?: string }) => {
    const tabId = tab.id || `tab-${crypto.randomUUID()}`;

    // Idempotent: if tab with this id exists, just activate it
    setTabs(prev => {
      const existing = prev.find(t => t.id === tabId);
      if (existing) {
        setActiveTabId(tabId);
        return prev;
      }
      const newTab: WorkflowTab = { ...tab, id: tabId };
      setActiveTabId(tabId);
      return [...prev, newTab];
    });

    return tabId;
  }, []);

  const closeTab = useCallback(
    (tabId: string) => {
      setTabs(prev => {
        const newTabs = prev.filter(t => t.id !== tabId);
        if (activeTabId === tabId && newTabs.length > 0) {
          setActiveTabId(newTabs[newTabs.length - 1]?.id || '');
        }
        return newTabs;
      });
    },
    [activeTabId],
  );

  const updateTab = useCallback((tabId: string, updates: Partial<WorkflowTab>) => {
    setTabs(prev => prev.map(t => (t.id === tabId ? { ...t, ...updates } : t)));
  }, []);

  return {
    tabs,
    activeTabId,
    setActiveTabId,
    addTab,
    closeTab,
    updateTab,
    setTabs,
  };
};

export default WorkflowTabPanel;
