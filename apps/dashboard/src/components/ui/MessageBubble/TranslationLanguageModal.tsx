import React, { useState } from 'react';
import { MultipleCrossCancelDefault } from '@xyne/icons';
import { Dialog } from '../Dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../Select';
import { Checkbox } from '../Checkbox/Checkbox';
import { Button } from '../Button/Button';
import { apiInstance } from '../../../services/clients/apiClient';
import {
  PREFERRED_LANGUAGE_OPTIONS,
  usePreferredLanguage,
} from '../../../hooks/usePreferredLanguage';

interface TranslationLanguageModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  messageId: string;
  /** Called once the translate request has been sent, so the caller can flip its
   * local `showTranslated`/`translationActivated` state the same way the hover-toolbar
   * Translate click does. */
  onTranslateRequested: (targetLang: string) => void;
}

/**
 * Per-message target-language override — distinct from the workspace-wide
 * `preferredLanguage` default (`usePreferredLanguage`). "Set as default" is opt-in
 * (unchecked by default) so picking a one-off language for a single message doesn't
 * silently change what every other message translates to.
 */
export const TranslationLanguageModal = ({
  open,
  onOpenChange,
  messageId,
  onTranslateRequested,
}: TranslationLanguageModalProps): React.ReactElement => {
  const { preferredLanguage, setPreferredLanguage } = usePreferredLanguage();
  const [selectedLang, setSelectedLang] = useState(preferredLanguage);
  const [setAsDefault, setSetAsDefault] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleOpenChange = (next: boolean): void => {
    if (next) {
      setSelectedLang(preferredLanguage);
      setSetAsDefault(false);
    }
    onOpenChange(next);
  };

  const handleTranslate = async (): Promise<void> => {
    setSubmitting(true);
    try {
      if (setAsDefault) setPreferredLanguage(selectedLang);
      await apiInstance.post(`/messages/${messageId}/translate`, { targetLang: selectedLang });
      onTranslateRequested(selectedLang);
      onOpenChange(false);
    } catch {
      // Reactive query just won't ever pick up a translation — same no-op-on-failure
      // shape as the hover-toolbar Translate click (ChatBubble.tsx's handleTranslate).
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={handleOpenChange}
      title='Translation language'
      className='p-4 w-96 backdrop-blur-none'
    >
      <div className='flex items-center justify-between mb-3'>
        <h2 className='text-lg font-semibold text-foreground'>Translation language</h2>
        <button
          onClick={() => handleOpenChange(false)}
          data-track-category='MESSAGE'
          data-track-name='CLOSE_TRANSLATION_LANGUAGE_DIALOG'
          className='p-1 hover:bg-accent rounded text-muted-foreground hover:text-foreground'
        >
          <MultipleCrossCancelDefault className='h-4 w-4' />
        </button>
      </div>
      <div className='flex flex-col gap-4'>
        <div className='flex flex-col gap-2'>
          <label htmlFor='translation-language-select' className='text-sm font-medium'>
            Translate to
          </label>
          <Select value={selectedLang} onValueChange={setSelectedLang}>
            <SelectTrigger id='translation-language-select' className='w-full'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PREFERRED_LANGUAGE_OPTIONS.map(option => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <p className='text-sm text-muted-foreground'>
          Note: Translations are visible only to you – others will only see the original.
        </p>

        <div className='flex items-center justify-between gap-4 pt-2'>
          <Checkbox
            checked={setAsDefault}
            onChange={setSetAsDefault}
            label='Set as default translation language'
          />
          <div className='flex items-center gap-2 shrink-0'>
            <Button variant='outline' onClick={() => handleOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={() => void handleTranslate()} disabled={submitting}>
              Translate
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  );
};
