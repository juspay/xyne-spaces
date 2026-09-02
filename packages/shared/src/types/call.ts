export type CallParticipantMetadata = Record<string, unknown> & {
    removedByHost?: boolean;
}

export type HostControls = {
    turnOffAudio: boolean;
    turnOffCamera: boolean;
    turnOffScreenShare: boolean;
}

export const DEFAULT_HOST_CONTROLS: HostControls = {
    turnOffAudio: false,
    turnOffCamera: false,
    turnOffScreenShare: false,
}

export type TranscriptLanguage = {
    code: string;
    label: string;
}

export const SUPPORTED_TRANSCRIPT_LANGUAGES: TranscriptLanguage[] = [
    { code: 'en', label: 'English' },
    { code: 'hi', label: 'Hindi' },
    { code: 'bn', label: 'Bengali' },
    { code: 'ar', label: 'Arabic' },
    { code: 'de', label: 'German' },
    { code: 'pt', label: 'Portuguese' },
    { code: 'ja', label: 'Japanese' },
]

export const ORIGINAL_TRANSCRIPT_LANGUAGE = 'original'

export type TranscriptTranslation = {
    status: 'pending' | 'ready' | 'failed';
    generation?: string;
    text?: string;
    partial?: boolean;
}
