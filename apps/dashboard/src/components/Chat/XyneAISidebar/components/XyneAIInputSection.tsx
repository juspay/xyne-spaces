import { forwardRef } from 'react';
import {
  XyneAIInputBox,
  type XyneAIInputBoxHandle,
  type XyneAIInputBoxProps,
} from './XyneAIInputBox';
import { ContextPickerPanel, type ContextSelections } from './ContextPickerPanel';

interface XyneAIInputSectionProps extends XyneAIInputBoxProps {
  showContextModal: boolean;
  onCloseContextModal: () => void;
  onConfirmContext: (selections: ContextSelections) => void;
  contextSelections: ContextSelections;
  contextPanelPosition?: 'top' | 'bottom';
  compactToolbar?: boolean;
}

/**
 * Wraps XyneAIInputBox together with the ContextPickerPanel modal overlay so
 * that neither needs to be duplicated at every call-site.
 */
export const XyneAIInputSection = forwardRef<XyneAIInputBoxHandle, XyneAIInputSectionProps>(
  (
    {
      showContextModal,
      onCloseContextModal,
      onConfirmContext,
      contextSelections,
      contextPanelPosition = 'bottom',
      compactToolbar = false,
      ...inputBoxProps
    },
    ref,
  ) => {
    return (
      <div className='relative'>
        {showContextModal && (
          <>
            {/* Accessible backdrop — closes the panel on click or Escape */}
            <button
              type='button'
              className='fixed inset-0 z-10 cursor-default border-none bg-transparent p-0'
              onClick={onCloseContextModal}
              onKeyDown={e => {
                if (e.key === 'Escape') onCloseContextModal();
              }}
              aria-label='Close context modal'
              data-track-category='XyneAI'
              data-track-name='CLOSE_CONTEXT_MODAL_BACKDROP'
            />
            <div
              className={
                contextPanelPosition === 'top'
                  ? 'absolute top-full left-0 right-0 z-20 pt-2'
                  : 'absolute bottom-full left-0 right-0 z-20 px-4 pb-2'
              }
            >
              <ContextPickerPanel
                onClose={onCloseContextModal}
                onConfirm={onConfirmContext}
                initialSelections={contextSelections}
              />
            </div>
          </>
        )}
        <XyneAIInputBox
          ref={ref}
          {...inputBoxProps}
          compactToolbar={compactToolbar}
          onCloseContextModal={onCloseContextModal}
          isContextModalOpen={showContextModal}
          // The inline picker toggles context through the same wholesale-replace
          // contract the old modal confirmed through.
          onContextSelectionsChange={onConfirmContext}
        />
      </div>
    );
  },
);

XyneAIInputSection.displayName = 'XyneAIInputSection';
