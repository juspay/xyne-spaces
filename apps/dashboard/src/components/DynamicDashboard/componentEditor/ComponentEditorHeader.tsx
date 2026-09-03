import { LayoutDashboard, Loader2, RefreshCw } from 'lucide-react';
import type { ReactElement } from 'react';

interface ComponentEditorHeaderProps {
  dashboardName: string;
  title: string;
  isPreviewing: boolean;
  isSaving: boolean;
  planIsValid: boolean;
  hasPreviewError: boolean;
  onRefresh: () => void;
  onCancel: () => void;
  onSave: () => void;
}

export const ComponentEditorHeader = ({
  dashboardName,
  title,
  isPreviewing,
  isSaving,
  planIsValid,
  hasPreviewError,
  onRefresh,
  onCancel,
  onSave,
}: ComponentEditorHeaderProps): ReactElement => (
  <div className='flex items-center justify-between gap-3 h-12 px-4 border-b border-xyne-gray-200 shrink-0'>
    <div className='flex items-center gap-2 min-w-0 text-[13px] leading-[18px]'>
      <LayoutDashboard size={14} className='text-xyne-gray-500 shrink-0' />
      <span className='font-medium text-xyne-gray-900 truncate'>{dashboardName}</span>
      <span className='text-xyne-gray-300'>/</span>
      <span className='font-medium text-xyne-gray-900 truncate'>{title.trim() || 'Untitled'}</span>
    </div>
    <div className='flex items-center gap-1.5'>
      <button
        type='button'
        onClick={onRefresh}
        disabled={isPreviewing || !planIsValid}
        className='inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-xyne-gray-200 bg-white text-[13px] leading-[18px] font-medium text-xyne-gray-900 transition-colors hover:bg-xyne-gray-50 disabled:opacity-50 disabled:cursor-not-allowed'
        data-track-category='COMPONENT_EDITOR'
        data-track-name='Refresh_Preview_Click'
      >
        <RefreshCw
          size={14}
          className={`text-xyne-gray-600 ${isPreviewing ? 'animate-spin' : ''}`}
        />
        {isPreviewing ? 'Running…' : 'Refresh'}
      </button>
      <button
        type='button'
        onClick={onCancel}
        className='inline-flex items-center h-8 px-4 rounded-lg border border-xyne-gray-200 bg-white text-[13px] leading-[18px] font-medium text-xyne-gray-900 transition-colors hover:bg-xyne-gray-50'
        data-track-category='COMPONENT_EDITOR'
        data-track-name='Cancel_Click'
      >
        Cancel
      </button>
      <button
        type='button'
        onClick={onSave}
        disabled={isSaving || !planIsValid || hasPreviewError}
        className='inline-flex items-center h-8 px-4 rounded-lg bg-xyne-primary-500 text-[13px] leading-[18px] font-medium text-white transition-colors hover:bg-xyne-primary-600 disabled:bg-xyne-gray-300 disabled:text-white disabled:cursor-not-allowed'
        data-track-category='COMPONENT_EDITOR'
        data-track-name='Save_Click'
      >
        {isSaving ? <Loader2 size={14} className='mr-1.5 animate-spin' /> : null}
        {isSaving ? 'Saving…' : 'Save'}
      </button>
    </div>
  </div>
);
