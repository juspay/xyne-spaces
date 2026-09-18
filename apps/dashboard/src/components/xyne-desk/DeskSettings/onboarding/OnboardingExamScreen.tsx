import React, { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Clock } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '../../../../utils/classNames';
import { Dialog } from '../../../ui/Dialog/Dialog';
import Textarea from '../../../ui/Textarea/Textarea';
import DelayedSpinner from '../../../ui/DelayedSpinner';
import { clearLocalReplies, useAttemptReplies } from '../../../../hooks/useDeskOnboarding';
import {
  ONBOARDING_MAX_REPLY_CHARS,
  fetchOnboardingTicketEmail,
  onboardingErrorMessage,
  saveOnboardingDraft,
  submitOnboardingAttempt,
  type OnboardingAttempt,
} from '../../../../services/clients/onboardingApi';
import {
  AttachmentList,
  formatDuration,
  primaryButtonClass,
  secondaryButtonClass,
} from './onboardingUi';

interface OnboardingExamScreenProps {
  channelId: string;
  attempt: OnboardingAttempt;
  topicName: string;
  onClose: () => void;
  onChanged: () => Promise<void>;
}

/** Live clock since Start. There is no time limit. */
function useElapsedSeconds(startedAt: string): number {
  const started = Date.parse(startedAt);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return Math.max(0, Math.floor((now - started) / 1000));
}

export const OnboardingExamScreen: React.FC<OnboardingExamScreenProps> = ({
  channelId,
  attempt,
  topicName,
  onClose,
  onChanged,
}) => {
  const [index, setIndex] = useState(0);
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, []);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [confirmBlankOpen, setConfirmBlankOpen] = useState(false);
  const elapsed = useElapsedSeconds(attempt.startedAt);
  const { replies, setReply, markSaved, hasUnsaved, localStorageBlocked } = useAttemptReplies(
    attempt.id,
    attempt.answers,
    attempt.draftSavedAt,
  );

  const current = attempt.answers[index];
  const {
    data: email,
    isLoading: emailLoading,
    isError: emailError,
    refetch: refetchEmail,
  } = useQuery({
    queryKey: ['desk-onboarding-email', channelId, attempt.id, current?.paperTicketId],
    queryFn: () => fetchOnboardingTicketEmail(channelId, attempt.id, current?.paperTicketId ?? ''),
    enabled: !!current,
    staleTime: 5 * 60 * 1000,
  });

  const replyList = attempt.answers.map(a => ({
    paperTicketId: a.paperTicketId,
    replyText: replies[a.paperTicketId] ?? '',
  }));
  const blankCount = replyList.filter(r => !r.replyText.trim()).length;

  const saveDraft = async (): Promise<void> => {
    setSaving(true);
    try {
      const { draftSavedAt } = await saveOnboardingDraft(channelId, attempt.id, replyList);
      markSaved(replyList, draftSavedAt);
      await onChanged();
      toast.success('Draft saved');
    } catch (err) {
      toast.error(
        onboardingErrorMessage(
          err,
          localStorageBlocked
            ? "Couldn't save the draft. Keep this tab open and try again."
            : "Couldn't save the draft. Your replies are still kept on this browser.",
        ),
      );
    } finally {
      setSaving(false);
    }
  };

  const submit = async (): Promise<void> => {
    setConfirmBlankOpen(false);
    setSubmitting(true);
    try {
      await submitOnboardingAttempt(channelId, attempt.id, replyList);
      clearLocalReplies(attempt.id);
      await onChanged();
      toast.success('Submitted. Your score appears here once grading finishes.');
      onClose();
    } catch (err) {
      toast.error(onboardingErrorMessage(err, "Couldn't submit the exam"));
    } finally {
      setSubmitting(false);
    }
  };

  const requestSubmit = (): void => {
    if (blankCount > 0) {
      setConfirmBlankOpen(true);
      return;
    }
    void submit();
  };

  return (
    <div className='flex flex-col gap-[16px]'>
      <div className='flex flex-wrap items-center gap-3'>
        <button
          type='button'
          onClick={onClose}
          className={secondaryButtonClass}
          data-track-category='DeskSettings'
          data-track-name='OnboardingLeaveExam'
        >
          <ArrowLeft size={14} />
          Back
        </button>
        <div className='flex min-w-0 flex-1 flex-col'>
          {/* The exam replaces the whole panel, so focus moves here instead of being lost. */}
          <h3
            ref={headingRef}
            tabIndex={-1}
            className='truncate text-base font-semibold text-foreground focus:outline-none'
          >
            {topicName}
          </h3>
          <span className='text-desk-helper'>
            {localStorageBlocked
              ? 'This browser won’t store your replies — save a draft often so nothing is lost.'
              : hasUnsaved
                ? 'Unsaved replies are kept on this browser until you save a draft.'
                : 'All replies saved.'}{' '}
            You can’t change replies after submitting.
          </span>
        </div>
        <span
          className='inline-flex items-center gap-1.5 rounded-full bg-accent px-2.5 py-1 text-xs font-medium tabular-nums text-foreground'
          title='Time since you started. There is no time limit.'
          aria-label={`Started ${formatDuration(elapsed)} ago. There is no time limit.`}
        >
          <Clock size={12} />
          {formatDuration(elapsed)}
          <span className='font-normal text-muted-foreground'>since you started</span>
        </span>
        <button
          type='button'
          onClick={() => void saveDraft()}
          disabled={saving || submitting}
          className={secondaryButtonClass}
          data-track-category='DeskSettings'
          data-track-name='OnboardingSaveDraft'
        >
          {saving ? 'Saving…' : 'Save draft'}
        </button>
        <button
          type='button'
          onClick={requestSubmit}
          disabled={saving || submitting}
          className={primaryButtonClass}
          data-track-category='DeskSettings'
          data-track-name='OnboardingSubmitExam'
        >
          {submitting ? 'Submitting…' : 'Submit'}
        </button>
      </div>

      <div className='flex min-h-[480px] flex-col gap-[16px] md:flex-row'>
        <ol className='flex w-full shrink-0 flex-row flex-wrap gap-[4px] md:w-[180px] md:flex-col md:flex-nowrap'>
          {attempt.answers.map((answer, i) => {
            const answered = !!(replies[answer.paperTicketId] ?? '').trim();
            return (
              <li key={answer.paperTicketId}>
                <button
                  type='button'
                  onClick={() => setIndex(i)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-[10px] px-3 py-2 text-left text-sm transition-colors',
                    i === index
                      ? 'bg-accent text-foreground'
                      : 'text-desk-muted hover:bg-accent/50',
                  )}
                  aria-current={i === index ? 'step' : undefined}
                  data-track-category='DeskSettings'
                  data-track-name='OnboardingPickTicket'
                >
                  <span
                    className={cn(
                      'h-2 w-2 shrink-0 rounded-full',
                      answered ? 'bg-desk-accent' : 'border border-muted-foreground',
                    )}
                    aria-hidden
                  />
                  <span>Ticket {i + 1}</span>
                  <span className='sr-only'>{answered ? 'answered' : 'blank'}</span>
                </button>
              </li>
            );
          })}
        </ol>

        {current && (
          <div className='flex min-w-0 flex-1 flex-col gap-[16px]'>
            <div className='flex flex-col gap-[10px] rounded-[12px] border border-desk-border p-4 dark:border-border'>
              {emailLoading ? (
                <DelayedSpinner label='Loading the email' />
              ) : emailError ? (
                <div className='flex flex-wrap items-center gap-3 text-desk-helper'>
                  Couldn’t load this email.
                  <button
                    type='button'
                    onClick={() => void refetchEmail()}
                    className='text-sm font-medium text-desk-accent hover:underline'
                    data-track-category='DeskSettings'
                    data-track-name='OnboardingRetryTicketEmail'
                  >
                    Try again
                  </button>
                </div>
              ) : !email?.available ? (
                <div className='text-desk-helper'>
                  This ticket is no longer available. You can leave the reply blank.
                </div>
              ) : (
                <>
                  <div className='flex flex-col gap-[2px]'>
                    <div className='text-sm font-semibold text-foreground'>
                      {email.firstEmail.subject || '(no subject)'}
                    </div>
                    <div className='text-desk-helper'>
                      From {email.firstEmail.from} ·{' '}
                      {new Date(email.firstEmail.sentAt).toLocaleString()}
                    </div>
                  </div>
                  <div className='max-h-[320px] overflow-y-auto whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground'>
                    {email.firstEmail.text || '(This email has no text.)'}
                  </div>
                  <AttachmentList attachments={email.firstEmail.attachments} />
                </>
              )}
            </div>

            <label
              className='flex flex-col gap-[6px]'
              htmlFor={`onboarding-reply-${current.paperTicketId}`}
            >
              <span className='text-sm font-medium text-foreground'>Your reply</span>
              <Textarea
                id={`onboarding-reply-${current.paperTicketId}`}
                value={replies[current.paperTicketId] ?? ''}
                onChange={e => setReply(current.paperTicketId, e.target.value)}
                placeholder='Write the reply you would send to this customer.'
                maxLength={ONBOARDING_MAX_REPLY_CHARS}
                className='min-h-[200px] resize-y rounded-[10px]'
                disabled={submitting}
              />
            </label>

            <div className='flex items-center justify-between'>
              <button
                type='button'
                className={secondaryButtonClass}
                onClick={() => setIndex(i => i - 1)}
                disabled={index === 0}
                data-track-category='DeskSettings'
                data-track-name='OnboardingPreviousTicket'
              >
                Previous
              </button>
              <span className='text-desk-helper tabular-nums'>
                {index + 1} of {attempt.answers.length}
              </span>
              <button
                type='button'
                className={secondaryButtonClass}
                onClick={() => setIndex(i => i + 1)}
                disabled={index === attempt.answers.length - 1}
                data-track-category='DeskSettings'
                data-track-name='OnboardingNextTicket'
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      <Dialog
        open={confirmBlankOpen}
        onOpenChange={next => {
          if (!next) setConfirmBlankOpen(false);
        }}
        title='Submit with blank replies?'
        description='Blank replies score zero.'
        className='max-w-sm p-5'
      >
        <div className='flex flex-col gap-[8px]'>
          <div className='text-base font-semibold text-foreground'>Submit with blank replies?</div>
          <div className='text-sm text-muted-foreground'>
            {blankCount} of {attempt.answers.length} replies are blank and will score zero. You
            can’t change replies after submitting.
          </div>
          <div className='mt-[12px] flex items-center justify-end gap-[8px]'>
            <button
              type='button'
              className={secondaryButtonClass}
              onClick={() => setConfirmBlankOpen(false)}
              data-track-category='DeskSettings'
              data-track-name='OnboardingKeepWriting'
            >
              Keep writing
            </button>
            <button
              type='button'
              className={primaryButtonClass}
              onClick={() => void submit()}
              data-track-category='DeskSettings'
              data-track-name='OnboardingSubmitWithBlanks'
            >
              Submit anyway
            </button>
          </div>
        </div>
      </Dialog>
    </div>
  );
};
