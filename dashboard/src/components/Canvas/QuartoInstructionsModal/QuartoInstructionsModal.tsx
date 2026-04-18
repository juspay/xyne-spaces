import React from 'react';
import { Dialog } from '../../ui/Dialog';
import { Button } from '../../ui/Button';

interface PublishDocsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const PublishDocsModal: React.FC<PublishDocsModalProps> = ({ isOpen, onClose }) => {
  return (
    <Dialog open={isOpen} onOpenChange={open => !open && onClose()} title='How to publish docs'>
      <div className='p-6'>
        <h2 className='text-lg font-semibold text-foreground mb-4'>How to publish docs</h2>
        <ol className='list-decimal list-inside space-y-3 text-sm text-foreground'>
          <li>Install the Xyne desktop app and the latest Xyne Code extension in VS Code Editor</li>
          <li>
            Create a Quarto project{' '}
            <code className='px-1.5 py-0.5 text-xs font-mono bg-muted rounded border border-border'>
              .qmd
            </code>{' '}
            or a Markdown file{' '}
            <code className='px-1.5 py-0.5 text-xs font-mono bg-muted rounded border border-border'>
              .md
            </code>{' '}
            in VS Code
          </li>
          <li>
            Press{' '}
            <kbd className='px-1.5 py-0.5 text-xs font-mono bg-muted rounded border border-border'>
              Cmd/Ctrl + Shift + P
            </kbd>{' '}
            to open the command palette
          </li>
          <li>Search for &quot;Publish Quarto Docs&quot; or &quot;Publish Markdown&quot;</li>
          <li>Select a channel or select personal, then publish</li>
        </ol>
        <div className='flex justify-end mt-6 pt-4 border-t border-border'>
          <Button variant='default' onClick={onClose} className='min-w-[100px]'>
            Got it
          </Button>
        </div>
      </div>
    </Dialog>
  );
};

export default PublishDocsModal;
