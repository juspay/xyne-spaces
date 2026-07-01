/**
 * RecordingCanvasPane - Right pane of the recording split view.
 * Hosts a live collaborative canvas for notes taken during an active recording.
 * Only mounted after the user creates a canvas (see RecordingsScreen split layout).
 */

import { ReactElement, useCallback } from 'react';
import { FileText } from 'lucide-react';
import { CollaborativeCanvasEditor } from '../../../components/Canvas/CollaborativeCanvasEditor/CollaborativeCanvasEditor';
import { canvasService } from '../../../services/Canvas/canvasService';

interface RecordingCanvasPaneProps {
  channelId: string | null;
  notesCanvasId: string;
  notesCanvasViewAccessId: string;
}

export function RecordingCanvasPane({
  channelId,
  notesCanvasId,
  notesCanvasViewAccessId,
}: RecordingCanvasPaneProps): ReactElement {
  const handleFileUpload = useCallback(
    (file: File): Promise<string> => canvasService.uploadCanvasFile(notesCanvasId, file),
    [notesCanvasId],
  );

  return (
    <div className='flex flex-col h-full overflow-hidden'>
      {/* Header — mirrors ActiveRecordingView's header rhythm */}
      <div className='px-6 py-4 border-b border-input dark:border-gray-700 flex items-center gap-2'>
        <FileText className='w-4 h-4 text-muted-foreground' />
        <span className='text-sm font-medium text-foreground dark:text-gray-100'>
          Recording Notes
        </span>
      </div>

      {/* Collaborative editor — synced via Y-Sweet CRDT */}
      <div className='flex-1 overflow-auto'>
        <CollaborativeCanvasEditor
          canvasId={notesCanvasId}
          channelId={channelId ?? undefined}
          viewAccessId={notesCanvasViewAccessId}
          editable
          autoFocus
          placeholder='Jot down notes while you record…'
          onFileUpload={handleFileUpload}
        />
      </div>
    </div>
  );
}
