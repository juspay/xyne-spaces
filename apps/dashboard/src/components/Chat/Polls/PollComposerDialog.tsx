import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import type { PollDraft, PollResponseType, PollResultVisibility, PollSchedule } from '@xyne/shared';
import Dialog from '../../ui/Dialog';
import { Button } from '../../ui/Button';
import { Checkbox } from '../../ui/Checkbox/Checkbox';
import { DateTimePicker } from '../../ui/DateTimePicker';
import Input from '../../ui/Input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/Select';

type DraftQuestion = {
  id: string;
  question: string;
  responseType: PollResponseType;
  choices: Array<{ id: string; text: string }>;
};

type TimingMode = 'NONE' | '10' | '30' | '60' | '180' | '1440' | '10080' | 'CUSTOM';

const newQuestion = (): DraftQuestion => ({
  id: uuidv4(),
  question: '',
  responseType: 'SINGLE_CHOICE',
  choices: [
    { id: uuidv4(), text: '' },
    { id: uuidv4(), text: '' },
  ],
});

export function resolvePollScheduleTime(
  mode: TimingMode,
  custom: Date | null,
  baseTimestamp: number,
): string | null {
  if (mode === 'NONE') return null;
  if (mode === 'CUSTOM') return custom?.toISOString() ?? null;
  return new Date(baseTimestamp + Number(mode) * 60_000).toISOString();
}

function TimingField({
  label,
  value,
  customValue,
  includeNow = false,
  onChange,
  onCustomChange,
}: {
  label: string;
  value: TimingMode;
  customValue: Date | null;
  includeNow?: boolean;
  onChange: (value: TimingMode) => void;
  onCustomChange: (value: Date | null) => void;
}) {
  return (
    <div className='space-y-2'>
      <label className='text-sm font-medium'>{label}</label>
      <Select value={value} onValueChange={next => onChange(next as TimingMode)}>
        <SelectTrigger className='w-full' aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value='NONE'>{includeNow ? 'Publish now' : 'No'}</SelectItem>
          <SelectItem value='10'>{includeNow ? 'In 10 minutes' : 'After 10 minutes'}</SelectItem>
          <SelectItem value='30'>{includeNow ? 'In 30 minutes' : 'After 30 minutes'}</SelectItem>
          <SelectItem value='60'>{includeNow ? 'In 1 hour' : 'After 1 hour'}</SelectItem>
          <SelectItem value='180'>{includeNow ? 'In 3 hours' : 'After 3 hours'}</SelectItem>
          <SelectItem value='1440'>{includeNow ? 'In 1 day' : 'After 1 day'}</SelectItem>
          <SelectItem value='10080'>{includeNow ? 'In 7 days' : 'After 7 days'}</SelectItem>
          <SelectItem value='CUSTOM'>Custom date and time…</SelectItem>
        </SelectContent>
      </Select>
      {value === 'CUSTOM' && (
        <DateTimePicker
          value={customValue}
          onChange={onCustomChange}
          placeholder={`Choose ${label.toLocaleLowerCase()}`}
        />
      )}
    </div>
  );
}

export function PollComposerDialog({
  open,
  isPublishing,
  onClose,
  onPublish,
}: {
  open: boolean;
  activeChannelId: string;
  isPublishing: boolean;
  onClose: () => void;
  onPublish: (draft: PollDraft, schedule: PollSchedule) => Promise<void>;
}) {
  const [pollId, setPollId] = useState(() => uuidv4());
  const [step, setStep] = useState<'edit' | 'preview'>('edit');
  const [questions, setQuestions] = useState<DraftQuestion[]>([newQuestion()]);
  const [allowAudienceChoices, setAllowAudienceChoices] = useState(false);
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [resultVisibility, setResultVisibility] = useState<PollResultVisibility>('EVERYONE');
  const [sortResultsByVotes, setSortResultsByVotes] = useState(false);
  const [publishMode, setPublishMode] = useState<TimingMode>('NONE');
  const [closeMode, setCloseMode] = useState<TimingMode>('NONE');
  const [reminderMode, setReminderMode] = useState<TimingMode>('NONE');
  const [customPublishAt, setCustomPublishAt] = useState<Date | null>(null);
  const [customCloseAt, setCustomCloseAt] = useState<Date | null>(null);
  const [customReminderAt, setCustomReminderAt] = useState<Date | null>(null);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const reset = () => {
    setPollId(uuidv4());
    setStep('edit');
    setQuestions([newQuestion()]);
    setAllowAudienceChoices(false);
    setIsAnonymous(false);
    setResultVisibility('EVERYONE');
    setSortResultsByVotes(false);
    setPublishMode('NONE');
    setCloseMode('NONE');
    setReminderMode('NONE');
    setCustomPublishAt(null);
    setCustomCloseAt(null);
    setCustomReminderAt(null);
    setPublishError(null);
    setIsSubmitting(false);
  };
  const close = () => {
    reset();
    onClose();
  };

  const now = Date.now();
  const publishAt = resolvePollScheduleTime(publishMode, customPublishAt, now);
  const lifecycleBase = publishAt ? Date.parse(publishAt) : now;
  const closeAt = resolvePollScheduleTime(closeMode, customCloseAt, lifecycleBase);
  const remindAt = resolvePollScheduleTime(reminderMode, customReminderAt, lifecycleBase);
  const schedule: PollSchedule = { publishAt, closeAt, remindAt };
  const scheduleIsValid =
    (!publishAt || Date.parse(publishAt) > now) &&
    (!closeAt || Date.parse(closeAt) > lifecycleBase) &&
    (!remindAt || Date.parse(remindAt) > lifecycleBase) &&
    (!closeAt || !remindAt || Date.parse(remindAt) < Date.parse(closeAt));
  const valid =
    scheduleIsValid &&
    questions.every(
      question =>
        question.question.trim() &&
        (!['SINGLE_CHOICE', 'MULTIPLE_CHOICE', 'RANKING'].includes(question.responseType) ||
          (question.choices.length >= 2 && question.choices.every(choice => choice.text.trim()))),
    );

  const draft: PollDraft = {
    pollId,
    allowAudienceChoices,
    isAnonymous,
    resultVisibility,
    sortResultsByVotes,
    questions: questions.map(question => ({
      id: question.id,
      question: question.question.trim(),
      responseType: question.responseType,
      options: ['SINGLE_CHOICE', 'MULTIPLE_CHOICE', 'RANKING'].includes(question.responseType)
        ? question.choices.map(choice => ({ id: choice.id, text: choice.text.trim() }))
        : [],
    })),
  };

  const submit = async (): Promise<void> => {
    if (!valid || isPublishing || isSubmitting) return;
    setPublishError(null);
    setIsSubmitting(true);
    try {
      await onPublish(draft, schedule);
      close();
    } catch (error) {
      setPublishError(error instanceof Error ? error.message : 'Failed to publish poll');
      setIsSubmitting(false);
    }
  };

  const updateQuestion = (id: string, update: Partial<DraftQuestion>) =>
    setQuestions(current =>
      current.map(question => (question.id === id ? { ...question, ...update } : question)),
    );

  return (
    <Dialog
      open={open}
      onOpenChange={value => !value && close()}
      title='Create a poll'
      className='w-[calc(100vw-2rem)] max-w-2xl overflow-hidden'
    >
      <div className='flex max-h-[85vh] min-w-0 flex-col'>
        <div className='min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5'>
          {step === 'edit' ? (
            <>
              {questions.map((question, questionIndex) => {
                const usesChoices = ['SINGLE_CHOICE', 'MULTIPLE_CHOICE', 'RANKING'].includes(
                  question.responseType,
                );
                return (
                  <section
                    key={question.id}
                    className='space-y-3 rounded-xl border border-border p-4'
                  >
                    <div className='flex items-center gap-2'>
                      <label className='flex-1 text-sm font-semibold'>
                        Question {questionIndex + 1}
                      </label>
                      {questions.length > 1 && (
                        <Button
                          type='button'
                          variant='ghost'
                          size='iconSm'
                          aria-label='Remove question'
                          onClick={() =>
                            setQuestions(items => items.filter(item => item.id !== question.id))
                          }
                        >
                          <Trash2 />
                        </Button>
                      )}
                    </div>
                    <Input
                      value={question.question}
                      maxLength={500}
                      placeholder='Write your question…'
                      onChange={event =>
                        updateQuestion(question.id, { question: event.target.value })
                      }
                    />
                    <Select
                      value={question.responseType}
                      onValueChange={value =>
                        updateQuestion(question.id, {
                          responseType: value as PollResponseType,
                        })
                      }
                    >
                      <SelectTrigger
                        className='w-full'
                        aria-label={`Question ${questionIndex + 1} response type`}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value='SINGLE_CHOICE'>Select one option</SelectItem>
                        <SelectItem value='MULTIPLE_CHOICE'>Select many options</SelectItem>
                        <SelectItem value='SHORT_TEXT'>Write a short text</SelectItem>
                        <SelectItem value='RANKING'>Rank options</SelectItem>
                        <SelectItem value='RATING_1_TO_5'>Rate from 1 to 5</SelectItem>
                        <SelectItem value='Q_AND_A'>Ask me anything (Q&amp;A)</SelectItem>
                      </SelectContent>
                    </Select>
                    {usesChoices &&
                      question.choices.map((choice, choiceIndex) => (
                        <div key={choice.id} className='flex gap-2'>
                          <Input
                            value={choice.text}
                            maxLength={200}
                            placeholder={`Choice ${choiceIndex + 1}`}
                            onChange={event =>
                              updateQuestion(question.id, {
                                choices: question.choices.map(item =>
                                  item.id === choice.id
                                    ? { ...item, text: event.target.value }
                                    : item,
                                ),
                              })
                            }
                          />
                          {question.choices.length > 2 && (
                            <Button
                              type='button'
                              variant='ghost'
                              size='iconSm'
                              aria-label='Remove choice'
                              onClick={() =>
                                updateQuestion(question.id, {
                                  choices: question.choices.filter(item => item.id !== choice.id),
                                })
                              }
                            >
                              <Trash2 />
                            </Button>
                          )}
                        </div>
                      ))}
                    {usesChoices && question.choices.length < 10 && (
                      <Button
                        type='button'
                        variant='ghost'
                        size='sm'
                        onClick={() =>
                          updateQuestion(question.id, {
                            choices: [...question.choices, { id: uuidv4(), text: '' }],
                          })
                        }
                      >
                        <Plus /> Add another option
                      </Button>
                    )}
                  </section>
                );
              })}
              {questions.length < 10 && (
                <Button
                  type='button'
                  variant='outline'
                  onClick={() => setQuestions(items => [...items, newQuestion()])}
                >
                  <Plus /> Add more questions
                </Button>
              )}

              <section className='space-y-4 rounded-xl border border-border p-4'>
                <h3 className='font-semibold'>Settings</h3>
                <Checkbox
                  checked={isAnonymous}
                  onChange={setIsAnonymous}
                  label='Make responses anonymous'
                />
                <Checkbox
                  checked={allowAudienceChoices}
                  onChange={setAllowAudienceChoices}
                  label='Allow others to add options'
                />
                <Checkbox
                  checked={sortResultsByVotes}
                  onChange={setSortResultsByVotes}
                  label='Order results by most votes'
                />
                <div className='space-y-2'>
                  <p className='text-sm font-medium'>Show results of the poll</p>
                  <Select
                    value={resultVisibility}
                    onValueChange={value => setResultVisibility(value as PollResultVisibility)}
                  >
                    <SelectTrigger className='w-full' aria-label='Show results of the poll'>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value='EVERYONE'>In real-time to everyone</SelectItem>
                      <SelectItem value='CREATOR_ONLY'>Only visible to poll creator</SelectItem>
                      <SelectItem value='ADMIN_ONLY'>Poll creator and channel admins</SelectItem>
                      <SelectItem value='AFTER_CLOSE'>Hidden until poll closes</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </section>

              <section className='space-y-4 rounded-xl border border-border p-4'>
                <h3 className='font-semibold'>Scheduling</h3>
                <div className='grid gap-4 md:grid-cols-2'>
                  <TimingField
                    label='Publish poll'
                    value={publishMode}
                    customValue={customPublishAt}
                    includeNow
                    onChange={setPublishMode}
                    onCustomChange={setCustomPublishAt}
                  />
                  <TimingField
                    label='Close poll automatically'
                    value={closeMode}
                    customValue={customCloseAt}
                    onChange={setCloseMode}
                    onCustomChange={setCustomCloseAt}
                  />
                  <TimingField
                    label='Remind non-voters'
                    value={reminderMode}
                    customValue={customReminderAt}
                    onChange={setReminderMode}
                    onCustomChange={setCustomReminderAt}
                  />
                </div>
                {!scheduleIsValid && (
                  <p role='alert' className='text-sm text-destructive'>
                    Choose future times; reminders must run before the poll closes.
                  </p>
                )}
              </section>
            </>
          ) : (
            <div className='space-y-4'>
              {draft.questions.map(question => (
                <section key={question.id} className='rounded-xl border border-border p-4'>
                  <h3 className='font-semibold'>{question.question}</h3>
                  {question.options.length > 0 && (
                    <ul className='mt-2 space-y-1 text-sm text-muted-foreground'>
                      {question.options.map(option => (
                        <li key={option.id}>○ {option.text}</li>
                      ))}
                    </ul>
                  )}
                  <p className='mt-2 text-xs text-muted-foreground'>
                    {(question.responseType ?? 'SINGLE_CHOICE').replaceAll('_', ' ')}
                  </p>
                </section>
              ))}
              <p className='rounded-lg bg-muted/50 px-3 py-2 text-sm text-muted-foreground'>
                This poll will be posted in the current conversation.
              </p>
              {publishError && (
                <p role='alert' className='text-sm text-destructive'>
                  {publishError}
                </p>
              )}
            </div>
          )}
        </div>

        <footer className='flex shrink-0 justify-end gap-2 border-t border-border bg-popover px-6 py-4'>
          <Button
            type='button'
            variant='outline'
            onClick={step === 'preview' ? () => setStep('edit') : close}
          >
            {step === 'preview' ? 'Back' : 'Cancel'}
          </Button>
          {step === 'edit' ? (
            <Button type='button' disabled={!valid} onClick={() => setStep('preview')}>
              Preview
            </Button>
          ) : (
            <Button
              type='button'
              disabled={isPublishing || isSubmitting}
              loading={isPublishing || isSubmitting}
              onClick={() => void submit()}
            >
              {publishMode === 'NONE' ? 'Post poll' : 'Schedule poll'}
            </Button>
          )}
        </footer>
      </div>
    </Dialog>
  );
}
