import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Monitor, AppWindow, X } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '../../utils/classNames';

import { useTheme } from '../../hooks/useTheme';
import { MACOS_PRIVACY_URLS } from '../../constants/permissions';
import type { ScreenSource } from '../../types/electron';

type Tab = 'screen' | 'window';

interface PickerState {
  sources: ScreenSource[];
  permissionError: 'denied' | null;
}

export function ScreenPickerModal(): React.ReactElement | null {
  const [pickerState, setPickerState] = useState<PickerState | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('screen');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [shareAudio, setShareAudio] = useState(false);
  const { theme } = useTheme();
  const isDark = theme === 'midnight';

  const screenPicker = window.electronAPI?.screenPicker;

  useEffect(() => {
    if (!screenPicker) return;

    const unsubShow = screenPicker.onShow(data => {
      if (data.permissionError === 'denied') {
        // Show the same toast as mic/camera — its "Open Settings" uses openExternal which works reliably
        const isElectron = typeof window !== 'undefined' && !!window.electronAPI;
        const screenSettingsUrl = MACOS_PRIVACY_URLS['screen'];
        toast.error('Screen recording access is blocked', {
          description: 'Please allow access in your system settings and reload.',
          duration: 6000,
          action:
            isElectron && screenSettingsUrl
              ? {
                  label: 'Open Settings',
                  onClick: () => {
                    void window.electronAPI?.openExternal?.(screenSettingsUrl);
                  },
                }
              : undefined,
        });
        return;
      }
      setPickerState(data);
      setActiveTab('screen');
      setSelectedId(null);
      setShareAudio(false);
    });

    const unsubClose = screenPicker.onClose(() => {
      setPickerState(null);
    });

    return () => {
      unsubShow();
      unsubClose();
    };
  }, [screenPicker]);

  if (!pickerState) return null;

  const { sources } = pickerState;

  const handleCancel = (): void => {
    screenPicker?.cancel();
    setPickerState(null);
  };

  const handleShare = (): void => {
    if (!selectedId) return;
    screenPicker?.select(selectedId, shareAudio);
    setPickerState(null);
  };

  const screens = sources.filter(s => s.type === 'screen');
  const windows = sources.filter(s => s.type === 'window');
  const visibleSources = activeTab === 'screen' ? screens : windows;

  return createPortal(
    <div
      className='fixed inset-0 z-50 flex items-center justify-center'
      style={{ background: 'rgba(0,0,0,0.55)' }}
      role='presentation'
      onKeyDown={e => {
        if (e.key === 'Escape') handleCancel();
      }}
      onClick={e => {
        if (e.target === e.currentTarget) handleCancel();
      }}
      data-track-category='screen-picker'
      data-track-name='backdrop-dismiss'
    >
      <div className='bg-background border border-border rounded-xl shadow-2xl w-[780px] max-w-[95vw] max-h-[85vh] flex flex-col overflow-hidden'>
        {/* Header */}
        <div className='flex items-center justify-between px-5 pt-4 pb-0'>
          <h2 className='text-foreground text-[15px] font-semibold'>Share your screen</h2>
          <button
            onClick={handleCancel}
            className='text-muted-foreground hover:text-foreground hover:bg-muted rounded-md p-1.5 transition-colors'
            aria-label='Close'
            data-track-category='screen-picker'
            data-track-name='close'
          >
            <X className='w-4 h-4' />
          </button>
        </div>

        {/* Tabs — Slack-style underline */}
        <div className='flex border-b border-border px-5 mt-3'>
          <button
            onClick={() => {
              setActiveTab('screen');
              setSelectedId(null);
            }}
            data-track-category='screen-picker'
            data-track-name='tab-screen'
            className={cn(
              'flex items-center gap-1.5 px-1 pb-2.5 mr-6 text-sm font-medium border-b-2 -mb-px transition-colors',
              activeTab === 'screen'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            <Monitor className='w-3.5 h-3.5' />
            Entire Screen
            <span
              className={cn(
                'text-xs rounded-full px-1.5 py-0.5 tabular-nums',
                activeTab === 'screen'
                  ? isDark
                    ? 'bg-blue-600/25 text-blue-400'
                    : 'bg-blue-100 text-blue-600'
                  : 'bg-muted text-muted-foreground',
              )}
            >
              {screens.length}
            </span>
          </button>
          <button
            onClick={() => {
              setActiveTab('window');
              setSelectedId(null);
            }}
            data-track-category='screen-picker'
            data-track-name='tab-window'
            className={cn(
              'flex items-center gap-1.5 px-1 pb-2.5 text-sm font-medium border-b-2 -mb-px transition-colors',
              activeTab === 'window'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            <AppWindow className='w-3.5 h-3.5' />
            Window
            <span
              className={cn(
                'text-xs rounded-full px-1.5 py-0.5 tabular-nums',
                activeTab === 'window'
                  ? isDark
                    ? 'bg-blue-600/25 text-blue-400'
                    : 'bg-blue-100 text-blue-600'
                  : 'bg-muted text-muted-foreground',
              )}
            >
              {windows.length}
            </span>
          </button>
        </div>

        {/* Source grid */}
        <div className='overflow-y-auto flex-1 p-4'>
          {visibleSources.length === 0 ? (
            <div className='flex flex-col items-center justify-center py-12 text-muted-foreground gap-2'>
              <Monitor className='w-8 h-8' />
              <p className='text-sm'>No {activeTab === 'screen' ? 'screens' : 'windows'} found</p>
            </div>
          ) : (
            <div
              className={cn('grid gap-3', activeTab === 'screen' ? 'grid-cols-2' : 'grid-cols-3')}
            >
              {visibleSources.map(source => (
                <button
                  key={source.id}
                  onClick={() => setSelectedId(source.id)}
                  onDoubleClick={handleShare}
                  data-track-category='screen-picker'
                  data-track-name='source-select'
                  className={cn(
                    'group flex flex-col rounded-lg overflow-hidden border-2 transition-all duration-150 text-left focus:outline-none',
                    selectedId === source.id
                      ? 'border-blue-500 shadow-[0_0_0_1px_rgba(59,130,246,0.3)]'
                      : 'border-border hover:border-blue-400',
                  )}
                >
                  {/* Thumbnail — object-contain keeps full window visible, no cropping */}
                  <div className='relative bg-muted w-full aspect-video overflow-hidden'>
                    <img
                      src={source.thumbnail}
                      alt={source.name}
                      className='w-full h-full object-contain'
                      draggable={false}
                    />
                    {/* Ring overlay when selected */}
                    {selectedId === source.id && (
                      <div className='absolute inset-0 ring-2 ring-inset ring-blue-500 pointer-events-none' />
                    )}
                    {/* Check badge */}
                    {selectedId === source.id && (
                      <div className='absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-blue-500 flex items-center justify-center shadow'>
                        <svg className='w-3 h-3 text-white' fill='none' viewBox='0 0 12 12'>
                          <path
                            d='M2 6l3 3 5-5'
                            stroke='currentColor'
                            strokeWidth='1.8'
                            strokeLinecap='round'
                            strokeLinejoin='round'
                          />
                        </svg>
                      </div>
                    )}
                  </div>
                  {/* Label */}
                  <div
                    className={cn(
                      'px-2.5 py-2 text-xs font-medium truncate border-t border-border transition-colors',
                      selectedId === source.id
                        ? 'text-blue-600 bg-blue-500/10'
                        : 'text-foreground bg-background group-hover:bg-muted',
                    )}
                  >
                    {source.name}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className='flex items-center justify-between px-5 py-3.5 border-t border-border'>
          <label className='flex items-center gap-2 cursor-pointer select-none'>
            <input
              type='checkbox'
              checked={shareAudio}
              onChange={e => setShareAudio(e.target.checked)}
              className='w-4 h-4 rounded accent-blue-500 cursor-pointer'
              data-track-category='screen-picker'
              data-track-name='toggle-audio'
            />
            <span className='text-sm text-muted-foreground'>Share system audio</span>
          </label>

          <div className='flex items-center gap-2'>
            <button
              onClick={handleCancel}
              data-track-category='screen-picker'
              data-track-name='cancel'
              className='px-4 py-2 text-sm rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors'
            >
              Cancel
            </button>
            <button
              onClick={handleShare}
              disabled={!selectedId}
              data-ph-capture-attribute-track-id='share_screen'
              data-track-category='screen-picker'
              data-track-name='share'
              className={cn(
                'px-5 py-2 text-sm rounded-lg font-medium transition-colors',
                selectedId
                  ? 'bg-blue-600 hover:bg-blue-500 text-white'
                  : 'bg-muted text-muted-foreground cursor-not-allowed',
              )}
            >
              Share
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
