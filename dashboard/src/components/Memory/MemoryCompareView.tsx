import React from 'react';
import type { MemoryDocument, MemoryUpdateRequest } from '../../types/memory';
import { Dialog } from '../ui/Dialog';
import MemoryCompareCard from './MemoryCompareCard';
import { X } from 'lucide-react';

interface MemoryCompareViewProps {
  documents: MemoryDocument[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRemoveDocument: (docId: string) => void;
  onUpdateDocument?: (docId: string, fields: MemoryUpdateRequest) => void;
  onDeleteDocument?: (docId: string) => void;
  updatingDocId?: string | null;
  deletingDocId?: string | null;
}

const MemoryCompareView: React.FC<MemoryCompareViewProps> = ({
  documents,
  open,
  onOpenChange,
  onRemoveDocument,
  onUpdateDocument,
  onDeleteDocument,
  updatingDocId,
  deletingDocId,
}) => {
  // Auto-close if less than 2 documents remain
  React.useEffect(() => {
    if (open && documents.length < 2) {
      onOpenChange(false);
    }
  }, [documents.length, open, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange} className='max-w-[95vw] w-[95vw] max-h-[90vh]'>
      <div className='flex flex-col h-[85vh]'>
        {/* Header */}
        <div className='flex items-center justify-between px-6 py-4 border-b border-border'>
          <div className='flex items-center gap-3'>
            <h2 className='text-lg font-semibold text-foreground'>Compare Context</h2>
            <span className='text-sm text-muted-foreground'>{documents.length} documents</span>
          </div>
          <button
            onClick={() => onOpenChange(false)}
            className='p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors'
            data-track-category='Memory'
            data-track-name='CloseCompareView'
          >
            <X size={18} />
          </button>
        </div>

        {/* Compare Grid */}
        <div className='flex-1 overflow-auto p-4'>
          <div
            className='grid gap-4 h-full'
            style={{
              gridTemplateColumns: `repeat(${Math.min(documents.length, 4)}, minmax(300px, 1fr))`,
            }}
          >
            {documents.map(doc => (
              <MemoryCompareCard
                key={doc.docId}
                document={doc}
                onRemove={() => onRemoveDocument(doc.docId)}
                onUpdate={onUpdateDocument}
                onDelete={onDeleteDocument}
                isUpdating={updatingDocId === doc.docId}
                isDeleting={deletingDocId === doc.docId}
              />
            ))}
          </div>
        </div>
      </div>
    </Dialog>
  );
};

export default MemoryCompareView;
