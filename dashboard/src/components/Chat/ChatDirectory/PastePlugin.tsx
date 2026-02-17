import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { useEffect, useRef } from 'react';
import { $getRoot } from 'lexical';

export type QuerySource = 'KEYBOARD' | 'CLIPBOARD_PASTE';

interface PastePluginProps {
  onPasteDetected?: () => void;
  onManualKeystroke?: () => void;
}

/**
 * PastePlugin for Lexical Editor
 *
 * Detects paste events and manual keystrokes to track clipboard usage:
 * - Sets querySource to CLIPBOARD_PASTE when paste is detected (Cmd+V / Ctrl+V)
 * - Flips isModified to true when ANY keystroke occurs after paste (additions, deletions, backspaces)
 * - Resets tracking when the editor content is cleared
 */
export function PastePlugin({ onPasteDetected, onManualKeystroke }: PastePluginProps) {
  const [editor] = useLexicalComposerContext();
  const isPasteRef = useRef(false);
  const prePasteTextRef = useRef('');
  const postPasteBaselineRef = useRef('');

  useEffect(() => {
    // Listen for native paste events on the editor
    const rootElement = editor.getRootElement();
    if (!rootElement) return;

    const handlePaste = (event: ClipboardEvent) => {
      // Only track paste if it contains text content
      if (event.clipboardData && event.clipboardData.getData('text/plain').trim().length > 0) {
        // Store the text BEFORE paste
        editor.getEditorState().read(() => {
          prePasteTextRef.current = $getRoot().getTextContent();
        });

        // Set paste state IMMEDIATELY before editor processes the content
        isPasteRef.current = true;

        // Call paste detection callback SYNCHRONOUSLY
        // This ensures query_source is set before any content changes trigger search
        onPasteDetected?.();
      }
    };

    // Use capture phase to ensure we catch the paste event before Lexical processes it
    rootElement.addEventListener('paste', handlePaste, { capture: true });

    return () => {
      rootElement.removeEventListener('paste', handlePaste, { capture: true });
    };
  }, [editor, onPasteDetected]);

  useEffect(() => {
    // Register update listener to detect manual keystrokes after paste
    const unregisterUpdate = editor.registerUpdateListener(({ dirtyElements, dirtyLeaves }) => {
      // Only care about updates that change content (not selection changes)
      if (dirtyElements.size === 0 && dirtyLeaves.size === 0) return;

      editor.getEditorState().read(() => {
        const currentText = $getRoot().getTextContent();

        // Handle paste settling phase
        if (isPasteRef.current && postPasteBaselineRef.current === '') {
          // This is the FIRST update after paste - store the post-paste baseline
          // This represents the content after paste operation completed
          postPasteBaselineRef.current = currentText;
          // Note: we DON'T flip is_modified here - paste itself is not a modification
          return;
        }

        // Detect modifications after paste has settled
        if (isPasteRef.current && postPasteBaselineRef.current !== '') {
          // Compare current text against POST-PASTE baseline (not pre-paste)
          if (currentText !== postPasteBaselineRef.current) {
            // User made changes AFTER paste - this is a modification
            isPasteRef.current = false; // Mark as modified
            onManualKeystroke?.();
          }
        }
      });
    });

    return () => {
      unregisterUpdate();
    };
  }, [editor, onManualKeystroke]);

  // Reset state when editor is cleared (detected by empty text)
  useEffect(() => {
    const unregisterUpdate = editor.registerUpdateListener(() => {
      editor.getEditorState().read(() => {
        const currentText = $getRoot().getTextContent();

        // If text is empty, reset tracking state
        if (currentText.trim().length === 0) {
          isPasteRef.current = false;
          prePasteTextRef.current = '';
          postPasteBaselineRef.current = '';
        }
      });
    });

    return () => {
      unregisterUpdate();
    };
  }, [editor]);

  return null;
}
