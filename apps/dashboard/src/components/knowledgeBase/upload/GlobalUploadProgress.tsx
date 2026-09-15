import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { X, Minus, ChevronUp, CheckCircle2, XCircle, Loader2, AlertTriangle } from 'lucide-react';
import { useUploadProgress } from '../../../store/useUploadProgressStore';
import Tooltip from '../../ui/Tooltip';

/** Auto-dismiss delay (ms) for fully-successful uploads. */
const SUCCESS_AUTO_DISMISS_MS = 6000;
/** Max files shown in the expanded list before a "+N more" line. */
const MAX_VISIBLE_FILES = 6;
/** Card width (w-80 = 320px). */
const CARD_WIDTH = 320;
/** Default margin from edges. */
const DEFAULT_MARGIN = 20;

/**
 * GlobalUploadProgress
 *
 * A Google-Drive-style floating card pinned to the bottom-right corner.
 * Reads entirely from the global `useUploadProgress` zustand store so it
 * works regardless of which page the user navigates to.
 *
 * Mount once at the app root (e.g. AppRoot.tsx).
 */
export function GlobalUploadProgress(): React.ReactElement | null {
  const currentUpload = useUploadProgress(s => s.currentUpload);
  const clearUpload = useUploadProgress(s => s.clearUpload);
  const cancelUpload = useUploadProgress(s => s.cancelUpload);

  const [isExpanded, setIsExpanded] = useState(true);
  const fileListRef = useRef<HTMLDivElement | null>(null);
  const shouldAutoScrollRef = useRef(true);

  // Auto-expand when a new upload starts
  useEffect(() => {
    if (currentUpload?.isUploading) {
      setIsExpanded(true);
    }
  }, [currentUpload?.id, currentUpload?.isUploading]);

  // Detect manual scroll — stop auto-scroll if user scrolls up
  useEffect(() => {
    const el = fileListRef.current;
    if (!el) return;

    const handleScroll = (): void => {
      const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 10;
      shouldAutoScrollRef.current = isAtBottom;
    };

    el.addEventListener('scroll', handleScroll);
    return (): void => el.removeEventListener('scroll', handleScroll);
  }, []);

  // Auto-scroll ONLY while uploading & user hasn't scrolled away
  useEffect(() => {
    if (!isExpanded || !currentUpload?.isUploading) return;

    const el = fileListRef.current;
    if (el && shouldAutoScrollRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [currentUpload?.files.length, isExpanded, currentUpload?.isUploading]);

  // Auto-dismiss fully-successful uploads after a delay
  useEffect(() => {
    if (!currentUpload || currentUpload.isUploading) return;

    const hasFailed = currentUpload.files.some(f => f.status === 'failed');
    if (hasFailed) return; // keep visible until manually dismissed

    const timer = setTimeout(() => {
      clearUpload(currentUpload.id);
    }, SUCCESS_AUTO_DISMISS_MS);

    return (): void => clearTimeout(timer);
  }, [currentUpload?.isUploading, currentUpload?.id, clearUpload, currentUpload]);

  // Early return after all hooks
  if (!currentUpload) return null;

  // ── Derived state ────────────────────────────────────────────────
  const { isUploading, collectionName, batchProgress, files, statusLabel } = currentUpload;
  const { total, current } = batchProgress;
  const progressPct = total > 0 ? Math.round((current / total) * 100) : 0;

  const uploaded = files.filter(f => f.status === 'uploaded').length;
  const failed = files.filter(f => f.status === 'failed').length;
  const skipped = files.filter(f => f.status === 'skipped').length;
  const isComplete = !isUploading;
  const hasErrors = failed > 0;

  // ── Handlers ─────────────────────────────────────────────────────
  const handleDismiss = (): void => {
    if (isUploading) {
      cancelUpload(currentUpload.id);
    } else {
      clearUpload(currentUpload.id);
    }
  };

  // ── File list ────────────────────────────────────────────────────
  // Show most recent files first (better UX than always slicing from start)
  const sortedFiles = [...files].sort((a, b) => {
    if (a.status === 'uploading') return -1;
    if (b.status === 'uploading') return 1;
    return 0;
  });

  const visibleFiles = isExpanded ? sortedFiles.slice(0, MAX_VISIBLE_FILES) : [];

  const hiddenCount = Math.max(0, files.length - visibleFiles.length);

  // Rough card height for drag constraints:
  // header (~40) + progress-or-summary (~40) + file list (capped at max-h-52 = 208)
  const estimatedCardHeight =
    isExpanded && visibleFiles.length > 0 ? 40 + 40 + Math.min(visibleFiles.length * 28, 208) : 80;

  // ── Render ───────────────────────────────────────────────────────
  // The card rests at bottom-right via CSS: bottom: 20px, left: windowWidth - 320 - 20.
  // Framer Motion drag offsets are RELATIVE to that resting position, so:
  //   - left  (min x): large negative to allow dragging all the way to the left edge
  //   - right (max x): small positive   — already near the right edge
  //   - top   (min y): large negative   — allow dragging up to the top
  //   - bottom(max y): small positive   — already near the bottom edge
  return createPortal(
    <motion.div
      drag
      dragMomentum={false}
      dragElastic={0}
      dragConstraints={{
        left: -(window.innerWidth - CARD_WIDTH - 2 * DEFAULT_MARGIN),
        right: DEFAULT_MARGIN,
        top: -(window.innerHeight - estimatedCardHeight - 2 * DEFAULT_MARGIN),
        bottom: DEFAULT_MARGIN,
      }}
      initial={{ y: 16, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      whileDrag={{ cursor: 'grabbing' }}
      className='fixed z-[60] w-80 shadow-2xl border border-gray-200 bg-white overflow-hidden rounded-md'
      style={{
        bottom: `${DEFAULT_MARGIN}px`,
        left: `${window.innerWidth - CARD_WIDTH - DEFAULT_MARGIN}px`,
      }}
    >
      {/* ── Header ─────────────────────────────────────────────── */}
      <div
        role='button'
        tabIndex={0}
        aria-label='Drag to reposition upload progress'
        className='flex items-center justify-between px-3 py-2.5 bg-gray-50 border-b border-gray-100 cursor-grab active:cursor-grabbing select-none'
        onKeyDown={(e): void => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
          }
        }}
      >
        <div className='flex items-center gap-2 min-w-0 flex-1'>
          {isComplete ? (
            hasErrors ? (
              <AlertTriangle size={16} className='text-amber-500 flex-shrink-0' />
            ) : (
              <CheckCircle2 size={16} className='text-green-500 flex-shrink-0' />
            )
          ) : (
            <Loader2 size={16} className='text-blue-500 animate-spin flex-shrink-0' />
          )}
          <span className='text-sm font-medium text-gray-800 truncate'>
            {isComplete
              ? hasErrors
                ? 'Upload finished with errors'
                : 'Upload complete'
              : (statusLabel ?? `Uploading ${current} of ${total} files`)}
          </span>
        </div>

        <div className='flex items-center gap-0.5 flex-shrink-0 ml-2'>
          <Tooltip content={isExpanded ? 'Minimize' : 'Expand'} side='top'>
            <button
              onClick={e => {
                e.stopPropagation();
                setIsExpanded(v => !v);
              }}
              onMouseDown={e => e.stopPropagation()}
              onTouchStart={e => e.stopPropagation()}
              data-track-category='knowledge-base'
              data-track-name='toggle-upload-progress'
              className='p-1 rounded hover:bg-gray-200 transition-colors text-gray-500'
            >
              {isExpanded ? <Minus size={14} /> : <ChevronUp size={14} />}
            </button>
          </Tooltip>
          {!isUploading && (
            <Tooltip content='Dismiss' side='top'>
              <button
                onClick={e => {
                  e.stopPropagation();
                  handleDismiss();
                }}
                onMouseDown={e => e.stopPropagation()}
                onTouchStart={e => e.stopPropagation()}
                data-track-category='knowledge-base'
                data-track-name='dismiss-upload-progress'
                className='p-1 rounded hover:bg-gray-200 transition-colors text-gray-500'
              >
                <X size={14} />
              </button>
            </Tooltip>
          )}
        </div>
      </div>

      {/* ── Progress bar (visible while uploading) ─────────────── */}
      {isUploading && (
        <div className='px-3 pt-2 pb-1'>
          <div className='flex items-center justify-between mb-1'>
            <span className='text-xs text-gray-500 truncate'>{collectionName}</span>
            <span className='text-xs font-medium text-gray-600 ml-2'>{progressPct}%</span>
          </div>
          <div className='w-full bg-gray-100 rounded-full h-1.5'>
            <div
              className='bg-blue-500 h-1.5 rounded-full transition-all duration-300 ease-out'
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      )}

      {/* ── Completion summary (visible when done) ─────────────── */}
      {isComplete && (
        <div className='px-3 py-2'>
          <p className='text-xs text-gray-500'>
            {buildSummary(uploaded, skipped, failed, collectionName)}
          </p>
        </div>
      )}

      {/* ── File list (expanded) ───────────────────────────────── */}
      {isExpanded && visibleFiles.length > 0 && (
        <div ref={fileListRef} className='px-3 pb-2.5 max-h-52 overflow-y-auto'>
          <div className='space-y-0.5'>
            {visibleFiles.map(file => (
              <motion.div
                key={file.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2 }}
                className='flex items-center gap-2 py-1 rounded px-1 hover:bg-gray-50'
              >
                <FileStatusIcon status={file.status} />
                <span className='text-xs text-gray-700 truncate flex-1'>{file.name}</span>
                {file.status === 'skipped' && (
                  <span className='text-[10px] text-gray-400 flex-shrink-0'>duplicate</span>
                )}
                {file.status === 'failed' && file.error && (
                  <span className='text-[10px] text-red-400 truncate max-w-[100px] flex-shrink-0'>
                    {file.error}
                  </span>
                )}
              </motion.div>
            ))}
            {hiddenCount > 0 && (
              <div className='text-xs text-gray-400 py-1 px-1 hover:text-gray-600 transition-colors'>
                +{hiddenCount} more file{hiddenCount !== 1 ? 's' : ''}
              </div>
            )}
          </div>
        </div>
      )}
    </motion.div>,
    document.body,
  );
}

// ── Helpers ──────────────────────────────────────────────────────────

function FileStatusIcon({
  status,
}: {
  status: 'pending' | 'uploading' | 'uploaded' | 'failed' | 'skipped';
}): React.ReactElement {
  switch (status) {
    case 'uploaded':
    case 'skipped':
      return <CheckCircle2 size={12} className='text-green-500 flex-shrink-0' />;
    case 'failed':
      return <XCircle size={12} className='text-red-500 flex-shrink-0' />;
    case 'uploading':
      return <Loader2 size={12} className='text-blue-500 animate-spin flex-shrink-0' />;
    default:
      return <div className='w-3 h-3 rounded-full border-2 border-gray-300 flex-shrink-0' />;
  }
}

function buildSummary(
  uploaded: number,
  skipped: number,
  failed: number,
  collectionName: string,
): string {
  const parts: string[] = [];
  if (uploaded > 0) parts.push(`${uploaded} file${uploaded !== 1 ? 's' : ''} uploaded`);
  if (skipped > 0) parts.push(`${skipped} skipped`);
  if (failed > 0) parts.push(`${failed} failed`);
  const summary = parts.length > 0 ? parts.join(', ') : 'No files processed';
  return collectionName ? `${summary} — ${collectionName}` : summary;
}
