import { useSelector } from '@xstate/react';
import { Bot, Info, MoreVertical } from 'lucide-react';
import { roomActor } from '../../../machines/roomMachine';
import { cn } from '../../../utils/classNames';
import {
  getAiButtonDisabled,
  getAiButtonTitle,
  getAiControlState,
  handleAiButtonClick,
} from '../../../utils/callControls';
import { SlashedBot } from '../CallPrivacyIndicator/CallPrivacyIndicator';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../ui/dropdown-menu';
import Tooltip from '../../ui/Tooltip';

/** What the local user needs to talk to / take control of the agent. */
export interface AgentControls {
  localParticipantId: string | null;
  requestedAiController: boolean;
  onRequestControl?: (() => void) | undefined;
}

interface AgentCardProps {
  callId: string;
  isHost: boolean;
  hostName?: string | null | undefined;
  /** Omitted where talk-back isn't offered (guests, mini window). */
  agentControls?: AgentControls | undefined;
}

/**
 * Xyne Automatic, pinned to the top of the People panel: whether it is
 * transcribing, the talk-back / control button that used to live in the bar,
 * and the host's stop/resume switch that otherwise hides in the privacy popover.
 */
export function AgentCard({
  callId,
  isHost,
  hostName,
  agentControls,
}: AgentCardProps): React.ReactElement {
  const isTranscriptionEnabled = useSelector(
    roomActor,
    state => state.context.isTranscriptionEnabled,
  );
  const isPending = useSelector(roomActor, state => state.context.transcriptionPending);
  const isAIAssistantEnabled = useSelector(roomActor, state => state.context.isAIAssistantEnabled);
  const aiController = useSelector(roomActor, state => state.context.aiController);
  const pendingControlRequest = useSelector(
    roomActor,
    state => state.context.pendingControlRequest,
  );

  const { isController, isControlledByOther, hasPendingRequestFromOther, isRequestingUser } =
    getAiControlState({
      localParticipantId: agentControls?.localParticipantId ?? null,
      aiController,
      pendingControlRequest,
    });
  const isAiActiveForMe = isController || (isAIAssistantEnabled && !isControlledByOther);

  const aiTitle = getAiButtonTitle({
    hasPendingRequestFromOther,
    isRequestingUser,
    isControlledByOther,
    isAIAssistantEnabled,
    pendingControlRequest,
    aiController,
  });
  const isAiDisabled = getAiButtonDisabled({
    hasPendingRequestFromOther,
    isRequestingUser,
    requestedAiController: agentControls?.requestedAiController ?? false,
  });

  // Talk-back needs speech-to-text, so it's only offered while transcribing.
  const showTalkBack = !!agentControls && isTranscriptionEnabled;

  const statusLabel = isPending
    ? isTranscriptionEnabled
      ? 'Stopping…'
      : 'Starting…'
    : isTranscriptionEnabled
      ? aiController
        ? `Transcribing · controlled by ${isController ? 'you' : aiController.name}`
        : 'Transcribing this call'
      : 'Not transcribing';

  const talkBackClick = (): void =>
    handleAiButtonClick({
      hasPendingRequestFromOther,
      isControlledByOther,
      onRequestControl: agentControls?.onRequestControl,
      onToggleAIAssistant: () => roomActor.send({ type: 'TOGGLE_AI_ASSISTANT' }),
    });

  // One compact row, styled like the participant rows below it: logo + status,
  // a talk-back icon button, and (host) a ⋮ menu to stop/resume transcription.
  return (
    <div
      className='flex items-center gap-3 rounded-xl border border-border px-3 py-2.5'
      data-testid='agent-card'
    >
      <div className='relative flex-shrink-0'>
        <img
          src='/images/xyne_logo.png'
          alt=''
          className='h-8 w-8 rounded-full object-cover ring-1 ring-border visual-regression-hide'
        />
        <span
          className={cn(
            'absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-background',
            isTranscriptionEnabled ? 'animate-pulse bg-red-500' : 'bg-muted-foreground',
          )}
          aria-hidden
        />
      </div>
      <div className='min-w-0 flex-1'>
        <p className='truncate text-sm font-medium'>Xyne Automatic</p>
        <p className='truncate text-xs text-muted-foreground' title={statusLabel}>
          {statusLabel}
        </p>
      </div>

      <div className='flex flex-shrink-0 items-center gap-1'>
        {showTalkBack && (
          <Tooltip content={aiTitle} side='bottom'>
            <span className='inline-flex'>
              <button
                type='button'
                onClick={talkBackClick}
                disabled={isAiDisabled}
                aria-label={aiTitle}
                aria-pressed={isAiActiveForMe}
                className={cn(
                  'flex h-8 w-8 items-center justify-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                  isAiActiveForMe
                    ? 'bg-purple-600 text-white hover:bg-purple-700'
                    : isControlledByOther
                      ? 'text-amber-500 hover:bg-muted'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
                data-track-category='CALLS'
                data-track-name='AI_Assistant'
                data-track-metadata={JSON.stringify({
                  callId,
                  source: 'people_panel',
                  isControlledByOther,
                  hasPendingRequest: hasPendingRequestFromOther,
                })}
              >
                <Bot className='h-4 w-4' />
              </button>
            </span>
          </Tooltip>
        )}

        {isHost ? (
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <button
                type='button'
                className='flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground data-[state=open]:bg-muted'
                aria-label='Xyne Automatic options'
                title='More options'
              >
                <MoreVertical className='h-4 w-4' />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align='end' className='w-56'>
              <DropdownMenuItem
                onClick={() => roomActor.send({ type: 'TOGGLE_TRANSCRIPTION' })}
                disabled={isPending}
                className={cn(
                  'cursor-pointer gap-2.5',
                  isTranscriptionEnabled && 'text-red-600 focus:text-red-600',
                )}
                data-testid='agent-card-transcription-toggle'
                data-track-category='CALLS'
                data-track-name='TRANSCRIPTION_TOGGLE'
                data-track-metadata={JSON.stringify({
                  enabled: isTranscriptionEnabled,
                  source: 'people_panel',
                })}
              >
                {isTranscriptionEnabled ? (
                  <SlashedBot className='h-4 w-4' />
                ) : (
                  <Bot className='h-4 w-4' />
                )}
                {isTranscriptionEnabled ? 'Stop transcribing' : 'Resume transcribing'}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          isTranscriptionEnabled && (
            <Tooltip
              content={`Only ${hostName ?? 'the host'} (host) can stop transcription`}
              side='bottom'
            >
              <span
                className='flex h-8 w-8 items-center justify-center text-muted-foreground'
                aria-label={`Only ${hostName ?? 'the host'} can stop transcription`}
              >
                <Info className='h-4 w-4' />
              </span>
            </Tooltip>
          )
        )}
      </div>
    </div>
  );
}
