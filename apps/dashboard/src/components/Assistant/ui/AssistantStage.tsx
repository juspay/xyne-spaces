import type { ReactElement } from 'react';
import { DIAGNOSTICS_ENABLED } from '../diagnostics';
import { stageContent } from '../transcript';
import type { Assistant } from '../useAssistant';
import { VoiceSessionBar, VoiceStage } from './VoiceStage';

/** The voice view, driven by the assistant. */
export function AssistantStage({ assistant }: { assistant: Assistant }): ReactElement {
  return (
    <VoiceStage
      phase={assistant.phase}
      content={stageContent(assistant.turns)}
      levelStore={assistant.levelStore}
      speaksReplies={assistant.speaksReplies}
      onPress={assistant.press}
      onRelease={assistant.release}
      onInterrupt={assistant.interrupt}
      onChip={assistant.choose}
      onShowText={() => assistant.setView('text')}
      onSpeaksRepliesChange={assistant.setSpeaksReplies}
      onEnd={assistant.end}
      trace={DIAGNOSTICS_ENABLED ? assistant.trace : null}
    />
  );
}

/** The slim bar above the transcript while voice mode is on, with the way back to the orb. */
export function AssistantBar({ assistant }: { assistant: Assistant }): ReactElement {
  return (
    <VoiceSessionBar
      phase={assistant.phase}
      levelStore={assistant.levelStore}
      onShowVoice={() => assistant.setView('voice')}
      onEnd={assistant.end}
    />
  );
}
