/**
 * QuartoInstructionsModal - Shows git workflow instructions after workspace setup
 *
 * Instead of redirecting to VS Code editor, this modal displays instructions
 * for the user to: clone repo, create branch, make changes, commit and push
 */
import React from 'react';
import {
  GitBranch,
  GitPullRequestArrow,
  Terminal,
  Copy,
  Check,
  X,
  FileCode,
  Rocket,
} from 'lucide-react';
import { Dialog } from '../../ui/Dialog';
import { Button } from '../../ui/Button';
import { useState, useCallback } from 'react';

interface QuartoInstructionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  repoUrl: string;
  branchName: string;
  repoName: string;
  mode: 'create' | 'edit';
}

interface CommandStepProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  command?: string;
}

const CommandStep: React.FC<CommandStepProps> = ({ icon, title, description, command }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    if (command) {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [command]);

  return (
    <div className='flex gap-4 p-4 bg-muted rounded-lg border border-border'>
      <div className='flex-shrink-0 w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center text-primary'>
        {icon}
      </div>
      <div className='flex-1 min-w-0'>
        <h4 className='text-sm font-semibold text-foreground'>{title}</h4>
        <p className='text-sm text-muted-foreground mt-0.5'>{description}</p>
        {command && (
          <div className='mt-2 flex items-center gap-2'>
            <code className='flex-1 text-xs bg-gray-900 text-gray-100 px-3 py-2 rounded-md font-mono overflow-x-auto'>
              {command}
            </code>
            <Button
              variant='ghost'
              size='iconSm'
              onClick={() => void handleCopy()}
              className='flex-shrink-0 h-8 w-8'
              title='Copy command'
            >
              {copied ? (
                <Check className='h-3.5 w-3.5 text-green-500' />
              ) : (
                <Copy className='h-3.5 w-3.5' />
              )}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};

export const QuartoInstructionsModal: React.FC<QuartoInstructionsModalProps> = ({
  isOpen,
  onClose,
  repoUrl,
  branchName,
  repoName,
  mode,
}) => {
  // Use the repo URL directly
  const cloneUrl = repoUrl;

  const steps: CommandStepProps[] = [
    {
      icon: <GitPullRequestArrow className='h-5 w-5' />,
      title: '1. Clone the repository',
      description: `Clone ${repoName} to your local machine if you haven't already.`,
      command: `git clone ${cloneUrl}`,
    },
    mode === 'create'
      ? {
          icon: <GitBranch className='h-5 w-5' />,
          title: '2. Create and checkout a new branch',
          description: `Create a new branch from "${branchName}" for your changes.`,
          command: `git checkout -b feature/your-doc-name ${branchName}`,
        }
      : {
          icon: <GitBranch className='h-5 w-5' />,
          title: '2. Checkout to the branch',
          description: `Checkout to branch "${branchName}" to make your changes.`,
          command: `git checkout ${branchName}`,
        },
    {
      icon: <FileCode className='h-5 w-5' />,
      title: '3. Make your changes',
      description: 'Edit your Quarto document (.qmd file) using your preferred editor.',
    },
    {
      icon: <Rocket className='h-5 w-5' />,
      title: '4. Publish',
      description:
        'Press Cmd+Shift+P and select "Xyne Code: Publish Quarto Docs" to publish your document.',
    },
  ];

  return (
    <Dialog open={isOpen} onOpenChange={open => !open && onClose()} className='max-w-lg'>
      {/* Header */}
      <div className='px-6 pt-6 pb-4 border-b border-border'>
        <div className='flex items-center gap-3'>
          <div className='w-12 h-12 rounded-xl bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center shadow-lg'>
            <Terminal className='h-6 w-6 text-white' />
          </div>
          <div>
            <h2 className='text-xl font-bold text-foreground'>
              {mode === 'create' ? 'Create New Quarto Document' : 'Edit Quarto Document'}
            </h2>
            <p className='text-sm text-muted-foreground'>
              Follow these steps to {mode === 'create' ? 'create' : 'edit'} your document
            </p>
          </div>
          <button
            onClick={onClose}
            className='ml-auto p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors'
            data-track-category='QUARTO_INSTRUCTIONS_MODAL'
            data-track-name='CloseButton'
          >
            <X className='h-5 w-5' />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className='px-6 py-4 space-y-3 max-h-[60vh] overflow-y-auto'>
        {/* Repository Info */}
        <div className='p-3 bg-primary/10 rounded-lg border border-primary/30'>
          <div className='flex items-center gap-2 text-sm'>
            <GitBranch className='h-4 w-4 text-primary' />
            <span className='font-medium text-primary'>Repository:</span>
            <span className='text-primary font-mono'>{repoName}</span>
          </div>
          <div className='flex items-center gap-2 text-sm mt-1'>
            <GitBranch className='h-4 w-4 text-primary' />
            <span className='font-medium text-primary'>Base Branch:</span>
            <span className='text-primary font-mono'>{branchName}</span>
          </div>
        </div>

        {/* Steps */}
        <div className='space-y-2'>
          {steps.map((step, index) => (
            <CommandStep key={index} {...step} />
          ))}
        </div>
      </div>

      {/* Footer align the button to the right */}
      <div className='px-6 py-4 flex justify-end border-t border-border bg-muted rounded-b-lg'>
        <Button variant='default' onClick={onClose} className='min-w-[100px]'>
          Got it
        </Button>
      </div>
    </Dialog>
  );
};

export default QuartoInstructionsModal;
