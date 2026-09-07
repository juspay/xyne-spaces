import React from 'react';
import * as RadioGroupPrimitive from '@radix-ui/react-radio-group';
import { Paperclip } from 'lucide-react';
import type { HistoryScopeMode } from '@xyne/shared';
import Avatar from '../../ui/Avatar/Avatar';
import { cn } from '../../../utils/classNames';
import type { AddPeopleHistoryStepProps } from './AddPeopleForm.types';
import {
  HISTORY_SCOPE_OPTIONS,
  formatMessageTime,
  toPreviewText,
  todayInputValue,
} from './AddPeopleForm.utils';

export const AddPeopleHistoryStep: React.FC<AddPeopleHistoryStepProps> = ({
  scopeMode,
  onScopeModeChange,
  customDate,
  onCustomDateChange,
  cutoffChosen,
  previewGroups,
  previewOverflowCount,
  hasPreviewItems,
  embedded,
  dimmed,
  footer,
}) => (
  <div className={cn('space-y-4', !embedded && 'p-4')}>
    <div className={cn('space-y-4', dimmed && 'pointer-events-none opacity-40')}>
      {!embedded && (
        <h2 className='text-lg font-semibold text-foreground'>Include conversation history?</h2>
      )}

      <RadioGroupPrimitive.Root
        value={scopeMode}
        onValueChange={value => onScopeModeChange(value as HistoryScopeMode)}
        aria-label='Conversation history'
        className='space-y-2'
      >
        {HISTORY_SCOPE_OPTIONS.map(option => {
          const isSelected = option.mode === scopeMode;

          return (
            <div key={option.mode} className='space-y-2'>
              <RadioGroupPrimitive.Item
                value={option.mode}
                className='flex w-full items-center gap-3 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50'
                data-track-category='ADD_CHAT_PARTICIPANTS'
                data-track-name='SELECT_HISTORY_SCOPE'
              >
                <span
                  className={cn(
                    'flex h-4 w-4 shrink-0 items-center justify-center rounded-full border',
                    isSelected ? 'border-primary' : 'border-border',
                  )}
                >
                  {isSelected && <span className='h-2 w-2 rounded-full bg-primary' />}
                </span>
                <span className='text-sm text-foreground'>{option.label}</span>
              </RadioGroupPrimitive.Item>

              {option.requiresDate && isSelected && (
                <input
                  type='date'
                  value={customDate}
                  max={todayInputValue()}
                  onChange={event => onCustomDateChange(event.target.value)}
                  className='ml-7 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground'
                  aria-label='Custom history start date'
                  data-track-category='ADD_CHAT_PARTICIPANTS'
                  data-track-name='SELECT_CUSTOM_HISTORY_DATE'
                />
              )}
            </div>
          );
        })}
      </RadioGroupPrimitive.Root>

      {scopeMode !== 'none' && (
        <div>
          <p className='text-sm text-muted-foreground mb-2'>Preview what&apos;s included</p>
          <div className='h-72 overflow-y-auto rounded-lg border border-border bg-muted/40 p-3'>
            {!cutoffChosen ? (
              <div className='flex h-full items-center justify-center text-center text-sm text-muted-foreground'>
                Select a date to preview messages
              </div>
            ) : !hasPreviewItems ? (
              <div className='flex h-full items-center justify-center text-center text-sm text-muted-foreground'>
                Since there aren&apos;t any messages from this time, no conversation history will be
                included.
              </div>
            ) : (
              <div className='space-y-4'>
                {previewGroups.map(group => (
                  <div key={group.key} className='space-y-3'>
                    <div className='flex items-center gap-3'>
                      <div className='h-px flex-1 bg-border' />
                      <span className='text-xs font-medium text-muted-foreground'>
                        {group.label}
                      </span>
                      <div className='h-px flex-1 bg-border' />
                    </div>

                    {group.items.map(conversation => (
                      <div key={conversation.conversationId} className='flex gap-2'>
                        <Avatar
                          userId={conversation.initialMessage?.senderId ?? null}
                          size='md'
                          showActiveStatus={false}
                        />
                        <div className='min-w-0 flex-1'>
                          <div className='flex items-baseline gap-2'>
                            <span className='text-sm font-semibold text-foreground'>
                              {conversation.initialMessage?.senderName || 'Unknown'}
                            </span>
                            <span className='text-xs text-muted-foreground'>
                              {formatMessageTime(conversation.createdAt)}
                            </span>
                          </div>
                          <p className='whitespace-pre-wrap break-words text-sm text-foreground/80'>
                            {toPreviewText(conversation.initialMessage?.content)}
                          </p>

                          {(conversation.attachments ?? []).map(attachment => (
                            <div
                              key={attachment.id}
                              className='mt-1 flex items-center gap-1.5 text-xs text-muted-foreground'
                            >
                              <Paperclip className='size-3 shrink-0' aria-hidden />
                              <span className='truncate'>
                                {attachment.originalFilename ?? 'Attachment'}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                ))}

                {previewOverflowCount > 0 && (
                  <p className='pt-1 text-center text-xs text-muted-foreground'>
                    +{previewOverflowCount} more conversation
                    {previewOverflowCount === 1 ? '' : 's'} will also be shared
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>

    {footer}
  </div>
);

export default AddPeopleHistoryStep;
