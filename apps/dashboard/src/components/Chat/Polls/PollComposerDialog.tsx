import { useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import type { PollDraft } from '@xyne/shared';
import Dialog from '../../ui/Dialog';
import { Plus, Trash2 } from 'lucide-react';

type DraftQuestion = { id: string; question: string; choices: Array<{ id: string; text: string }> };

const newQuestion = (): DraftQuestion => ({
  id: uuidv4(),
  question: '',
  choices: [
    { id: uuidv4(), text: '' },
    { id: uuidv4(), text: '' },
  ],
});

export function PollComposerDialog({
  open,
  onClose,
  onPublish,
}: {
  open: boolean;
  onClose: () => void;
  onPublish: (draft: PollDraft) => void;
}) {
  const [pollId, setPollId] = useState<string>(() => uuidv4());
  const [step, setStep] = useState<'edit' | 'preview'>('edit');
  const [questions, setQuestions] = useState<DraftQuestion[]>([newQuestion()]);
  const [allowComments, setAllowComments] = useState(true);
  const [allowMultipleVotes, setAllowMultipleVotes] = useState(false);
  const [allowAudienceChoices, setAllowAudienceChoices] = useState(false);

  const resetComposer = () => {
    setPollId(uuidv4());
    setStep('edit');
    setQuestions([newQuestion()]);
    setAllowComments(true);
    setAllowMultipleVotes(false);
    setAllowAudienceChoices(false);
  };
  const closeComposer = () => {
    resetComposer();
    onClose();
  };

  const valid = questions.every(
    question =>
      question.question.trim() &&
      question.choices.length >= 2 &&
      question.choices.every(choice => choice.text.trim()),
  );
  const draft: PollDraft = {
    pollId,
    allowComments,
    allowMultipleVotes,
    allowAudienceChoices,
    questions: questions.map(question => ({
      id: question.id,
      question: question.question.trim(),
      options: question.choices.map(choice => ({ id: choice.id, text: choice.text.trim() })),
    })),
  };

  return (
    <Dialog open={open} onOpenChange={value => !value && closeComposer()} title='Create a poll'>
      <div className='max-h-[70vh] space-y-5 overflow-y-auto p-1 sm:min-w-[560px]'>
        {step === 'edit' ? (
          <>
            {questions.map((question, questionIndex) => (
              <section key={question.id} className='space-y-3 rounded-lg border border-border p-3'>
                <div className='flex items-center gap-2'>
                  <label className='flex-1 text-sm font-semibold'>
                    Question {questionIndex + 1}
                  </label>
                  {questions.length > 1 && (
                    <button
                      type='button'
                      aria-label='Remove question'
                      data-track-category='POLL_COMPOSER'
                      data-track-name='REMOVE_QUESTION'
                      onClick={() =>
                        setQuestions(items => items.filter(item => item.id !== question.id))
                      }
                    >
                      <Trash2 className='h-4 w-4' />
                    </button>
                  )}
                </div>
                <input
                  value={question.question}
                  maxLength={500}
                  placeholder='Write your question…'
                  className='w-full rounded-md border border-border bg-background px-3 py-2'
                  data-track-category='POLL_COMPOSER'
                  data-track-name='TYPE_QUESTION'
                  onChange={event =>
                    setQuestions(items =>
                      items.map(item =>
                        item.id === question.id ? { ...item, question: event.target.value } : item,
                      ),
                    )
                  }
                />
                {question.choices.map((choice, choiceIndex) => (
                  <div key={choice.id} className='flex gap-2'>
                    <input
                      value={choice.text}
                      maxLength={200}
                      placeholder={`Choice ${choiceIndex + 1}`}
                      className='min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-2'
                      data-track-category='POLL_COMPOSER'
                      data-track-name='TYPE_CHOICE'
                      onChange={event =>
                        setQuestions(items =>
                          items.map(item =>
                            item.id === question.id
                              ? {
                                  ...item,
                                  choices: item.choices.map(option =>
                                    option.id === choice.id
                                      ? { ...option, text: event.target.value }
                                      : option,
                                  ),
                                }
                              : item,
                          ),
                        )
                      }
                    />
                    {question.choices.length > 2 && (
                      <button
                        type='button'
                        aria-label='Remove choice'
                        data-track-category='POLL_COMPOSER'
                        data-track-name='REMOVE_CHOICE'
                        onClick={() =>
                          setQuestions(items =>
                            items.map(item =>
                              item.id === question.id
                                ? {
                                    ...item,
                                    choices: item.choices.filter(item => item.id !== choice.id),
                                  }
                                : item,
                            ),
                          )
                        }
                      >
                        <Trash2 className='h-4 w-4' />
                      </button>
                    )}
                  </div>
                ))}
                {question.choices.length < 10 && (
                  <button
                    type='button'
                    className='flex items-center gap-1 text-sm text-primary'
                    data-track-category='POLL_COMPOSER'
                    data-track-name='ADD_CHOICE'
                    onClick={() =>
                      setQuestions(items =>
                        items.map(item =>
                          item.id === question.id
                            ? { ...item, choices: [...item.choices, { id: uuidv4(), text: '' }] }
                            : item,
                        ),
                      )
                    }
                  >
                    <Plus className='h-4 w-4' /> Add choice
                  </button>
                )}
              </section>
            ))}
            {questions.length < 10 && (
              <button
                type='button'
                className='flex items-center gap-1 rounded-md border border-border px-3 py-2 text-sm'
                data-track-category='POLL_COMPOSER'
                data-track-name='ADD_QUESTION'
                onClick={() => setQuestions(items => [...items, newQuestion()])}
              >
                <Plus className='h-4 w-4' /> Add another question
              </button>
            )}
            <div className='space-y-2 text-sm'>
              <label className='flex gap-2'>
                <input
                  type='checkbox'
                  checked={allowComments}
                  onChange={event => setAllowComments(event.target.checked)}
                  data-track-category='POLL_COMPOSER'
                  data-track-name='TOGGLE_COMMENTS'
                />{' '}
                Allow comments
              </label>
              <label className='flex gap-2'>
                <input
                  type='checkbox'
                  checked={allowMultipleVotes}
                  onChange={event => setAllowMultipleVotes(event.target.checked)}
                  data-track-category='POLL_COMPOSER'
                  data-track-name='TOGGLE_MULTIPLE_VOTES'
                />{' '}
                Allow multiple votes
              </label>
              <label className='flex gap-2'>
                <input
                  type='checkbox'
                  checked={allowAudienceChoices}
                  onChange={event => setAllowAudienceChoices(event.target.checked)}
                  data-track-category='POLL_COMPOSER'
                  data-track-name='TOGGLE_AUDIENCE_CHOICES'
                />{' '}
                Audience can add choices
              </label>
            </div>
          </>
        ) : (
          <div className='space-y-4'>
            {draft.questions.map(question => (
              <section key={question.id} className='rounded-lg border border-border p-3'>
                <h3 className='font-semibold'>{question.question}</h3>
                <ul className='mt-2 space-y-1 text-sm text-muted-foreground'>
                  {question.options.map(option => (
                    <li key={option.id}>○ {option.text}</li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
        <div className='flex justify-end gap-2 border-t border-border pt-3'>
          <button
            type='button'
            className='rounded-md border border-border px-4 py-2'
            onClick={step === 'preview' ? () => setStep('edit') : closeComposer}
            data-track-category='POLL_COMPOSER'
            data-track-name={step === 'preview' ? 'BACK' : 'CANCEL'}
          >
            {step === 'preview' ? 'Back' : 'Cancel'}
          </button>
          {step === 'edit' ? (
            <button
              type='button'
              disabled={!valid}
              className='rounded-md bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50'
              onClick={() => setStep('preview')}
              data-track-category='POLL_COMPOSER'
              data-track-name='PREVIEW'
            >
              Next
            </button>
          ) : (
            <button
              type='button'
              className='rounded-md bg-primary px-4 py-2 text-primary-foreground'
              onClick={() => {
                onPublish(draft);
                resetComposer();
              }}
              data-track-category='POLL_COMPOSER'
              data-track-name='PUBLISH'
            >
              Publish poll
            </button>
          )}
        </div>
      </div>
    </Dialog>
  );
}
